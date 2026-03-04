import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("session-context");

/** Maximum characters to keep in the session-context.md file. */
export const MAX_SESSION_CONTEXT_CHARS = 24_000;

/** Maximum number of recent user messages to extract from a transcript. */
const MAX_USER_MESSAGES = 30;

/** Maximum characters per extracted user message. */
const MAX_MESSAGE_CHARS = 500;

/** Filename for the session context file within memory/. */
export const SESSION_CONTEXT_FILENAME = "session-context.md";

type TranscriptMessage = {
  role: string;
  content?: string | Array<{ type: string; text?: string }>;
};

type TranscriptEntry = {
  type: string;
  timestamp?: string;
  message?: TranscriptMessage;
};

/**
 * Extract the text content from a transcript message.
 */
function extractMessageText(msg: TranscriptMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n");
  }
  return "";
}

/**
 * Read the outgoing session transcript and extract a concise context summary.
 * Returns undefined if the transcript cannot be read or has no user messages.
 */
export function extractSessionContextFromTranscript(transcriptPath: string): string | undefined {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    log.debug(`cannot read transcript: ${transcriptPath}`);
    return undefined;
  }

  const lines = content.split("\n");
  const userMessages: Array<{ text: string; timestamp?: string }> = [];
  const assistantTopics: string[] = [];
  const toolsUsed = new Set<string>();
  let sessionStart: string | undefined;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    // Capture session start time
    if (entry.type === "session" && entry.timestamp) {
      sessionStart = entry.timestamp;
    }

    if (entry.type !== "message" || !entry.message) {
      continue;
    }

    const msg = entry.message;
    const text = extractMessageText(msg).trim();

    if (msg.role === "user" && text) {
      userMessages.push({
        text: text.slice(0, MAX_MESSAGE_CHARS),
        timestamp: entry.timestamp,
      });
    }

    // Track tool usage
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const toolBlock = block as Record<string, unknown>;
        if (toolBlock.type === "toolCall" && typeof toolBlock.name === "string") {
          toolsUsed.add(toolBlock.name);
        }
      }
    }

    // Extract first line of assistant text responses as topic indicators
    if (msg.role === "assistant" && text && assistantTopics.length < 10) {
      const firstLine = text.split("\n")[0]?.trim();
      if (firstLine && firstLine.length > 10 && firstLine.length < 200) {
        assistantTopics.push(firstLine);
      }
    }
  }

  if (userMessages.length === 0) {
    return undefined;
  }

  // Take the most recent user messages
  const recentMessages = userMessages.slice(-MAX_USER_MESSAGES);
  const now = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
  const startTime = sessionStart
    ? new Date(sessionStart)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC")
    : "unknown";

  const parts: string[] = [];
  parts.push(`## Session ended ${now}`);
  parts.push(`Session started: ${startTime} | ${userMessages.length} user messages`);
  if (toolsUsed.size > 0) {
    const tools = [...toolsUsed].slice(0, 15).join(", ");
    parts.push(`Tools used: ${tools}`);
  }
  parts.push("");
  parts.push("### Recent user messages:");
  for (const msg of recentMessages) {
    const truncated =
      msg.text.length > MAX_MESSAGE_CHARS ? msg.text.slice(0, MAX_MESSAGE_CHARS) + "…" : msg.text;
    // Strip multi-line messages to first meaningful line for brevity
    const firstLine = truncated.split("\n").filter(Boolean)[0] ?? truncated;
    parts.push(`- ${firstLine}`);
  }

  return parts.join("\n");
}

/**
 * Update memory/session-context.md by prepending a new summary.
 * Truncates the file at MAX_SESSION_CONTEXT_CHARS to keep it bounded.
 */
export function updateSessionContextFile(workspaceDir: string, newSummary: string): void {
  const memoryDir = path.join(workspaceDir, "memory");
  const filePath = path.join(memoryDir, SESSION_CONTEXT_FILENAME);

  try {
    fs.mkdirSync(memoryDir, { recursive: true });
  } catch {
    log.warn(`cannot create memory directory: ${memoryDir}`);
    return;
  }

  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Prepend new summary with a separator
  const header = existing ? "" : "# Recent Session Context\n\n";
  let combined = `${header}${newSummary}\n\n${existing}`;

  // Truncate at MAX_SESSION_CONTEXT_CHARS
  if (combined.length > MAX_SESSION_CONTEXT_CHARS) {
    // Find a clean break point (end of a section) near the limit
    const cutPoint = combined.lastIndexOf("\n## ", MAX_SESSION_CONTEXT_CHARS);
    if (cutPoint > 0 && cutPoint > MAX_SESSION_CONTEXT_CHARS * 0.5) {
      combined = combined.slice(0, cutPoint).trimEnd() + "\n";
    } else {
      combined = combined.slice(0, MAX_SESSION_CONTEXT_CHARS).trimEnd() + "\n";
    }
  }

  try {
    fs.writeFileSync(filePath, combined, "utf-8");
    log.info(`updated session context: ${filePath} (${combined.length} chars)`);
  } catch (err) {
    log.warn(`failed to write session context: ${String(err)}`);
  }
}

/**
 * Generate and persist a session context summary from an outgoing transcript.
 * Best-effort: silently skips if the transcript is unreadable or empty.
 */
export function persistSessionContextOnReset(params: {
  transcriptPath: string;
  workspaceDir: string;
}): void {
  const summary = extractSessionContextFromTranscript(params.transcriptPath);
  if (!summary) {
    return;
  }
  updateSessionContextFile(params.workspaceDir, summary);
}
