/**
 * Auto-Heal Journal — audit trail for autonomous code fixes.
 *
 * Records every attempt the auto-heal subagent makes to fix errors,
 * including: what was backed up, what was tried, whether tests passed,
 * and whether the fix was committed or rolled back.
 *
 * Also generates `BACKGROUND_FIXES.md` — a human-readable changelog
 * so the owner (or a dev SSH'ing in) can see autonomous fixes at a glance.
 *
 * Stored at `~/.openclaw/auto-heal/auto-heal-journal.jsonl`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("auto-heal-journal");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type AutoHealOutcome =
  | "applied" // fix applied, tests passed
  | "rolled-back" // fix failed verification, backup restored
  | "escalated"; // max attempts exhausted, escalated to main agent/human

export interface AutoHealEntry {
  /** Unique entry ID. */
  id: string;
  /** Timestamp when the attempt was made (ms). */
  timestamp: number;
  /** Reference to the error-journal entry this fixes. */
  errorRef: string;
  /** The file that was patched. */
  targetFile: string;
  /** Brief description of the fix approach. */
  approach: string;
  /** Which attempt this is (1, 2, or 3). */
  attemptNumber: number;
  /** Path to the .bak backup file. */
  backupPath: string;
  /** Exact test command that was used for verification. */
  testCommand: string;
  /** Test execution result. */
  testResult: {
    status: "pass" | "fail";
    output?: string;
    durationMs?: number;
  };
  /** Current outcome. */
  outcome: AutoHealOutcome;
  /** Reason for rollback (if rolled back). */
  rollbackReason?: string;
  /** Who performed this — always "auto-heal-subagent" for background fixes. */
  actor: string;
  /** Plain-English summary of what was done (for BACKGROUND_FIXES.md). */
  humanSummary?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_RETENTION_DAYS = 30;
const MAX_JOURNAL_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ENTRIES = 2000;
const MAX_ATTEMPTS = 3;

// ═══════════════════════════════════════════════════════════════════════════
// Path Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the auto-heal journal file path.
 */
export function resolveAutoHealJournalPath(baseDir?: string): string {
  if (baseDir) {
    return path.join(baseDir, "auto-heal-journal.jsonl");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".openclaw", "auto-heal", "auto-heal-journal.jsonl");
}

/**
 * Resolve the BACKGROUND_FIXES.md output path.
 */
export function resolveBackgroundFixesPath(workspaceDir: string): string {
  return path.join(workspaceDir, "BACKGROUND_FIXES.md");
}

// ═══════════════════════════════════════════════════════════════════════════
// Scope Enforcement
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Leaf node patterns: files the auto-heal subagent is allowed to modify.
 */
const LEAF_NODE_PATTERNS = [
  /src\/agents\/tools\//,
  /skills\//,
  /src\/utils\//,
  /src\/cron\/(?!service\/)/, // cron internals but not the service core
];

/**
 * Trunk node patterns: files that are NEVER allowed to be modified.
 * Any match here is an immediate hard-reject.
 */
const TRUNK_NODE_PATTERNS = [
  /system-prompt\.ts$/,
  /pi-embedded-runner/,
  /src\/security\//,
  /package\.json$/,
  /package-lock\.json$/,
  /Dockerfile$/,
  /\.env/,
  /tsconfig/,
  /vitest\.config/,
  /src\/gateway\//,
  /src\/config\/config\.ts$/,
];

/**
 * Check if a file path is within the auto-heal allowed scope.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function checkFileScope(filePath: string): { allowed: boolean; reason?: string } {
  const normalized = filePath.replace(/\\/g, "/");

  // Check trunk nodes first (blocklist takes priority)
  for (const pattern of TRUNK_NODE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        reason: `File "${path.basename(filePath)}" matches trunk-node pattern ${pattern.toString()}. Core system files cannot be auto-healed.`,
      };
    }
  }

  // Check if it matches any leaf node pattern
  for (const pattern of LEAF_NODE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `File "${path.basename(filePath)}" is not in an auto-healable scope (tools/, skills/, utils/, cron/).`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Journal Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new auto-heal journal entry.
 */
export function createAutoHealEntry(params: {
  journalPath: string;
  errorRef: string;
  targetFile: string;
  approach: string;
  attemptNumber: number;
  backupPath: string;
  testCommand: string;
  testResult: { status: "pass" | "fail"; output?: string; durationMs?: number };
  outcome: AutoHealOutcome;
  rollbackReason?: string;
  humanSummary?: string;
  nowMs?: number;
}): AutoHealEntry {
  const entry: AutoHealEntry = {
    id: randomUUID(),
    timestamp: params.nowMs ?? Date.now(),
    errorRef: params.errorRef,
    targetFile: params.targetFile,
    approach: params.approach,
    attemptNumber: params.attemptNumber,
    backupPath: params.backupPath,
    testCommand: params.testCommand,
    testResult: params.testResult,
    outcome: params.outcome,
    rollbackReason: params.rollbackReason,
    actor: "auto-heal-subagent",
    humanSummary: params.humanSummary,
  };

  appendEntry(params.journalPath, entry);
  log.info(
    `auto-heal: ${params.outcome} attempt ${params.attemptNumber} on ${path.basename(params.targetFile)} — ${params.approach.slice(0, 80)}`,
  );
  return entry;
}

/**
 * Append a single entry to the JSONL file.
 */
function appendEntry(journalPath: string, entry: AutoHealEntry): void {
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(journalPath, line, "utf-8");
}

/**
 * Read all entries from the journal.
 */
export function readAllEntries(journalPath: string): AutoHealEntry[] {
  if (!fs.existsSync(journalPath)) {
    return [];
  }
  try {
    const stat = fs.statSync(journalPath);
    const content = fs.readFileSync(journalPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // Safety: if oversized, keep only the most recent entries
    const toProcess = stat.size > MAX_JOURNAL_BYTES ? lines.slice(-MAX_ENTRIES) : lines;
    const entries: AutoHealEntry[] = [];
    for (const line of toProcess) {
      try {
        entries.push(JSON.parse(line) as AutoHealEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Count previous attempts for a specific error reference.
 */
export function countAttempts(journalPath: string, errorRef: string): number {
  return readAllEntries(journalPath).filter((e) => e.errorRef === errorRef).length;
}

/**
 * Check if the max attempts limit has been reached for an error.
 */
export function isMaxAttemptsReached(journalPath: string, errorRef: string): boolean {
  return countAttempts(journalPath, errorRef) >= MAX_ATTEMPTS;
}

/**
 * Get the max attempts constant for external use.
 */
export function getMaxAttempts(): number {
  return MAX_ATTEMPTS;
}

/**
 * Prune entries older than retentionDays.
 */
export function pruneOldEntries(
  journalPath: string,
  retentionDays?: number,
  nowMs?: number,
): number {
  const retention = retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = (nowMs ?? Date.now()) - retention * 24 * 60 * 60_000;

  const entries = readAllEntries(journalPath);
  const kept = entries.filter((e) => e.timestamp >= cutoff);
  const pruned = entries.length - kept.length;

  if (pruned > 0) {
    if (kept.length === 0) {
      try {
        fs.unlinkSync(journalPath);
      } catch {
        /* ok */
      }
    } else {
      const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
      // Atomic write: write to temp file, then rename to prevent corruption on crash
      const tmpPath = journalPath + ".tmp";
      fs.writeFileSync(tmpPath, content, "utf-8");
      fs.renameSync(tmpPath, journalPath);
    }
  }

  return pruned;
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND_FIXES.md Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the BACKGROUND_FIXES.md file from the auto-heal journal.
 *
 * Groups entries by date and shows:
 * - Successful fixes (applied)
 * - Rolled-back attempts
 * - Escalated issues
 *
 * This file is the human-readable audit trail for the owner or
 * any developer SSH'ing into the system.
 */
export function generateBackgroundFixesMd(params: {
  journalPath: string;
  outputPath: string;
  /** Max days of history to include (default 14). */
  maxDays?: number;
  nowMs?: number;
}): void {
  const entries = readAllEntries(params.journalPath);
  const maxDays = params.maxDays ?? 14;
  const cutoff = (params.nowMs ?? Date.now()) - maxDays * 24 * 60 * 60_000;

  const recent = entries
    .filter((e) => e.timestamp >= cutoff)
    .toSorted((a, b) => b.timestamp - a.timestamp); // newest first

  const lines: string[] = [
    "# Background Fixes",
    "",
    "> Automatically maintained by the auto-heal engineering subagent.",
    "> This file documents all autonomous code fixes applied in the background.",
    "> Last updated: " + new Date(params.nowMs ?? Date.now()).toISOString(),
    "",
  ];

  if (recent.length === 0) {
    lines.push("No background fixes in the last " + maxDays + " days. ✅");
  } else {
    // Group by date
    const byDate = new Map<string, AutoHealEntry[]>();
    for (const entry of recent) {
      const date = new Date(entry.timestamp).toISOString().split("T")[0];
      const existing = byDate.get(date) ?? [];
      existing.push(entry);
      byDate.set(date, existing);
    }

    // Stats
    const applied = recent.filter((e) => e.outcome === "applied").length;
    const rolledBack = recent.filter((e) => e.outcome === "rolled-back").length;
    const escalated = recent.filter((e) => e.outcome === "escalated").length;

    lines.push("## Summary");
    lines.push("");
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| ✅ Fixes Applied | ${applied} |`);
    lines.push(`| ↩️ Rolled Back | ${rolledBack} |`);
    lines.push(`| 🚨 Escalated | ${escalated} |`);
    lines.push("");

    for (const [date, dateEntries] of byDate) {
      lines.push(`## ${date}`);
      lines.push("");

      for (const entry of dateEntries) {
        const statusEmoji =
          entry.outcome === "applied" ? "✅" : entry.outcome === "rolled-back" ? "↩️" : "🚨";
        const timeStr = new Date(entry.timestamp).toISOString().split("T")[1].slice(0, 8);

        lines.push(`### ${statusEmoji} ${path.basename(entry.targetFile)} (${timeStr} UTC)`);
        lines.push("");
        lines.push(`- **Approach:** ${entry.approach}`);
        lines.push(`- **Attempt:** ${entry.attemptNumber}/3`);
        lines.push(`- **Test:** \`${entry.testCommand}\` → ${entry.testResult.status}`);
        if (entry.humanSummary) {
          lines.push(`- **What happened:** ${entry.humanSummary}`);
        }
        if (entry.rollbackReason) {
          lines.push(`- **Rolled back because:** ${entry.rollbackReason}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("*This file is auto-generated. Do not edit manually.*");

  const dir = path.dirname(params.outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write to temp file, then rename to prevent corruption on crash
  const tmpPath = params.outputPath + ".tmp";
  fs.writeFileSync(tmpPath, lines.join("\n") + "\n", "utf-8");
  fs.renameSync(tmpPath, params.outputPath);
  log.info(`generated BACKGROUND_FIXES.md with ${recent.length} entries`);
}
