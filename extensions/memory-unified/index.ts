/**
 * OpenClaw Memory (Unified) Plugin
 *
 * Replaces memory-core with automatic per-turn memory injection.
 * Uses the existing memory search infrastructure (QMD/builtin)
 * to inject relevant memories before each agent turn via the
 * `before_agent_start` lifecycle hook.
 *
 * Features:
 * - Re-exports memory_search and memory_get tools (same as memory-core)
 * - Auto-recall: queries memory_search per turn and injects top results
 * - Alignment drift scoring: evaluates responses against SOUL.md/IDENTITY.md
 * - Skips recall for cron/heartbeat sessions, short prompts, and slash commands
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
} from "../../src/memory/alignment-scorer.js";
import {
  advanceTurn,
  createAlignmentState,
  recordCheck,
  shouldCheck,
  type AlignmentConfig,
  type AlignmentState,
} from "../../src/memory/alignment-state.js";

/** Triggers that should NOT get auto-recall injection. */
const SKIP_TRIGGERS = new Set(["cron", "heartbeat", "memory"]);

/** Minimum prompt length to trigger auto-recall. */
const MIN_PROMPT_LENGTH = 10;

/** Extract the last assistant message text from the messages array. */
function extractLastAssistantText(messages: unknown[] | undefined): string | null {
  if (!messages || messages.length === 0) {
    return null;
  }
  // Walk backwards to find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: string } | undefined;
    if (msg?.role === "assistant" && typeof msg.content === "string" && msg.content.trim()) {
      return msg.content;
    }
  }
  return null;
}

/** Extract CRITICAL rules section from IDENTITY.md content. */
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
      if (/^#+\s/.test(line) && !/CRITICAL/i.test(line)) {
        break; // Hit next non-CRITICAL section
      }
      criticalLines.push(line);
    }
  }

  return criticalLines.join("\n").trim();
}

/** Read a text file or return empty string if missing. */
async function readTextFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Create an alignment LLM call using Google Generative AI (Flash Lite).
 * Returns null if no API key is available.
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

      if (!response.ok) {
        return null;
      }

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
      alignmentCheck?: boolean;
      alignmentCheckObserveOnly?: boolean;
      alignmentCheckCooldownTurns?: number;
      alignmentCheckThreshold?: number;
    };

    const autoRecall = pluginConfig.autoRecall !== false; // default: true
    const recallMaxResults = pluginConfig.recallMaxResults ?? 5;
    const recallMinScore = pluginConfig.recallMinScore ?? 0.3;

    // Alignment scoring config
    const alignmentEnabled = pluginConfig.alignmentCheck === true; // default: false (opt-in)
    const alignmentObserveOnly = pluginConfig.alignmentCheckObserveOnly !== false; // default: true
    const alignmentConfig: AlignmentConfig = {
      enabled: alignmentEnabled,
      observeOnly: alignmentObserveOnly,
      cooldownTurns: pluginConfig.alignmentCheckCooldownTurns ?? 3,
      correctionThreshold: pluginConfig.alignmentCheckThreshold ?? 0.7,
    };

    // Per-plugin-instance alignment state (session-scoped)
    let alignmentState: AlignmentState = createAlignmentState();

    // ====================================================================
    // Tool Registration (same as memory-core)
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
        if (!memorySearchTool || !memoryGetTool) {
          return null;
        }
        return [memorySearchTool, memoryGetTool];
      },
      { names: ["memory_search", "memory_get"] },
    );

    // ====================================================================
    // CLI Registration (same as memory-core)
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

        // Guard: skip if prompt is too short or empty
        if (!prompt || prompt.length < MIN_PROMPT_LENGTH) {
          return;
        }

        // Guard: skip for cron, heartbeat, and memory-extraction runs
        if (ctx.trigger && SKIP_TRIGGERS.has(ctx.trigger)) {
          return;
        }

        // Guard: skip slash commands (start with /)
        const trimmedPrompt = prompt.trimStart();
        if (trimmedPrompt.startsWith("/")) {
          return;
        }

        // Guard: skip if no session key available (shouldn't happen, but be defensive)
        if (!ctx.sessionKey) {
          return;
        }

        try {
          // Create a memory search tool instance for this context
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

          // Invoke the tool's execute handler to perform the search.
          // Use trimmed prompt as query — strips leading/trailing whitespace for better search.
          const result = await memorySearchTool.execute(`auto-recall-${Date.now()}`, {
            query: trimmedPrompt,
            maxResults: recallMaxResults,
            minScore: recallMinScore,
          });

          // Parse the JSON result string
          if (!result || typeof result !== "string") {
            return;
          }

          let parsed: { results?: Array<{ path?: string; snippet?: string; score?: number }> };
          try {
            parsed = JSON.parse(result);
          } catch {
            return;
          }

          const results = parsed?.results;
          if (!results || !Array.isArray(results) || results.length === 0) {
            return;
          }

          // Format results as context block
          const formattedMemories = results
            .map((r, i) => {
              const path = r.path ? ` (${r.path})` : "";
              const snippet = r.snippet || "";
              return `[${i + 1}]${path}\n${snippet}`;
            })
            .join("\n\n");

          const contextBlock =
            `<auto-recalled-memories>\n` +
            `The following memories were automatically retrieved based on your current message.\n` +
            `Use them if relevant; ignore if not.\n\n` +
            `${formattedMemories}\n` +
            `</auto-recalled-memories>`;

          api.logger.info?.(`memory-unified: injecting ${results.length} recalled memories`);

          return {
            prependContext: contextBlock,
          };
        } catch (err: unknown) {
          // Non-fatal — agent continues without auto-recalled memories
          const message = err instanceof Error ? err.message : String(err);
          api.logger.warn?.(`memory-unified: auto-recall failed: ${message}`);
        }
      });
    }

    // ====================================================================
    // Alignment Drift Scoring: evaluate response against SOUL/IDENTITY
    // ====================================================================
    if (alignmentEnabled) {
      // Reset alignment state on session start
      api.on("session_start", () => {
        alignmentState = createAlignmentState();
      });

      api.on("before_agent_start", async (event, ctx) => {
        // Guard: skip for cron, heartbeat, memory-extraction runs
        if (ctx.trigger && SKIP_TRIGGERS.has(ctx.trigger)) {
          return;
        }

        // Guard: skip slash commands
        const trimmedPrompt = event.prompt?.trimStart();
        if (trimmedPrompt?.startsWith("/")) {
          return;
        }

        // Advance turn counter
        alignmentState = advanceTurn(alignmentState);

        // Check cooldown
        if (!shouldCheck(alignmentState, alignmentConfig)) {
          return;
        }

        // Guard: need messages to extract last assistant response
        const lastResponse = extractLastAssistantText(event.messages);
        if (!lastResponse) {
          return;
        }

        // Guard: need workspace dir for SOUL.md / IDENTITY.md
        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) {
          return;
        }

        // Guard: need Gemini API key
        const apiKey = process.env.GEMINI_API_KEY || process.env.BYTEROVER_GEMINI_KEY;
        if (!apiKey) {
          api.logger.debug?.("memory-unified: no Gemini API key, skipping alignment check");
          return;
        }

        try {
          // Read identity files
          const [soulContent, identityContent] = await Promise.all([
            readTextFileOrEmpty(path.join(workspaceDir, "SOUL.md")),
            readTextFileOrEmpty(path.join(workspaceDir, "IDENTITY.md")),
          ]);

          if (!soulContent && !identityContent) {
            return;
          }

          const identityRules = identityContent ? extractCriticalRules(identityContent) : "";
          const llmCall = createGeminiAlignmentCall(apiKey);

          const result = await scoreAlignment({
            soulContent: soulContent || "(No SOUL.md found)",
            identityRules: identityRules || "(No CRITICAL rules found)",
            lastResponse,
            llmCall,
            config: alignmentConfig,
          });

          if (!result) {
            // LLM call failed/timed out — skip silently
            return;
          }

          // Log the check
          const correctionContext = buildCorrectionContext(result, alignmentConfig);
          const shouldInjectCorrection = correctionContext !== null && !alignmentObserveOnly;

          // Record the check in state
          alignmentState = recordCheck(
            alignmentState,
            result.score,
            shouldInjectCorrection,
            alignmentConfig,
          );

          // Log structured entry
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

          // Inject correction if warranted and not in observe-only mode
          if (shouldInjectCorrection && correctionContext) {
            return { prependContext: correctionContext };
          }
        } catch (err: unknown) {
          // Non-fatal — agent continues without alignment check
          const message = err instanceof Error ? err.message : String(err);
          api.logger.warn?.(`memory-unified: alignment check failed: ${message}`);
        }
      });
    }
  },
};

export default memoryUnifiedPlugin;
