/**
 * Recall Message Tool
 *
 * Allows searching the full conversation archive for specific messages or topics.
 * Use when the user asks "what did I say about X last month?" or "find our conversation about Y".
 */

import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const RecallMessageSchema = Type.Object({
  query: Type.String({
    description:
      "Search query - what to look for in the conversation archive (e.g., 'API design', 'project deadline').",
  }),
  timeframe: Type.Optional(
    Type.String({
      description:
        "Optional timeframe filter like 'today', 'yesterday', 'last week', 'last month', 'January', or '2 months ago'.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (default: 5, max: 20).",
      minimum: 1,
      maximum: MAX_LIMIT,
    }),
  ),
});

export interface RecallResult {
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  relevanceScore: number;
  source: "archive" | "history";
}

interface QmdResult {
  content: string;
  score: number;
  metadata?: {
    timestamp?: string;
    role?: string;
    source?: string;
  };
}

/**
 * Parse timeframe string into date range for filtering.
 */
function parseTimeframe(timeframe: string): { start: Date; end: Date } | null {
  const now = new Date();
  const lower = timeframe.toLowerCase().trim();

  // Common timeframe shortcuts
  if (lower === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end: now };
  }

  if (lower === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end };
  }

  if (lower === "last week" || lower === "past week") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  if (lower === "last month" || lower === "past month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    return { start, end: now };
  }

  if (lower === "last year" || lower === "past year") {
    const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    return { start, end: now };
  }

  // Month names
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthAbbr = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  for (let i = 0; i < monthNames.length; i++) {
    if (lower.includes(monthNames[i]) || lower.includes(monthAbbr[i])) {
      // Check if current year or last year
      const month = i;
      let year = now.getFullYear();
      // If the month is in the future, assume last year
      if (month > now.getMonth()) {
        year--;
      }
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59); // Last day of month
      return { start, end };
    }
  }

  // Relative patterns: "2 months ago", "3 weeks ago"
  const relativeMatch = lower.match(/(\d+)\s*(day|week|month|year)s?\s*ago/);
  if (relativeMatch) {
    const count = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    let start: Date;

    switch (unit) {
      case "day":
        start = new Date(now.getTime() - count * 24 * 60 * 60 * 1000);
        break;
      case "week":
        start = new Date(now.getTime() - count * 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        start = new Date(now.getFullYear(), now.getMonth() - count, now.getDate());
        break;
      case "year":
        start = new Date(now.getFullYear() - count, now.getMonth(), now.getDate());
        break;
      default:
        return null;
    }
    return { start, end: now };
  }

  return null;
}

/**
 * Run QMD query via subprocess.
 */
async function runQmdQuery(
  query: string,
  workspaceDir: string,
  limit: number,
): Promise<QmdResult[]> {
  return new Promise((resolve) => {
    const results: QmdResult[] = [];

    try {
      const proc = spawn("qmd", ["query", query, "--limit", String(limit)], {
        cwd: workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
      });

      let stdout = "";
      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", () => {
        // Parse QMD output (format varies, handle gracefully)
        const lines = stdout.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          // Skip header/info lines
          if (
            line.startsWith("Searching") ||
            line.startsWith("Found") ||
            line.startsWith("---")
          ) {
            continue;
          }

          // Try to parse as result
          const trimmed = line.trim();
          if (trimmed) {
            results.push({
              content: trimmed,
              score: 0.5, // Default score if not provided
            });
          }
        }
        resolve(results);
      });

      proc.on("error", () => {
        resolve([]);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Search conversation files directly (fallback when QMD unavailable).
 */
async function searchConversationFiles(
  query: string,
  workspaceDir: string,
  limit: number,
): Promise<RecallResult[]> {
  const results: RecallResult[] = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

  // Files to search
  const files = ["conversation_history.md", "conversation_archive.md"];

  for (const filename of files) {
    const filepath = path.join(workspaceDir, filename);
    try {
      const content = await fs.readFile(filepath, "utf-8");
      const source = filename.includes("archive") ? "archive" : "history";

      // Parse messages from markdown
      // Expected format: ## YYYY-MM-DD HH:MM:SS - Role\nContent...
      const messagePattern = /## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (user|assistant)\n([\s\S]*?)(?=\n## |\n---|\$)/gi;
      let match: RegExpExecArray | null;

      while ((match = messagePattern.exec(content)) !== null) {
        const timestamp = match[1];
        const role = match[2].toLowerCase() as "user" | "assistant";
        const messageContent = match[3].trim();

        // Check if message matches query
        const contentLower = messageContent.toLowerCase();
        const matchingTerms = queryTerms.filter((term) => contentLower.includes(term));

        if (matchingTerms.length > 0 || contentLower.includes(queryLower)) {
          const score = matchingTerms.length / queryTerms.length || 0.5;
          results.push({
            timestamp,
            role,
            content: messageContent.slice(0, 500) + (messageContent.length > 500 ? "..." : ""),
            relevanceScore: Math.min(1, score),
            source: source as "archive" | "history",
          });
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  // Sort by relevance and limit
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.slice(0, limit);
}

/**
 * Filter results by timeframe.
 */
function filterByTimeframe(
  results: RecallResult[],
  timeframe: string,
): RecallResult[] {
  const range = parseTimeframe(timeframe);
  if (!range) {
    return results;
  }

  return results.filter((r) => {
    try {
      const date = new Date(r.timestamp);
      return date >= range.start && date <= range.end;
    } catch {
      return true; // Keep if can't parse
    }
  });
}

export function createRecallMessageTool(options?: {
  workspaceDir?: string;
}): AnyAgentTool {
  return {
    label: "Recall Message",
    name: "recall_message",
    description:
      "Search the full conversation archive for specific messages or topics. Use when the user asks 'what did I say about X last month?' or 'find our conversation about Y'. This searches both recent history and archived messages.",
    parameters: RecallMessageSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const timeframe = readStringParam(params, "timeframe");
      const rawLimit = readNumberParam(params, "limit", { integer: true });
      const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit ?? DEFAULT_LIMIT));

      const workspaceDir = options?.workspaceDir || process.cwd();

      // Try QMD first
      const qmdResults = await runQmdQuery(query, workspaceDir, limit * 2);

      let results: RecallResult[];

      if (qmdResults.length > 0) {
        // Convert QMD results to RecallResults
        results = qmdResults.slice(0, limit).map((r) => ({
          timestamp: r.metadata?.timestamp || "unknown",
          role: (r.metadata?.role as "user" | "assistant") || "user",
          content: r.content.slice(0, 500) + (r.content.length > 500 ? "..." : ""),
          relevanceScore: r.score,
          source: (r.metadata?.source as "archive" | "history") || "archive",
        }));
      } else {
        // Fallback to direct file search
        results = await searchConversationFiles(query, workspaceDir, limit);
      }

      // Apply timeframe filter if specified
      if (timeframe) {
        results = filterByTimeframe(results, timeframe);
      }

      if (results.length === 0) {
        return jsonResult({
          query,
          timeframe: timeframe || null,
          found: 0,
          message: `No messages found matching "${query}"${timeframe ? ` within ${timeframe}` : ""}.`,
          results: [],
        });
      }

      return jsonResult({
        query,
        timeframe: timeframe || null,
        found: results.length,
        results,
      });
    },
  };
}
