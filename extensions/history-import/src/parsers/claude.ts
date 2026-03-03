/**
 * Parser for Claude's conversation export format.
 *
 * Claude exports conversations with a `chat_messages` array containing
 * sender ("human" or "assistant") and text content. The format has evolved
 * over time, so we handle multiple variations.
 */

import type { NormalizedConversation, NormalizedMessage } from "../types.js";

// -- Raw Claude export types --

type ClaudeMessageContent =
  | string
  | { type?: string; text?: string }
  | Array<string | { type?: string; text?: string }>;

type ClaudeChatMessage = {
  uuid?: string;
  sender?: string;
  text?: string;
  content?: ClaudeMessageContent;
  created_at?: string;
  updated_at?: string;
};

type ClaudeConversation = {
  uuid?: string;
  name?: string;
  chat_messages?: ClaudeChatMessage[];
  created_at?: string;
  updated_at?: string;
};

// -- Parsing --

/**
 * Extract text content from a Claude message.
 * Handles both flat `text` field and structured `content` variations.
 */
function extractMessageText(msg: ClaudeChatMessage): string {
  // Simple text field (most common)
  if (typeof msg.text === "string" && msg.text.trim()) {
    return msg.text.trim();
  }

  // Structured content field
  if (msg.content) {
    if (typeof msg.content === "string") {
      return msg.content.trim();
    }
    if (Array.isArray(msg.content)) {
      const parts: string[] = [];
      for (const part of msg.content) {
        if (typeof part === "string") {
          parts.push(part);
        } else if (part && typeof part === "object" && typeof part.text === "string") {
          parts.push(part.text);
        }
      }
      return parts.join("\n").trim();
    }
    if (typeof msg.content === "object" && "text" in msg.content) {
      const text = (msg.content as { text?: string }).text;
      if (typeof text === "string") {
        return text.trim();
      }
    }
  }

  return "";
}

/**
 * Map Claude sender to normalized role.
 */
function normalizeRole(sender?: string): NormalizedMessage["role"] | null {
  switch (sender?.toLowerCase()) {
    case "human":
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    default:
      return null;
  }
}

/**
 * Parse an ISO date string to epoch seconds.
 */
function parseTimestamp(dateStr?: string): number | undefined {
  if (!dateStr) {
    return undefined;
  }
  const ts = new Date(dateStr).getTime();
  return Number.isNaN(ts) ? undefined : ts / 1000;
}

/**
 * Parse a single Claude conversation.
 */
function parseConversation(raw: ClaudeConversation): NormalizedConversation | null {
  const chatMessages = raw.chat_messages;
  if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
    return null;
  }

  const messages: NormalizedMessage[] = [];
  for (const msg of chatMessages) {
    const role = normalizeRole(msg.sender);
    if (!role) {
      continue;
    }
    const content = extractMessageText(msg);
    if (!content) {
      continue;
    }
    messages.push({
      role,
      content,
      timestamp: parseTimestamp(msg.created_at),
    });
  }

  if (messages.length === 0) {
    return null;
  }

  return {
    id: raw.uuid ?? `claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: raw.name,
    messages,
    source: "claude",
    createdAt: parseTimestamp(raw.created_at),
  };
}

/**
 * Parse a full Claude conversations export.
 * Handles both array-of-conversations and single-conversation formats.
 */
export function parseClaudeExport(data: unknown): NormalizedConversation[] {
  // Array of conversations
  if (Array.isArray(data)) {
    const conversations: NormalizedConversation[] = [];
    for (const raw of data) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const parsed = parseConversation(raw as ClaudeConversation);
      if (parsed) {
        conversations.push(parsed);
      }
    }
    return conversations;
  }

  // Single conversation object
  if (data && typeof data === "object" && "chat_messages" in data) {
    const parsed = parseConversation(data as ClaudeConversation);
    return parsed ? [parsed] : [];
  }

  throw new Error(
    "Claude export must be a JSON array of conversations or a single conversation object",
  );
}
