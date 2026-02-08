/**
 * Memory Manager Agent
 *
 * Searches long-term memory via QMD and decides what memories to inject
 * into the orchestrator's context. Returns N/A for casual conversation.
 */

import type {
  MemoryManagerInput,
  MemoryManagerOutput,
  ContextMessage,
} from "./assembler-types.js";
import { estimateTokenCount } from "./assembler-types.js";

/**
 * Patterns that indicate casual conversation not needing memory injection.
 */
const CASUAL_PATTERNS = [
  /^(hi|hey|hello|yo|sup|hola)\s*[!?.]*$/i,
  /^(how are you|how's it going|what's up|whats up)\s*[?!.]*$/i,
  /^(good morning|good afternoon|good evening|good night)\s*[!?.]*$/i,
  /^(thanks|thank you|thx|ty)\s*[!?.]*$/i,
  /^(bye|goodbye|see you|later|cya)\s*[!?.]*$/i,
  /^(ok|okay|sure|alright|got it|understood)\s*[!?.]*$/i,
  /^(yes|no|yeah|yep|nope|nah)\s*[!?.]*$/i,
  /^(lol|haha|hehe|lmao|rofl)\s*[!?.]*$/i,
];

/**
 * Check if message appears to be casual conversation.
 */
function isCasualMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 3) return true;
  if (trimmed.length > 100) return false; // Longer messages likely have substance

  return CASUAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Format recent messages for context in the search query.
 */
function formatRecentContext(messages: ContextMessage[]): string {
  if (messages.length === 0) return "";

  return messages
    .slice(-3)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");
}

/**
 * Build a search query from the current message and recent context.
 */
function buildSearchQuery(input: MemoryManagerInput): string {
  // Start with the current message
  let query = input.currentMessage.trim();

  // If context helps, append key terms from recent messages
  if (input.recentMessages.length > 0) {
    const recentText = input.recentMessages
      .slice(-2)
      .map((m) => m.content)
      .join(" ");

    // Extract important nouns/terms (simple heuristic: words > 4 chars)
    const terms = recentText
      .split(/\s+/)
      .filter((w) => w.length > 4 && /^[a-zA-Z]+$/.test(w))
      .slice(0, 5);

    if (terms.length > 0) {
      query += " " + terms.join(" ");
    }
  }

  // Limit query length
  return query.slice(0, 500);
}

/**
 * Memory search result from QMD.
 */
interface MemorySearchResult {
  path: string;
  snippet: string;
  score: number;
}

/**
 * Search memories using QMD.
 * This is a thin wrapper that will be called with the actual QMD manager.
 */
export type QmdSearchFunction = (
  query: string,
  opts?: { maxResults?: number; minScore?: number },
) => Promise<MemorySearchResult[]>;

/**
 * Run the Memory Manager agent.
 *
 * @param input - The input containing current message and context
 * @param searchFn - Function to search memories (QMD search)
 * @param maxTokens - Maximum tokens for memory injection
 * @returns MemoryManagerOutput with memories or N/A
 */
export async function runMemoryManager(
  input: MemoryManagerInput,
  searchFn: QmdSearchFunction,
  maxTokens: number = 1500,
): Promise<MemoryManagerOutput> {
  // Fast path: Skip for casual messages
  if (isCasualMessage(input.currentMessage)) {
    return {
      memories: null,
      tokenCount: 0,
      injected: false,
    };
  }

  try {
    // Build and execute search query
    const query = buildSearchQuery(input);
    const results = await searchFn(query, {
      maxResults: 10, // Get more initially, then filter
      minScore: 0.3,
    });

    if (!results || results.length === 0) {
      return {
        memories: null,
        tokenCount: 0,
        injected: false,
      };
    }

    // Filter and deduplicate by content
    const seen = new Set<string>();
    const memories: string[] = [];
    let totalTokens = 0;

    for (const result of results) {
      const snippet = result.snippet?.trim();
      if (!snippet || seen.has(snippet)) continue;

      const tokens = estimateTokenCount(snippet);
      if (totalTokens + tokens > maxTokens) break;

      seen.add(snippet);
      memories.push(snippet);
      totalTokens += tokens;

      // Limit to 6 memories max
      if (memories.length >= 6) break;
    }

    if (memories.length === 0) {
      return {
        memories: null,
        tokenCount: 0,
        injected: false,
      };
    }

    return {
      memories,
      tokenCount: totalTokens,
      injected: true,
    };
  } catch (err) {
    // Log but don't fail - memory injection is optional
    console.error("[memory-manager] Search failed:", err);
    return {
      memories: null,
      tokenCount: 0,
      injected: false,
    };
  }
}

/**
 * Create a Memory Manager with a bound QMD search function.
 */
export function createMemoryManager(searchFn: QmdSearchFunction) {
  return (input: MemoryManagerInput, maxTokens?: number) =>
    runMemoryManager(input, searchFn, maxTokens);
}
