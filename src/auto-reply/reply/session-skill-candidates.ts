/**
 * Per-Session Skill Candidates
 *
 * After each session reset, mechanically extracts lightweight skill candidates
 * from the session transcript. These candidates capture recurring multi-step
 * patterns, tool usage chains, and problem→solution sequences that may be
 * worth promoting to full skills.
 *
 * Candidates are persisted to `memory/skill-candidates.md` for the weekly
 * skill-evolution cron to evaluate and optionally promote to proper SKILL.md
 * files.
 *
 * This is a zero-cost (no LLM) extraction — purely pattern-based. The LLM
 * evaluation happens later in the skill-evolution cron.
 *
 * Inspired by MetaClaw's per-session skill auto-summarization (v0.2.0+).
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("skill-candidates");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillCandidate = {
  /** One-line description of what was learned or done. */
  topic: string;
  /** Key supporting evidence (tool names, user messages). */
  evidence: string;
  /** ISO timestamp of extraction. */
  extractedAt: string;
  /** Session ID this was extracted from. */
  sessionId: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANDIDATES_FILENAME = "skill-candidates.md";
const CANDIDATES_HEADER =
  "# Skill Candidates\n\nAuto-extracted from session transcripts. The skill-evolution cron evaluates these weekly.\n\n";

/** Maximum size of the candidates file (16KB). */
const MAX_CANDIDATES_FILE_CHARS = 16_000;

/** Minimum number of tool calls in a session to consider for multi-step extraction. */
const MIN_TOOL_CALLS_FOR_PATTERN = 3;

/** Minimum number of user messages to consider a session substantive. */
const MIN_USER_MESSAGES = 2;

// ---------------------------------------------------------------------------
// Transcript parsing (reuses patterns from session-context-summary.ts)
// ---------------------------------------------------------------------------

type TranscriptMessage = {
  role: string;
  content?: string | Array<{ type: string; text?: string; name?: string }>;
};

type TranscriptEntry = {
  type: string;
  timestamp?: string;
  message?: TranscriptMessage;
};

function extractText(msg: TranscriptMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

function extractToolNames(msg: TranscriptMessage): string[] {
  if (!Array.isArray(msg.content)) {
    return [];
  }
  return msg.content
    .filter(
      (b): b is { type: string; name: string } =>
        b.type === "toolCall" && typeof b.name === "string",
    )
    .map((b) => b.name);
}

// ---------------------------------------------------------------------------
// Extraction logic
// ---------------------------------------------------------------------------

/**
 * Extract skill candidates from a session transcript.
 * Uses mechanical pattern matching — no LLM calls.
 *
 * Currently detects:
 * 1. Multi-step tool usage patterns (3+ distinct tools in sequence)
 * 2. Repeated tool corrections (same tool called 3+ times suggesting iteration)
 */
export function extractSkillCandidates(params: {
  transcriptPath: string;
  sessionId: string;
}): SkillCandidate[] {
  const { transcriptPath, sessionId } = params;
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const userMessages: string[] = [];
  const allToolNames: string[] = [];
  const toolCallCounts = new Map<string, number>();

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
    if (entry.type !== "message" || !entry.message) {
      continue;
    }

    const { message } = entry;

    if (message.role === "user") {
      const text = extractText(message).trim();
      if (text && text.length > 5) {
        userMessages.push(text.slice(0, 200));
      }
    }

    if (message.role === "assistant") {
      const tools = extractToolNames(message);
      for (const tool of tools) {
        allToolNames.push(tool);
        toolCallCounts.set(tool, (toolCallCounts.get(tool) ?? 0) + 1);
      }
    }
  }

  // Skip trivial sessions
  if (userMessages.length < MIN_USER_MESSAGES) {
    return [];
  }

  const candidates: SkillCandidate[] = [];
  const now = new Date().toISOString();

  // Pattern 1: Multi-step tool workflows (3+ distinct tools used together)
  const distinctTools = new Set(allToolNames);
  if (distinctTools.size >= MIN_TOOL_CALLS_FOR_PATTERN) {
    // Extract the most common tool chain as a workflow candidate
    const topTools = [...distinctTools].slice(0, 5).join(", ");
    const firstUserMsg = userMessages[0]?.slice(0, 100) ?? "unknown task";
    candidates.push({
      topic: `Multi-step workflow: ${firstUserMsg}`,
      evidence: `Tools used: ${topTools} (${allToolNames.length} total calls)`,
      extractedAt: now,
      sessionId,
    });
  }

  // Pattern 2: Iterative corrections (same tool called 3+ times)
  for (const [tool, count] of toolCallCounts) {
    if (count >= 3) {
      candidates.push({
        topic: `Iterative ${tool} usage pattern (${count} calls)`,
        evidence: `${tool} called ${count} times — may indicate trial-and-error or a multi-step procedure worth documenting`,
        extractedAt: now,
        sessionId,
      });
      // Max 1 correction pattern per session to avoid noise
      break;
    }
  }

  // Cap at 2 candidates per session (quality > quantity)
  return candidates.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Append skill candidates to memory/skill-candidates.md.
 * Creates the file + directory if they don't exist.
 * Truncates at MAX_CANDIDATES_FILE_CHARS to prevent unbounded growth.
 */
export function persistSkillCandidates(params: {
  workspaceDir: string;
  candidates: SkillCandidate[];
}): void {
  const { workspaceDir, candidates } = params;
  if (candidates.length === 0) {
    return;
  }

  const memoryDir = path.join(workspaceDir, "memory");
  const filePath = path.join(memoryDir, CANDIDATES_FILENAME);

  try {
    fs.mkdirSync(memoryDir, { recursive: true });
  } catch {
    log.warn(`cannot create memory directory: ${memoryDir}`);
    return;
  }

  // Read existing content
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Format new candidates
  const newEntries = candidates
    .map((c) =>
      [
        `## ${c.topic}`,
        `- **Evidence**: ${c.evidence}`,
        `- **Session**: ${c.sessionId}`,
        `- **Extracted**: ${c.extractedAt}`,
        "",
      ].join("\n"),
    )
    .join("\n");

  // Append (or create with header)
  let combined: string;
  if (existing.includes("# Skill Candidates")) {
    combined = existing.trimEnd() + "\n\n" + newEntries;
  } else {
    combined = CANDIDATES_HEADER + newEntries;
  }

  // Truncate if too large (remove oldest entries from the top, keep newest)
  if (combined.length > MAX_CANDIDATES_FILE_CHARS) {
    // Find entries starting from the end of the header area.
    // We want to keep the header + the most recent entries.
    const headerEnd = combined.indexOf("\n## ");
    if (headerEnd > 0) {
      // Find the second ## heading — entries after the first that should be trimmed
      const excess = combined.length - MAX_CANDIDATES_FILE_CHARS;
      // Walk forward from the header, skipping `excess` characters worth of old entries
      let cutFrom = headerEnd;
      let nextEntry = combined.indexOf("\n## ", cutFrom + 4);
      while (nextEntry > 0 && nextEntry < headerEnd + excess) {
        cutFrom = nextEntry;
        nextEntry = combined.indexOf("\n## ", cutFrom + 4);
      }
      if (cutFrom > headerEnd) {
        combined = CANDIDATES_HEADER + combined.slice(cutFrom + 1).trimStart();
      }
    }
  }

  try {
    fs.writeFileSync(filePath, combined, "utf-8");
    log.info(`persisted ${candidates.length} skill candidate(s) to ${filePath}`);
  } catch (err) {
    log.warn(`failed to persist skill candidates: ${String(err)}`);
  }
}
