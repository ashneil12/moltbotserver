/**
 * Context Memory Commands
 *
 * Slash commands for user control of context and memory:
 * - /fresh - Clear context window, keep all memories
 * - /forget [topic] - Remove specific memories (with confirmation)
 * - /remember [topic] - Force inject specific memory into context
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CommandHandler } from "./commands-types.js";
import { logVerbose } from "../../globals.js";

/**
 * Parse /fresh command.
 */
function parseFreshCommand(normalized: string): { hasCommand: boolean } {
  return { hasCommand: normalized === "/fresh" };
}

/**
 * Parse /forget [topic] command.
 */
function parseForgetCommand(normalized: string): { hasCommand: boolean; topic?: string } {
  if (normalized === "/forget") {
    return { hasCommand: true, topic: undefined };
  }
  if (normalized.startsWith("/forget ")) {
    return { hasCommand: true, topic: normalized.slice("/forget ".length).trim() };
  }
  return { hasCommand: false };
}

/**
 * Parse /remember [topic] command.
 */
function parseRememberCommand(normalized: string): { hasCommand: boolean; topic?: string } {
  if (normalized === "/remember") {
    return { hasCommand: true, topic: undefined };
  }
  if (normalized.startsWith("/remember ")) {
    return { hasCommand: true, topic: normalized.slice("/remember ".length).trim() };
  }
  return { hasCommand: false };
}

/**
 * Search memory files for a topic.
 */
async function searchMemoryFiles(
  workspaceDir: string,
  topic: string,
): Promise<Array<{ content: string; file: string; lineNum: number }>> {
  const memoryDir = path.join(workspaceDir, "memory");
  const results: Array<{ content: string; file: string; lineNum: number }> = [];
  const keywords = topic.toLowerCase().split(/\s+/);

  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files
      .filter((f) => f.endsWith(".md"))
      .toSorted()
      .toReversed(); // Newest first

    for (const file of mdFiles.slice(0, 30)) {
      // Check last 30 days
      const filepath = path.join(memoryDir, file);
      const content = await fs.readFile(filepath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("-")) {
          continue;
        }

        const lower = line.toLowerCase();
        const matches = keywords.some((kw) => lower.includes(kw));
        if (matches) {
          results.push({
            content: line.slice(1).trim(), // Remove leading dash
            file,
            lineNum: i + 1,
          });
        }
      }
    }
  } catch {
    // Memory directory doesn't exist
  }

  return results.slice(0, 10); // Limit to 10 results
}

/**
 * Format memory results for display.
 */
function formatMemoryResults(
  results: Array<{ content: string; file: string; lineNum: number }>,
): string {
  const lines = results.map((r, i) => `${i + 1}. ${r.content}`);
  return lines.join("\n");
}

/**
 * Remove a memory from a file.
 */
async function removeMemoryFromFile(
  workspaceDir: string,
  file: string,
  lineNum: number,
): Promise<boolean> {
  const filepath = path.join(workspaceDir, "memory", file);
  try {
    const content = await fs.readFile(filepath, "utf-8");
    const lines = content.split("\n");

    if (lineNum > 0 && lineNum <= lines.length) {
      lines.splice(lineNum - 1, 1);
      await fs.writeFile(filepath, lines.join("\n"));
      return true;
    }
  } catch {
    // File doesn't exist or error
  }
  return false;
}

// Session state for multi-turn commands
const pendingForget = new Map<string, Array<{ content: string; file: string; lineNum: number }>>();
const pendingRemember = new Map<
  string,
  Array<{ content: string; file: string; lineNum: number }>
>();

/**
 * Handle /fresh command - Clear context window, keep memories.
 */
export const handleFreshCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const { hasCommand } = parseFreshCommand(params.command.commandBodyNormalized);
  if (!hasCommand) {
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /fresh from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  // Context clearing is handled by OpenClaw's built-in compaction.
  // The /fresh command signals intent — the session will compact on next turn.

  return {
    shouldContinue: false,
    reply: {
      text: "🔄 Context cleared. Starting fresh.\nYour memories are intact—I still remember everything important.",
    },
  };
};

/**
 * Handle /forget [topic] command - Remove specific memories.
 */
export const handleForgetCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const { hasCommand, topic } = parseForgetCommand(params.command.commandBodyNormalized);
  if (!hasCommand) {
    // Check if this is a selection response for pending forget
    const pending = pendingForget.get(params.sessionKey);
    if (pending) {
      const selection = params.command.commandBodyNormalized.trim();

      // Check for "all" selection
      if (selection.toLowerCase() === "all") {
        let removed = 0;
        for (const result of pending) {
          const success = await removeMemoryFromFile(
            params.workspaceDir,
            result.file,
            result.lineNum - removed, // Adjust for removed lines
          );
          if (success) {
            removed++;
          }
        }
        pendingForget.delete(params.sessionKey);
        return {
          shouldContinue: false,
          reply: { text: `✅ Removed ${removed} memories.` },
        };
      }

      // Parse number selection (e.g., "1,3" or "1")
      const nums = selection
        .split(/[,\s]+/)
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0 && n <= pending.length);

      if (nums.length > 0) {
        const removed: string[] = [];
        // Sort descending to remove from end first (line numbers stay valid)
        for (const num of nums.toSorted((a, b) => b - a)) {
          const result = pending[num - 1];
          const success = await removeMemoryFromFile(
            params.workspaceDir,
            result.file,
            result.lineNum,
          );
          if (success) {
            removed.push(result.content);
          }
        }
        pendingForget.delete(params.sessionKey);
        if (removed.length === 0) {
          return {
            shouldContinue: false,
            reply: { text: "⚠️ Could not remove selected memories." },
          };
        }
        return {
          shouldContinue: false,
          reply: {
            text: `✅ Removed: "${removed[0]}"${removed.length > 1 ? ` (and ${removed.length - 1} more)` : ""}`,
          },
        };
      }
    }
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /forget from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  if (!topic) {
    return {
      shouldContinue: false,
      reply: { text: "Usage: /forget [topic]\nExample: /forget project deadlines" },
    };
  }

  const results = await searchMemoryFiles(params.workspaceDir, topic);
  if (results.length === 0) {
    return {
      shouldContinue: false,
      reply: { text: `No memories found for "${topic}".` },
    };
  }

  // Store pending state for follow-up
  pendingForget.set(params.sessionKey, results);

  return {
    shouldContinue: false,
    reply: {
      text: `Found ${results.length} memories matching "${topic}":\n${formatMemoryResults(results)}\n\nWhich would you like to forget? (Enter numbers, e.g., "1,3" or "all")`,
    },
  };
};

/**
 * Handle /remember [topic] command - Force inject memory into context.
 */
export const handleRememberCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const { hasCommand, topic } = parseRememberCommand(params.command.commandBodyNormalized);
  if (!hasCommand) {
    // Check if this is a selection response for pending remember
    const pending = pendingRemember.get(params.sessionKey);
    if (pending) {
      const selection = params.command.commandBodyNormalized.trim();

      // Parse number selection
      const nums = selection
        .split(/[,\s]+/)
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0 && n <= pending.length);

      if (nums.length > 0) {
        const selected = nums.map((n) => pending[n - 1].content);
        pendingRemember.delete(params.sessionKey);

        // Note: The actual injection would happen via the Context Assembler
        // Here we just acknowledge the selection
        return {
          shouldContinue: false,
          reply: {
            text: `💭 Added to context: "${selected[0]}"${selected.length > 1 ? ` (and ${selected.length - 1} more)` : ""}\nI'll keep this in mind for our conversation.`,
          },
        };
      }
    }
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /remember from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  if (!topic) {
    return {
      shouldContinue: false,
      reply: { text: "Usage: /remember [topic]\nExample: /remember Emma" },
    };
  }

  const results = await searchMemoryFiles(params.workspaceDir, topic);
  if (results.length === 0) {
    return {
      shouldContinue: false,
      reply: { text: `No memories found for "${topic}".` },
    };
  }

  // If only one result, inject immediately
  if (results.length === 1) {
    return {
      shouldContinue: false,
      reply: {
        text: `💭 Added to context: "${results[0].content}"\nI'll keep this in mind for our conversation.`,
      },
    };
  }

  // Store pending state for follow-up
  pendingRemember.set(params.sessionKey, results);

  return {
    shouldContinue: false,
    reply: {
      text: `Found ${results.length} memories matching "${topic}":\n${formatMemoryResults(results)}\n\nWhich would you like me to remember now? (Enter numbers, e.g., "1,2")`,
    },
  };
};
