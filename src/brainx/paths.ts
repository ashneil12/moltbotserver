/**
 * Shared path resolution and filesystem utilities for BrainX scripts.
 *
 * Mirrors core OpenClaw path logic (resolveStateDir, resolveAgentWorkspaceDir)
 * without importing from the main codebase, keeping these scripts standalone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Resolve the OpenClaw state directory (default: ~/.openclaw). */
export function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
}

/** Resolve the sessions directory for a given agent. */
export function resolveAgentSessionsDir(agentId: string): string {
  return path.join(resolveStateDir(), "agents", agentId, "sessions");
}

/**
 * Resolve the workspace directory for a given agent.
 * Default agent ("main") uses `workspace/`, others use `workspace-{agentId}/`.
 */
export function resolveAgentWorkspaceDir(agentId: string): string {
  if (agentId === "main") {
    return path.join(resolveStateDir(), "workspace");
  }
  return path.join(resolveStateDir(), `workspace-${agentId}`);
}

// ---------------------------------------------------------------------------
// Agent discovery
// ---------------------------------------------------------------------------

/** List all agent IDs by scanning the agents directory. Falls back to ["main"]. */
export function listAgentIds(): string[] {
  const agentsDir = path.join(resolveStateDir(), "agents");
  try {
    return fs.readdirSync(agentsDir).filter((entry) => {
      try {
        return fs.statSync(path.join(agentsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return ["main"];
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

type TranscriptEntry = {
  type: string;
  timestamp?: string;
  message?: {
    role: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
};

function extractText(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n");
  }
  return "";
}

/**
 * Maximum bytes to read from a single transcript file.
 * Prevents OOM on very large session files (multi-day sessions can hit 50MB+).
 * 5MB covers ~2500+ messages, more than enough for fact extraction.
 */
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

/**
 * Read a JSONL transcript file and return concatenated message text.
 * Only reads the last MAX_TRANSCRIPT_BYTES of the file to bound memory usage.
 */
export function readTranscriptText(transcriptPath: string): string {
  let content: string;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      // Read only the tail of the file (most recent messages)
      const fd = fs.openSync(transcriptPath, "r");
      try {
        const offset = stat.size - MAX_TRANSCRIPT_BYTES;
        const buffer = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
        fs.readSync(fd, buffer, 0, MAX_TRANSCRIPT_BYTES, offset);
        content = buffer.toString("utf-8");
        // Discard the first (likely partial) line
        const firstNewline = content.indexOf("\n");
        if (firstNewline >= 0) {
          content = content.slice(firstNewline + 1);
        }
      } finally {
        fs.closeSync(fd);
      }
    } else {
      content = fs.readFileSync(transcriptPath, "utf-8");
    }
  } catch {
    return "";
  }

  const texts: string[] = [];
  for (const line of content.split("\n")) {
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
    const text = extractText(entry.message.content).trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts.join("\n");
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Find transcript files modified within the last `maxAgeHours` hours.
 * Returns absolute paths sorted by modification time (newest first).
 */
export function findRecentTranscripts(sessionsDir: string, maxAgeHours: number): string[] {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(sessionsDir);
    // Cache mtimeMs during the filter pass to avoid repeated statSync calls in sort.
    const entries: Array<{ path: string; mtimeMs: number }> = [];
    for (const f of files) {
      if (!f.endsWith(".jsonl")) {
        continue;
      }
      const filePath = path.join(sessionsDir, f);
      try {
        const mtimeMs = fs.statSync(filePath).mtimeMs;
        if (mtimeMs >= cutoff) {
          entries.push({ path: filePath, mtimeMs });
        }
      } catch {
        // Skip unreadable files
      }
    }
    // Sort newest first using cached mtime
    return entries.toSorted((a, b) => b.mtimeMs - a.mtimeMs).map((e) => e.path);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export type CliArgs = {
  dryRun: boolean;
  verbose: boolean;
  hours: number;
  agentFilter?: string;
};

/** Parse standard CLI arguments shared by all brainx scripts. */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const dryRun = argv.includes("--dry-run");
  const verbose = argv.includes("--verbose");

  const hoursIdx = argv.indexOf("--hours");
  const hoursRaw = hoursIdx >= 0 ? argv[hoursIdx + 1] : undefined;
  const hours = hoursRaw ? Number(hoursRaw) : 24;

  const agentIdx = argv.indexOf("--agent");
  const agentFilter = agentIdx >= 0 ? argv[agentIdx + 1]?.trim() : undefined;

  return { dryRun, verbose, hours: Number.isFinite(hours) && hours > 0 ? hours : 24, agentFilter };
}
