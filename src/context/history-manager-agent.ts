/**
 * History Manager Agent
 *
 * Reads conversation_history.md (messages 21-100), generates a summary,
 * and optionally selects specific relevant messages for injection.
 */

import fs from "node:fs/promises";
import type {
  HistoryManagerInput,
  HistoryManagerOutput,
  ContextMessage,
  SpecificMessage,
} from "./assembler-types.js";
import { estimateTokenCount } from "./assembler-types.js";

/**
 * Patterns that indicate casual conversation not needing history injection.
 */
const CASUAL_PATTERNS = [
  /^(hi|hey|hello|yo|sup|hola)\s*[!?.]*$/i,
  /^(how are you|how's it going|what's up|whats up)\s*[?!.]*$/i,
  /^(good morning|good afternoon|good evening|good night)\s*[!?.]*$/i,
  /^(thanks|thank you|thx|ty)\s*[!?.]*$/i,
  /^(bye|goodbye|see you|later|cya)\s*[!?.]*$/i,
  /^(ok|okay|sure|alright|got it|understood)\s*[!?.]*$/i,
];

/**
 * Check if message appears to be casual conversation.
 */
function isCasualMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 3) return true;
  if (trimmed.length > 100) return false;

  return CASUAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Parsed message from the history file.
 */
interface ParsedHistoryMessage {
  timestamp: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * Parse conversation_history.md into structured messages.
 */
function parseHistoryFile(content: string): ParsedHistoryMessage[] {
  const messages: ParsedHistoryMessage[] = [];
  const sections = content.split(/^---$/m).filter((s) => s.trim());

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Extract timestamp from ## [YYYY-MM-DD HH:MM:SS]
    const timestampMatch = trimmed.match(/## \[([^\]]+)\]/);
    const timestamp = timestampMatch?.[1] ?? "unknown";

    // Extract role and content
    const userMatch = trimmed.match(/\*\*User\*\*:\s*([\s\S]*)/);
    const assistantMatch = trimmed.match(/\*\*Assistant\*\*:\s*([\s\S]*)/);

    if (userMatch) {
      messages.push({
        timestamp,
        role: "user",
        content: userMatch[1].trim(),
      });
    } else if (assistantMatch) {
      messages.push({
        timestamp,
        role: "assistant",
        content: assistantMatch[1].trim(),
      });
    }
  }

  return messages;
}

/**
 * Generate a summary of the conversation history.
 * This is a heuristic-based summary, not LLM-generated (for speed).
 */
function generateSummary(
  messages: ParsedHistoryMessage[],
  maxTokens: number,
): string {
  if (messages.length === 0) {
    return "";
  }

  // Extract key topics from user messages
  const userMessages = messages.filter((m) => m.role === "user");
  const topics: string[] = [];
  const seenTopics = new Set<string>();

  for (const msg of userMessages) {
    // Extract key phrases (sentences or significant fragments)
    const sentences = msg.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    for (const sentence of sentences.slice(0, 2)) {
      const normalized = sentence.trim().toLowerCase().slice(0, 100);
      if (!seenTopics.has(normalized)) {
        seenTopics.add(normalized);
        topics.push(sentence.trim());
        if (topics.length >= 5) break;
      }
    }
    if (topics.length >= 5) break;
  }

  if (topics.length === 0) {
    return `The conversation covered ${messages.length} messages with general discussion.`;
  }

  // Build summary with topic mentions
  let summary = `Recent conversation (${messages.length} messages) covered: `;
  let summaryTokens = estimateTokenCount(summary);

  const includedTopics: string[] = [];
  for (const topic of topics) {
    const topicTokens = estimateTokenCount(topic + "; ");
    if (summaryTokens + topicTokens > maxTokens) break;
    includedTopics.push(topic);
    summaryTokens += topicTokens;
  }

  if (includedTopics.length === 0) {
    return `The conversation covered ${messages.length} messages with various topics.`;
  }

  summary += includedTopics.join("; ") + ".";
  return summary;
}

/**
 * Find specific messages relevant to the current query.
 */
function findRelevantMessages(
  messages: ParsedHistoryMessage[],
  currentMessage: string,
  recentMessages: ContextMessage[],
  maxTokens: number,
  maxCount: number,
): SpecificMessage[] {
  // Extract key terms from current message
  const keyTerms = currentMessage
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && /^[a-z]+$/i.test(w));

  if (keyTerms.length === 0) {
    return [];
  }

  // Score each message by keyword overlap
  const scored: Array<{ msg: ParsedHistoryMessage; score: number }> = [];

  for (const msg of messages) {
    const contentLower = msg.content.toLowerCase();
    let score = 0;

    for (const term of keyTerms) {
      if (contentLower.includes(term)) {
        score += 1;
      }
    }

    if (score > 0) {
      scored.push({ msg, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top matches within token budget
  const selected: SpecificMessage[] = [];
  let totalTokens = 0;

  for (const { msg } of scored) {
    const tokens = estimateTokenCount(msg.content);
    if (totalTokens + tokens > maxTokens) continue;
    if (selected.length >= maxCount) break;

    selected.push({
      reference: msg.timestamp,
      role: msg.role,
      content: msg.content.slice(0, 500), // Truncate long messages
    });
    totalTokens += tokens;
  }

  return selected;
}

/**
 * Run the History Manager agent.
 *
 * @param input - The input containing current message and history path
 * @param summaryMaxTokens - Maximum tokens for summary
 * @param specificMaxTokens - Maximum tokens for specific messages
 * @param maxSpecificMessages - Maximum number of specific messages
 * @returns HistoryManagerOutput with summary and/or specific messages
 */
export async function runHistoryManager(
  input: HistoryManagerInput,
  summaryMaxTokens: number = 500,
  specificMaxTokens: number = 1000,
  maxSpecificMessages: number = 5,
): Promise<HistoryManagerOutput> {
  // Fast path: Skip for casual messages
  if (isCasualMessage(input.currentMessage)) {
    return {
      summary: null,
      specificMessages: null,
      tokenCount: 0,
      injected: false,
    };
  }

  try {
    // Read history file
    let historyContent: string;
    try {
      historyContent = await fs.readFile(input.historyFilePath, "utf-8");
    } catch {
      // No history file yet - this is fine
      return {
        summary: null,
        specificMessages: null,
        tokenCount: 0,
        injected: false,
      };
    }

    // Parse messages
    const messages = parseHistoryFile(historyContent);
    if (messages.length === 0) {
      return {
        summary: null,
        specificMessages: null,
        tokenCount: 0,
        injected: false,
      };
    }

    // Generate summary
    const summary = generateSummary(messages, summaryMaxTokens);
    const summaryTokens = estimateTokenCount(summary);

    // Find relevant specific messages
    const specificMessages = findRelevantMessages(
      messages,
      input.currentMessage,
      input.recentMessages,
      specificMaxTokens,
      maxSpecificMessages,
    );
    const specificTokens = specificMessages.reduce(
      (acc, m) => acc + estimateTokenCount(m.content),
      0,
    );

    const hasSummary = summary.length > 0;
    const hasSpecific = specificMessages.length > 0;

    return {
      summary: hasSummary ? summary : null,
      specificMessages: hasSpecific ? specificMessages : null,
      tokenCount: summaryTokens + specificTokens,
      injected: hasSummary || hasSpecific,
    };
  } catch (err) {
    // Log but don't fail - history injection is optional
    console.error("[history-manager] Processing failed:", err);
    return {
      summary: null,
      specificMessages: null,
      tokenCount: 0,
      injected: false,
    };
  }
}

/**
 * Create a History Manager with default token limits.
 */
export function createHistoryManager(
  summaryMaxTokens: number = 500,
  specificMaxTokens: number = 1000,
  maxSpecificMessages: number = 5,
) {
  return (input: HistoryManagerInput) =>
    runHistoryManager(input, summaryMaxTokens, specificMaxTokens, maxSpecificMessages);
}
