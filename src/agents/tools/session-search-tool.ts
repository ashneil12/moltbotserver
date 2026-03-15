/**
 * Session Search Tool
 *
 * Exposes the session FTS5 search index as an agent tool, allowing agents to
 * search across past conversation history using exact keyword/phrase matching.
 * Complements memory_search (semantic/vector) with precise text retrieval.
 *
 * Hermes-inspired upgrade: search results are grouped by session, then each
 * matching session's transcript is summarized by a cheap model (e.g. Gemini
 * Flash Lite) to return query-focused per-session summaries instead of raw
 * message fragments.
 *
 * Inspired by NousResearch/hermes-agent session_search_tool.py.
 */

import { Type } from "@sinclair/typebox";
import {
  SessionSearchIndex,
  type SessionSearchOptions,
  type SessionSearchResult,
} from "../../auto-reply/reply/session-search.js";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

const log = createSubsystemLogger("session-search-tool");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max chars per session to send to the summarizer (prevents token explosion) */
const MAX_SESSION_CHARS = 100_000;

/** Timeout for a single session summarization call */
const SUMMARIZE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callback for LLM summarization of a session transcript.
 * Injected by the tool factory caller so the tool itself remains model-agnostic.
 * Returns a focused summary string, or undefined to skip summarization.
 */
export type SessionSummarizeCallback = (params: {
  sessionTranscript: string;
  query: string;
  sessionMeta: {
    sessionId: string;
    startedAt?: string;
    channel?: string;
  };
}) => Promise<string | undefined>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a conversation transcript to maxChars, centered around where
 * the query terms appear. Keeps content near matches, trims the edges.
 *
 * Ported from NousResearch/hermes-agent _truncate_around_matches.
 * @internal Exported for testing.
 */
export function truncateAroundMatches(
  fullText: string,
  query: string,
  maxChars: number = MAX_SESSION_CHARS,
): string {
  if (fullText.length <= maxChars) {
    return fullText;
  }

  // Find the first occurrence of any query term
  const queryTerms = query.toLowerCase().split(/\s+/);
  const textLower = fullText.toLowerCase();
  let firstMatch = fullText.length;
  for (const term of queryTerms) {
    const pos = textLower.indexOf(term);
    if (pos !== -1 && pos < firstMatch) {
      firstMatch = pos;
    }
  }

  if (firstMatch === fullText.length) {
    firstMatch = 0; // No match found, take from start
  }

  // Center the window around the first match
  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, firstMatch - half);
  let end = Math.min(fullText.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }

  const truncated = fullText.slice(start, end);
  const prefix = start > 0 ? "...[earlier conversation truncated]...\n\n" : "";
  const suffix = end < fullText.length ? "\n\n...[later conversation truncated]..." : "";
  return prefix + truncated + suffix;
}

// ---------------------------------------------------------------------------
// Query rewriting (OpenViking-inspired)
// ---------------------------------------------------------------------------

/** Minimum word length to include in OR-expanded variant */
const MIN_EXPAND_WORD_LEN = 3;

/** Max words to include in OR expansion (avoids overly broad queries) */
const MAX_EXPAND_WORDS = 6;

/**
 * Expand a query into multiple variants for improved recall.
 * Produces the original query plus an OR-expanded variant.
 * Does NOT use an LLM — purely mechanical rewriting.
 * @internal Exported for testing.
 */
export function expandQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const variants: string[] = [trimmed];

  // Already contains explicit OR/AND → user knows FTS5 syntax, don't rewrite
  if (/\b(OR|AND)\b/i.test(trimmed)) {
    return variants;
  }

  // Quoted phrase → keep as-is, don't expand
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return variants;
  }

  // Split into words, filter short/stop words
  const words = trimmed
    .split(/\s+/)
    .filter((w) => w.length >= MIN_EXPAND_WORD_LEN)
    .slice(0, MAX_EXPAND_WORDS);

  // Only expand if 2+ meaningful words (single-word queries don't benefit)
  if (words.length >= 2) {
    variants.push(words.join(" OR "));
  }

  return variants;
}

/**
 * Merge search results from multiple query variants.
 * Deduplicates by sessionId+content, keeps best rank per entry.
 * @internal Exported for testing.
 */
export function mergeSearchResults(resultSets: SessionSearchResult[][]): SessionSearchResult[] {
  if (resultSets.length <= 1) {
    return resultSets[0] ?? [];
  }

  const seen = new Map<string, SessionSearchResult>();

  for (const results of resultSets) {
    for (const r of results) {
      const key = `${r.sessionId}:${r.timestamp}:${r.role}`;
      const existing = seen.get(key);
      // Keep result with better (lower/more negative) rank
      if (!existing || r.rank < existing.rank) {
        seen.set(key, r);
      }
    }
  }

  // Sort by rank (lower = better)
  return [...seen.values()].toSorted((a, b) => a.rank - b.rank);
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) {
    return "unknown";
  }
  try {
    return new Date(ts)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC");
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SessionSearchSchema = Type.Object({
  query: Type.String({
    description:
      "Search query — keywords, phrases, or boolean expressions to find in past sessions. " +
      "Use OR between keywords for broad recall (docker OR networking), " +
      'quoted phrases for exact match ("docker networking"). ' +
      "FTS5 defaults to AND which may miss sessions.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Max sessions to summarize. Default: 3, max: 5.",
      minimum: 1,
      maximum: 5,
    }),
  ),
  role_filter: Type.Optional(
    Type.String({
      description:
        "Only search messages from specific roles (comma-separated). E.g. 'user,assistant' to skip tool outputs.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createSessionSearchTool(options: {
  config?: OpenClawConfig;
  agentId?: string;
  /** Whether the requester is a sub-agent (limits search to own agent) */
  isSubagent?: boolean;
  /** Current session ID — excluded from search results */
  currentSessionId?: string;
  /** Optional LLM summarization callback. When provided, search results are
   *  summarized per-session instead of returning raw message fragments. */
  summarize?: SessionSummarizeCallback;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  const agentId = options.agentId;
  const workspaceDir = agentId
    ? resolveAgentWorkspaceDir(cfg, agentId)
    : DEFAULT_AGENT_WORKSPACE_DIR;

  return {
    label: "Session Search",
    name: "session_search",
    description:
      "Search your long-term memory of past conversations. This is your recall — " +
      "every past session is searchable, and this tool summarizes what happened.\n\n" +
      "USE THIS PROACTIVELY when:\n" +
      "- The user says 'we did this before', 'remember when', 'last time', 'as I mentioned'\n" +
      "- The user asks about a topic you worked on before but don't have in current context\n" +
      "- The user references a project, person, or concept that seems familiar but isn't in memory\n" +
      "- You want to check if you've solved a similar problem before\n" +
      "- The user asks 'what did we do about X?' or 'how did we fix Y?'\n\n" +
      "Don't hesitate to search — it's fast and cheap. " +
      "Better to search and confirm than to guess or ask the user to repeat themselves.",
    parameters: SessionSearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const sessionLimit = Math.min(readNumberParam(params, "limit") ?? 3, 5);
      const roleFilter = readStringParam(params, "role_filter");
      const roleSet = roleFilter
        ? new Set(
            roleFilter
              .split(",")
              .map((r) => r.trim().toLowerCase())
              .filter(Boolean),
          )
        : undefined;

      const index = SessionSearchIndex.open(workspaceDir);
      if (!index) {
        return jsonResult({
          results: [],
          disabled: true,
          error: "Session search unavailable (SQLite not available)",
        });
      }

      // Sub-agents can only search their own sessions
      const effectiveAgentId = options.isSubagent ? (agentId ?? undefined) : undefined;

      const searchOptions: SessionSearchOptions = {
        limit: 50, // Fetch more to find unique sessions
        agentId: effectiveAgentId,
        excludeSessionId: options.currentSessionId,
        includeContext: !options.summarize, // Only include context if not summarizing
      };

      try {
        // Multi-query expansion: run original + OR-expanded variants
        const queryVariants = expandQuery(query);
        const resultSets = queryVariants.map((q) => index.search(q, searchOptions));
        let results = mergeSearchResults(resultSets);

        // Apply role filter if specified (e.g. "user,assistant" to skip tool outputs)
        if (roleSet) {
          results = results.filter((r) => roleSet.has(r.role.toLowerCase()));
        }

        const totalMessages = index.count(effectiveAgentId);

        if (results.length === 0) {
          return jsonResult({
            results: [],
            totalIndexed: totalMessages,
            count: 0,
            message: "No matching sessions found.",
          });
        }

        // Dedup to unique sessions
        const uniqueSessionIds = index.getUniqueSessionIds(
          results,
          sessionLimit,
          options.currentSessionId,
        );

        // --- Summarization path (Hermes-style) ---
        if (options.summarize && uniqueSessionIds.length > 0) {
          const summaries: Array<{
            sessionId: string;
            when: string;
            channel?: string;
            summary: string;
          }> = [];

          // Summarize sessions in parallel
          const summarizePromises = uniqueSessionIds.map(async (sessionId) => {
            try {
              const transcript = index.getSessionTranscript(sessionId);
              if (!transcript) {
                return null;
              }

              const startedAt = index.getSessionStartTime(sessionId);
              const truncated = truncateAroundMatches(transcript, query);

              // Find the channel from the first matching result for this session
              const matchInfo = results.find((r) => r.sessionId === sessionId);

              const summary = await Promise.race([
                options.summarize!({
                  sessionTranscript: truncated,
                  query,
                  sessionMeta: {
                    sessionId,
                    startedAt: formatTimestamp(startedAt),
                    channel: matchInfo?.channel,
                  },
                }),
                new Promise<undefined>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Summarization timed out")),
                    SUMMARIZE_TIMEOUT_MS,
                  ),
                ),
              ]);

              if (summary) {
                return {
                  sessionId,
                  when: formatTimestamp(startedAt),
                  channel: matchInfo?.channel,
                  summary,
                };
              }
            } catch (err) {
              log.warn(`session summarization failed for ${sessionId}: ${String(err)}`);
            }
            return null;
          });

          const settled = await Promise.allSettled(summarizePromises);
          for (const result of settled) {
            if (result.status === "fulfilled" && result.value) {
              summaries.push(result.value);
            }
          }

          if (summaries.length > 0) {
            return jsonResult({
              results: summaries,
              count: summaries.length,
              sessionsSearched: uniqueSessionIds.length,
              totalIndexed: totalMessages,
              fts: index.isFtsAvailable,
            });
          }

          // Fall through to raw results if all summaries failed
          log.warn("all session summaries failed, falling back to raw results");
        }

        // --- Raw results path (fallback / no summarizer) ---
        return jsonResult({
          results: results.slice(0, sessionLimit * 5).map((r) => ({
            sessionId: r.sessionId,
            role: r.role,
            content: r.content.slice(0, 500),
            timestamp: new Date(r.timestamp).toISOString(),
            channel: r.channel,
            ...(r.context ? { context: r.context } : {}),
          })),
          totalIndexed: totalMessages,
          count: Math.min(results.length, sessionLimit * 5),
          fts: index.isFtsAvailable,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          results: [],
          error: message,
        });
      }
    },
  };
}
