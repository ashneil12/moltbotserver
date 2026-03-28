/**
 * OpenClaw Memory (Unified) Plugin
 *
 * Provides automatic per-turn memory injection and alignment drift scoring.
 * Uses the existing memory search infrastructure (builtin/QMD opt-in) to
 * inject relevant memories before each agent turn via `before_agent_start`.
 *
 * Features:
 * - Re-exports memory_search and memory_get tools (identical to memory-core)
 * - Auto-recall: queries memory_search per turn and injects top results
 * - Alignment drift scoring: evaluates responses against SOUL.md/IDENTITY.md
 * - Skips recall for cron/heartbeat sessions, short prompts, and slash commands
 * - Hard 10-second timeout on recall so the agent never blocks indefinitely
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/memory-core";
import {
  buildCorrectionContext,
  formatAlignmentLogEntry,
  scoreAlignment,
  type AlignmentLlmCall,
} from "./alignment-scorer.js";
import {
  advanceTurn,
  createAlignmentState,
  recordCheck,
  shouldCheck,
  type AlignmentConfig,
  type AlignmentState,
} from "./alignment-state.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Triggers that should NOT get auto-recall injection. */
const SKIP_TRIGGERS = new Set(["cron", "heartbeat", "memory"]);

/** Minimum prompt length (chars) to trigger auto-recall. */
const MIN_PROMPT_LENGTH = 10;

/**
 * Hard deadline (ms) for a single auto-recall search execution.
 * If memory retrieval exceeds this the agent continues without memories rather
 * than hanging the entire session. Configurable via MEMORY_RECALL_TIMEOUT_MS.
 */
const DEFAULT_RECALL_TIMEOUT_MS = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

type MemoryResult = { path?: string; snippet?: string; score?: number };

/** Extract the last assistant message text from the messages array. */
function extractLastAssistantText(messages: unknown[] | undefined): string | null {
  if (!messages || messages.length === 0) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: string } | undefined;
    if (msg?.role === "assistant" && typeof msg.content === "string" && msg.content.trim()) {
      return msg.content;
    }
  }
  return null;
}

/** Extract the CRITICAL rules section from IDENTITY.md content. */
function extractCriticalRules(identityContent: string): string {
  const lines = identityContent.split("\n");
  const criticalLines: string[] = [];
  let inCritical = false;

  for (const line of lines) {
    if (/^#+\s+.*CRITICAL/i.test(line)) {
      inCritical = true;
      criticalLines.push(line);
      continue;
    }
    if (inCritical) {
      // Stop at the next heading that is NOT a CRITICAL sub-heading
      if (/^#+\s/.test(line) && !/CRITICAL/i.test(line)) break;
      criticalLines.push(line);
    }
  }

  return criticalLines.join("\n").trim();
}

/** Read a text file or return an empty string if missing or unreadable. */
async function readTextFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Create an alignment LLM call using Google Generative AI (Flash Lite).
 * Returns null if no API key is available or the request fails.
 */
function createGeminiAlignmentCall(apiKey: string): AlignmentLlmCall {
  return async ({ systemPrompt, userPrompt, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const model = "gemini-2.5-flash-lite-preview-06-17";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch {
      return null; // Timeout, network error, etc.
    } finally {
      clearTimeout(timer);
    }
  };
}

// ── Plugin Definition ─────────────────────────────────────────────────────────

const memoryUnifiedPlugin = {
  id: "memory-unified",
  name: "Memory (Unified)",
  description: "Unified memory with per-turn auto-recall injection and alignment drift scoring",
  kind: "memory" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as {
      autoRecall?: boolean;
      recallMaxResults?: number;
      recallMinScore?: number;
    };

    const businessModeShort = process.env.OPENCLAW_BUSINESS_MODE?.trim();
    const businessModeLong = process.env.OPENCLAW_BUSINESS_MODE_ENABLED?.trim();
    const businessMode =
      businessModeShort === "1" ||
      businessModeShort?.toLowerCase() === "true" ||
      businessModeLong === "1" ||
      businessModeLong?.toLowerCase() === "true";

    // Feature flags
    // Auto-recall defaults to true ONLY when business mode is on.
    const autoRecall = pluginConfig.autoRecall ?? businessMode; // default: businessMode
    const recallMaxResults = pluginConfig.recallMaxResults ?? (businessMode ? 10 : 8);
    const recallMinScore = pluginConfig.recallMinScore ?? 0.3;
    const recallTimeoutMs =
      Number(process.env.MEMORY_RECALL_TIMEOUT_MS) || DEFAULT_RECALL_TIMEOUT_MS;

    // Alignment scoring config — read from environment variables because
    // OpenClaw's core config validator rejects custom extension keys in
    // plugins.entries.memory-unified (additionalProperties: false in the
    // core schema), causing a startup crash loop if they're written to
    // openclaw.json.
    //
    // Env vars (set by enforce-config comments / docker-compose):
    //   ALIGNMENT_CHECK_ENABLED=true          (default: true)
    //   ALIGNMENT_CHECK_OBSERVE_ONLY=true     (default: false)
    //   ALIGNMENT_CHECK_COOLDOWN_TURNS=3      (default: 3)
    //   ALIGNMENT_CHECK_THRESHOLD=0.7         (default: 0.7)
    const alignmentEnabled =
      (process.env.ALIGNMENT_CHECK_ENABLED ?? "true").toLowerCase() !== "false";
    const alignmentObserveOnly =
      (process.env.ALIGNMENT_CHECK_OBSERVE_ONLY ?? "false").toLowerCase() === "true";
    const alignmentConfig: AlignmentConfig = {
      enabled: alignmentEnabled,
      observeOnly: alignmentObserveOnly,
      cooldownTurns: Number(process.env.ALIGNMENT_CHECK_COOLDOWN_TURNS) || 3,
      correctionThreshold: Number(process.env.ALIGNMENT_CHECK_THRESHOLD) || 0.7,
    };

    // Per-plugin-instance alignment state (session-scoped)
    let alignmentState: AlignmentState = createAlignmentState();

    // ====================================================================
    // Tool Registration (same contract as memory-core)
    // ====================================================================
    api.registerTool(
      (ctx) => {
        const memorySearchTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const memoryGetTool = api.runtime.tools.createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        if (!memorySearchTool || !memoryGetTool) return null;
        return [memorySearchTool, memoryGetTool];
      },
      { names: ["memory_search", "memory_get"] },
    );

    // ====================================================================
    // CLI Registration (same contract as memory-core)
    // ====================================================================
    api.registerCli(
      ({ program }) => {
        api.runtime.tools.registerMemoryCli(program);
      },
      { commands: ["memory"] },
    );

    // ====================================================================
    // Auto-Recall: inject relevant memories before each agent turn
    // ====================================================================
    if (autoRecall) {
      api.on("before_agent_start", async (event, ctx) => {
        const prompt = event.prompt;

        // Guard: prompt must exist and meet minimum meaningful length
        if (!prompt || prompt.length < MIN_PROMPT_LENGTH) return;

        // Guard: skip automated / non-interactive session triggers
        if (ctx.trigger && SKIP_TRIGGERS.has(ctx.trigger)) return;

        // Guard: skip slash commands (start with /)
        const trimmedPrompt = prompt.trimStart();
        if (trimmedPrompt.startsWith("/")) return;

        // Guard: session key is required to scope the memory search correctly
        if (!ctx.sessionKey) return;

        try {
          const memorySearchTool = api.runtime.tools.createMemorySearchTool({
            config: api.config,
            agentSessionKey: ctx.sessionKey,
          });

          if (!memorySearchTool) {
            api.logger.debug?.(
              "memory-unified: no memory search tool available, skipping auto-recall",
            );
            return;
          }

          let timeoutTimer: NodeJS.Timeout | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(
              () =>
                reject(
                  new Error(`memory-unified: auto-recall timed out after ${recallTimeoutMs}ms`),
                ),
              recallTimeoutMs,
            );
          });

          // Race the search against a hard timeout so we never block the agent.
          const rawResult = await Promise.race([
            memorySearchTool.execute(`auto-recall-${Date.now()}`, {
              query: trimmedPrompt,
              maxResults: recallMaxResults,
              minScore: recallMinScore,
            }),
            timeoutPromise,
          ]).finally(() => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
          });

          if (!rawResult || typeof rawResult !== "string") return;

          let parsed: { results?: MemoryResult[] };
          try {
            parsed = JSON.parse(rawResult);
          } catch {
            return;
          }

          const results = parsed?.results;
          if (!results || !Array.isArray(results) || results.length === 0) return;

          // Format results as an XML-style context block for easy agent parsing
          const formattedMemories = results
            .map((r, i) => {
              const locationHint = r.path ? ` (${r.path})` : "";
              const snippet = r.snippet ?? "";
              return `[${i + 1}]${locationHint}\n${snippet}`;
            })
            .join("\n\n");

          const contextBlock =
            `<auto-recalled-memories>\n` +
            `The following memories were automatically retrieved based on your current message.\n` +
            `Use them if relevant; ignore if not.\n\n` +
            `${formattedMemories}\n` +
            `</auto-recalled-memories>`;

          api.logger.info?.(`memory-unified: injecting ${results.length} auto-recalled memories`);

          return { prependContext: contextBlock };
        } catch (err: unknown) {
          // Non-fatal — log and let the agent continue without auto-recalled memories
          const message = err instanceof Error ? err.message : String(err);
          api.logger.warn?.(`memory-unified: auto-recall failed: ${message}`);
        }
      });
    }

    // ====================================================================
    // Alignment Drift Scoring: evaluate response against SOUL/IDENTITY
    // ====================================================================
    if (alignmentEnabled) {
      // Reset per-session state when a new session starts
      api.on("session_start", () => {
        alignmentState = createAlignmentState();
      });

      api.on("before_agent_start", async (event, ctx) => {
        // Guard: skip automated / non-interactive session triggers
        if (ctx.trigger && SKIP_TRIGGERS.has(ctx.trigger)) return;

        // Guard: skip slash commands
        const trimmedPrompt = event.prompt?.trimStart();
        if (trimmedPrompt?.startsWith("/")) return;

        // Advance turn counter (always, even if we skip this check cycle)
        alignmentState = advanceTurn(alignmentState);

        // Respect cooldown
        if (!shouldCheck(alignmentState, alignmentConfig)) return;

        // Need the last assistant message to score against
        const lastResponse = extractLastAssistantText(event.messages);
        if (!lastResponse) return;

        // Need a workspace dir to locate SOUL.md / IDENTITY.md
        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) return;

        // Need a Gemini API key to run the LLM scoring call
        const apiKey = process.env.GEMINI_API_KEY || process.env.BYTEROVER_GEMINI_KEY;
        if (!apiKey) {
          api.logger.debug?.("memory-unified: no Gemini API key, skipping alignment check");
          return;
        }

        try {
          const [soulContent, identityContent] = await Promise.all([
            readTextFileOrEmpty(path.join(workspaceDir, "SOUL.md")),
            readTextFileOrEmpty(path.join(workspaceDir, "IDENTITY.md")),
          ]);

          if (!soulContent && !identityContent) return;

          const identityRules = identityContent ? extractCriticalRules(identityContent) : "";
          const llmCall = createGeminiAlignmentCall(apiKey);

          const result = await scoreAlignment({
            soulContent: soulContent || "(No SOUL.md found)",
            identityRules: identityRules || "(No CRITICAL rules found)",
            lastResponse,
            llmCall,
            config: alignmentConfig,
          });

          if (!result) return; // LLM call failed / timed out — skip silently

          const correctionContext = buildCorrectionContext(result, alignmentConfig);
          const shouldInjectCorrection = correctionContext !== null && !alignmentObserveOnly;

          alignmentState = recordCheck(
            alignmentState,
            result.score,
            shouldInjectCorrection,
            alignmentConfig,
          );

          const logEntry = formatAlignmentLogEntry({
            result,
            correctionInjected: shouldInjectCorrection,
            turnNumber: alignmentState.turnNumber,
          });

          api.logger.info?.(
            `memory-unified: alignment check — score=${result.score.toFixed(2)} ` +
              `violations=${result.violations.length} ` +
              `corrected=${shouldInjectCorrection} ` +
              `mode=${alignmentObserveOnly ? "observe" : "active"}`,
          );
          api.logger.debug?.(`memory-unified: alignment details: ${JSON.stringify(logEntry)}`);

          if (shouldInjectCorrection && correctionContext) {
            return { prependContext: correctionContext };
          }
        } catch (err: unknown) {
          // Non-fatal — agent continues without alignment correction
          const message = err instanceof Error ? err.message : String(err);
          api.logger.warn?.(`memory-unified: alignment check failed: ${message}`);
        }
      });
    }
  },
};

export default memoryUnifiedPlugin;
