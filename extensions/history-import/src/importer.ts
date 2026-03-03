/**
 * Write normalized conversations as searchable markdown files.
 *
 * Output: memory/imported/{source}/{date}_{slug}.md
 * Format designed for QMD indexing (hybrid BM25 + vector search).
 */

import fs from "node:fs";
import path from "node:path";
import type { ImportResult, ImportSource, NormalizedConversation } from "./types.js";

const IMPORTED_DIR = "memory/imported";

/**
 * Generate a filesystem-safe slug from a conversation title.
 */
function slugify(text: string, maxLen = 60): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLen) || "untitled"
  );
}

/**
 * Format an epoch timestamp as YYYY-MM-DD.
 */
function formatDate(epoch?: number): string {
  if (!epoch || !Number.isFinite(epoch)) {
    return "unknown-date";
  }
  // ChatGPT uses epoch seconds, Claude may use epoch ms
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

/** Maximum characters per message when writing markdown (prevents bloated files from embedded data). */
const MAX_MESSAGE_CHARS = 50_000;

/**
 * Resolve the display label for a message role.
 */
function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "**User:**";
    case "assistant":
      return "**Assistant:**";
    case "system":
      return "**System:**";
    default:
      return `**${role}:**`;
  }
}

/**
 * Format a single conversation as a markdown document.
 * Structured for searchability: title as H1, metadata block, messages as turns.
 */
function formatConversation(convo: NormalizedConversation): string {
  const lines: string[] = [];

  // Title
  const title = convo.title?.trim() || "Untitled Conversation";
  lines.push(`# ${title}`);
  lines.push("");

  // Metadata
  lines.push(`**Source:** ${convo.source}`);
  if (convo.createdAt) {
    lines.push(`**Date:** ${formatDate(convo.createdAt)}`);
  }
  lines.push(`**Messages:** ${convo.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Messages
  for (const msg of convo.messages) {
    lines.push(roleLabel(msg.role));
    lines.push("");
    const content =
      msg.content.length > MAX_MESSAGE_CHARS
        ? msg.content.slice(0, MAX_MESSAGE_CHARS) + "\n\n[…truncated]"
        : msg.content;
    lines.push(content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write all conversations as markdown files to the workspace.
 * Returns an ImportResult with statistics.
 */
export function writeConversations(
  conversations: NormalizedConversation[],
  workspaceDir: string,
  options?: { dryRun?: boolean; maxConversations?: number },
): ImportResult {
  const source = conversations[0]?.source ?? "chatgpt";
  const targetDir = path.join(workspaceDir, IMPORTED_DIR, source);

  const limit =
    options?.maxConversations && options.maxConversations > 0
      ? options.maxConversations
      : conversations.length;

  const toImport = conversations.slice(0, limit);
  const result: ImportResult = {
    source,
    totalConversations: conversations.length,
    importedConversations: 0,
    totalMessages: 0,
    filesWritten: [],
    skipped: conversations.length - toImport.length,
    errors: [],
  };

  if (options?.dryRun) {
    result.importedConversations = toImport.length;
    result.totalMessages = toImport.reduce((sum, c) => sum + c.messages.length, 0);
    return result;
  }

  // Ensure target directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  // Track used filenames to avoid collisions
  const usedNames = new Set<string>();

  for (const convo of toImport) {
    try {
      const date = formatDate(convo.createdAt);
      const slug = slugify(convo.title ?? "untitled");
      let baseName = `${date}_${slug}`;

      // Deduplicate filenames
      if (usedNames.has(baseName)) {
        let counter = 2;
        while (usedNames.has(`${baseName}-${counter}`)) {
          counter++;
        }
        baseName = `${baseName}-${counter}`;
      }
      usedNames.add(baseName);

      const filePath = path.join(targetDir, `${baseName}.md`);

      // Skip if already imported (idempotency)
      if (fs.existsSync(filePath)) {
        result.skipped++;
        continue;
      }

      const markdown = formatConversation(convo);
      fs.writeFileSync(filePath, markdown, "utf-8");

      result.filesWritten.push(filePath);
      result.importedConversations++;
      result.totalMessages += convo.messages.length;
    } catch (err) {
      result.errors.push(
        `Failed to write ${convo.title ?? convo.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
