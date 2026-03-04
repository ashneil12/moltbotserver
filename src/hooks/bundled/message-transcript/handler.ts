/**
 * Message transcript hook handler
 *
 * Appends every received and sent message to a daily Markdown file
 * at `<workspace>/transcripts/YYYY-MM-DD.md` for easy full-text search.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { redactSensitiveText } from "../../../logging/redact.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import type { HookHandler } from "../../hooks.js";
import {
  isMessageReceivedEvent,
  isMessageSentEvent,
  type MessageReceivedHookEvent,
  type MessageSentHookEvent,
} from "../../internal-hooks.js";

const log = createSubsystemLogger("hooks/message-transcript");

/**
 * Format a Date as HH:MM:SS
 */
function formatTime(date: Date): string {
  return date.toISOString().split("T")[1].split(".")[0];
}

/**
 * Format a Date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Sanitize content for safe markdown output.
 * Trims whitespace, redacts detected secrets, and returns undefined
 * for empty/blank strings.
 */
function sanitizeContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return redactSensitiveText(trimmed);
}

/**
 * Build a markdown entry for a received (inbound) message.
 */
function formatReceivedEntry(event: MessageReceivedHookEvent): string | undefined {
  const content = sanitizeContent(event.context.content);
  if (!content) {
    return undefined;
  }

  const time = formatTime(event.timestamp);
  const from = event.context.from || "unknown";
  const channel = event.context.channelId || "unknown";

  return `## ${time} — user: ${from} (${channel})\n\n${content}\n\n---\n`;
}

/**
 * Build a markdown entry for a sent (outbound) message.
 */
function formatSentEntry(event: MessageSentHookEvent): string | undefined {
  // Skip failed sends — they didn't actually reach the user
  if (!event.context.success) {
    return undefined;
  }

  const content = sanitizeContent(event.context.content);
  if (!content) {
    return undefined;
  }

  const time = formatTime(event.timestamp);
  const channel = event.context.channelId || "unknown";

  return `## ${time} — assistant (${channel})\n\n${content}\n\n---\n`;
}

/**
 * Resolve the transcripts directory from the event context.
 */
function resolveTranscriptsDir(event: {
  sessionKey: string;
  context: Record<string, unknown>;
}): string {
  const cfg = event.context.cfg as OpenClawConfig | undefined;
  const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
  const workspaceDir = cfg
    ? resolveAgentWorkspaceDir(cfg, agentId)
    : path.join(resolveStateDir(process.env, os.homedir), "workspace");
  return path.join(workspaceDir, "transcripts");
}

/**
 * Append a message transcript entry to the daily markdown file.
 */
const appendMessageTranscript: HookHandler = async (event) => {
  let entry: string | undefined;

  if (isMessageReceivedEvent(event)) {
    entry = formatReceivedEntry(event);
  } else if (isMessageSentEvent(event)) {
    entry = formatSentEntry(event);
  } else {
    // Not a message event we handle
    return;
  }

  if (!entry) {
    return;
  }

  try {
    const transcriptsDir = resolveTranscriptsDir(event);
    await fs.mkdir(transcriptsDir, { recursive: true });

    const dateStr = formatDate(event.timestamp);
    const filePath = path.join(transcriptsDir, `${dateStr}.md`);

    await fs.appendFile(filePath, entry, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to write message transcript: ${message}`);
  }
};

export default appendMessageTranscript;

// Exported for testing
export { formatReceivedEntry, formatSentEntry, formatTime, formatDate, sanitizeContent };
