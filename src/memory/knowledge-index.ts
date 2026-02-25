import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("knowledge-index");

const KNOWLEDGE_DIR = "memory/knowledge";
const INDEX_FILENAME = "_index.md";
const MAX_SUMMARY_LINES = 3;

/**
 * Extract the first N non-empty, non-heading, non-marker lines from markdown
 * to use as a topic summary in the knowledge index.
 */
export function extractSummary(content: string, maxLines = MAX_SUMMARY_LINES): string {
  const lines = content.split("\n");
  const summaryLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("---")) {
      continue;
    }
    if (trimmed.startsWith(">")) {
      continue;
    } // skip blockquotes (template instructions)
    summaryLines.push(trimmed);
    if (summaryLines.length >= maxLines) {
      break;
    }
  }
  return summaryLines.join("\n");
}

/**
 * Scan memory/knowledge/*.md and rebuild _index.md with topic summaries.
 * Fire-and-forget safe — failures are logged but do not throw.
 */
export async function rebuildKnowledgeIndex(workspaceDir: string): Promise<void> {
  const knowledgeDir = path.join(workspaceDir, KNOWLEDGE_DIR);
  try {
    await fs.access(knowledgeDir);
  } catch {
    return; // Directory doesn't exist — nothing to index
  }

  try {
    const entries = await fs.readdir(knowledgeDir, { withFileTypes: true });
    const topicFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== INDEX_FILENAME)
      .toSorted((a, b) => a.name.localeCompare(b.name));

    if (topicFiles.length === 0) {
      const minimal =
        "# Knowledge Base Index\n\n_No topics yet. Write to memory/knowledge/<topic>.md to start accumulating knowledge._\n";
      await fs.writeFile(path.join(knowledgeDir, INDEX_FILENAME), minimal, "utf-8");
      return;
    }

    const sections: string[] = ["# Knowledge Base Index", ""];
    for (const file of topicFiles) {
      const topicName = file.name.replace(/\.md$/, "");
      const content = await fs.readFile(path.join(knowledgeDir, file.name), "utf-8");
      const summary = extractSummary(content);
      sections.push(`## ${topicName}`);
      if (summary) {
        sections.push(summary);
      } else {
        sections.push("_(empty)_");
      }
      sections.push("");
    }

    const indexContent = sections.join("\n");
    await fs.writeFile(path.join(knowledgeDir, INDEX_FILENAME), indexContent, "utf-8");
    log.info(`knowledge-index: rebuilt index with ${topicFiles.length} topics`);
  } catch (err) {
    log.warn(`knowledge-index: failed to rebuild index: ${String(err)}`);
  }
}

/**
 * Read the knowledge index file. Returns null if it doesn't exist.
 */
export async function readKnowledgeIndex(workspaceDir: string): Promise<string | null> {
  const indexPath = path.join(workspaceDir, KNOWLEDGE_DIR, INDEX_FILENAME);
  try {
    return await fs.readFile(indexPath, "utf-8");
  } catch {
    return null;
  }
}
