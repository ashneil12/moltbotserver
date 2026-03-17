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
 * - Skips recall for cron/heartbeat sessions, short prompts, and slash commands
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/memory-core";

/** Triggers that should NOT get auto-recall injection. */
const SKIP_TRIGGERS = new Set(["cron", "heartbeat", "memory"]);

/** Minimum prompt length to trigger auto-recall. */
const MIN_PROMPT_LENGTH = 10;

const memoryUnifiedPlugin = {
  id: "memory-unified",
  name: "Memory (Unified)",
  description: "Unified memory with per-turn auto-recall injection",
  kind: "memory" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as {
      autoRecall?: boolean;
      recallMaxResults?: number;
      recallMinScore?: number;
    };

    const autoRecall = pluginConfig.autoRecall !== false; // default: true
    const recallMaxResults = pluginConfig.recallMaxResults ?? 5;
    const recallMinScore = pluginConfig.recallMinScore ?? 0.3;

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
  },
};

export default memoryUnifiedPlugin;
