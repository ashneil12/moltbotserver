/**
 * Parser for ChatGPT's conversations.json export format.
 *
 * ChatGPT exports conversations as a tree structure using a `mapping` object
 * where each node has a `parent` pointer. We walk the tree to extract messages
 * in chronological order.
 */

import type { NormalizedConversation, NormalizedMessage } from "../types.js";

// -- Raw ChatGPT export types --

type ChatGptContentPart = string | { type?: string; text?: string };

type ChatGptMessage = {
  id?: string;
  author?: { role?: string };
  content?: {
    content_type?: string;
    parts?: ChatGptContentPart[];
    text?: string;
  };
  create_time?: number | null;
  status?: string;
};

type ChatGptMappingNode = {
  id?: string;
  message?: ChatGptMessage | null;
  parent?: string | null;
  children?: string[];
};

type ChatGptConversation = {
  id?: string;
  title?: string;
  mapping?: Record<string, ChatGptMappingNode>;
  create_time?: number;
  update_time?: number;
};

// -- Parsing --

/**
 * Extract text content from a ChatGPT message's content parts.
 */
function extractContentText(message: ChatGptMessage): string {
  const parts = message.content?.parts;
  if (Array.isArray(parts)) {
    const texts: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        texts.push(part);
      } else if (part && typeof part === "object" && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
    return texts.join("\n").trim();
  }
  if (typeof message.content?.text === "string") {
    return message.content.text.trim();
  }
  return "";
}

/**
 * Walk the mapping tree to get messages in order.
 * Follows the first child branch (main conversation thread).
 */
function walkMappingTree(mapping: Record<string, ChatGptMappingNode>): ChatGptMessage[] {
  // Find the root node (no parent, or parent not in mapping)
  let rootId: string | undefined;
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent || !(node.parent in mapping)) {
      rootId = id;
      break;
    }
  }

  if (!rootId) {
    return [];
  }

  const messages: ChatGptMessage[] = [];
  let currentId: string | undefined = rootId;

  while (currentId) {
    const node: ChatGptMappingNode | undefined = mapping[currentId];
    if (!node) {
      break;
    }
    if (node.message) {
      messages.push(node.message);
    }
    // Follow first child (main thread)
    currentId = node.children?.[0];
  }

  return messages;
}

/**
 * Map ChatGPT author role to normalized role.
 */
function normalizeRole(role?: string): NormalizedMessage["role"] | null {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    // Skip tool messages, unknown roles
    default:
      return null;
  }
}

/**
 * Parse a single ChatGPT conversation from the export format.
 */
function parseConversation(raw: ChatGptConversation): NormalizedConversation | null {
  if (!raw.mapping || typeof raw.mapping !== "object") {
    return null;
  }

  const rawMessages = walkMappingTree(raw.mapping);
  const messages: NormalizedMessage[] = [];

  for (const msg of rawMessages) {
    const role = normalizeRole(msg.author?.role);
    if (!role) {
      continue;
    }
    const content = extractContentText(msg);
    if (!content) {
      continue;
    }
    messages.push({
      role,
      content,
      timestamp: typeof msg.create_time === "number" ? msg.create_time : undefined,
    });
  }

  if (messages.length === 0) {
    return null;
  }

  return {
    id: raw.id ?? `chatgpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: raw.title,
    messages,
    source: "chatgpt",
    createdAt: raw.create_time,
  };
}

/**
 * Parse a full ChatGPT conversations.json export.
 * Returns normalized conversations, skipping empty ones.
 */
export function parseChatGptExport(data: unknown): NormalizedConversation[] {
  if (!Array.isArray(data)) {
    throw new Error("ChatGPT export must be a JSON array of conversations");
  }

  const conversations: NormalizedConversation[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const parsed = parseConversation(raw as ChatGptConversation);
    if (parsed) {
      conversations.push(parsed);
    }
  }

  return conversations;
}
