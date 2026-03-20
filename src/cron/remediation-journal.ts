/**
 * Remediation Journal — append-only JSONL audit trail for agent self-healing.
 *
 * Every automated fix is journaled with:
 * - Previous state snapshot (for rollback)
 * - Applied patch (what changed)
 * - Agent's stated intent (accountability)
 * - Test result (did the fix work?)
 * - TTL watchdog window (auto-rollback if problem recurs)
 *
 * Journal auto-prunes entries older than `remediationRetentionDays` (default 14).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type RemediationAction =
  | "re-enable"
  | "adjust-schedule"
  | "force-run"
  | "disk-cleanup"
  | "restart-scheduler";

export type RemediationOutcome =
  | "applied" // fix in place, watchdog monitoring
  | "confirmed" // TTL expired without refire — fix held
  | "rolled-back" // job re-failed within TTL, reverted
  | "escalated"; // max attempts exceeded, human notified

export interface RemediationEntry {
  /** Unique entry ID. */
  id: string;
  /** Timestamp when the action was taken (ms). */
  timestamp: number;
  /** Which probe triggered this remediation. */
  probe: string;
  /** What action was taken. */
  action: RemediationAction;
  /** Target job (if applicable). */
  target: { jobId?: string; jobName?: string };
  /** Agent's stated intent — what it said it would do and why. */
  description: string;
  /** Snapshot of previous state for rollback. */
  previousState: Record<string, unknown>;
  /** What was actually changed. */
  appliedPatch: Record<string, unknown>;
  /** Current outcome status. */
  outcome: RemediationOutcome;
  /** Post-fix verification result. */
  testResult?: { status: string; error?: string };
  /** Reason for rollback (if rolled back). */
  rollbackReason?: string;
  /** Watchdog window in ms. */
  ttlMs: number;
  /** Absolute expiry timestamp (timestamp + ttlMs). */
  expiresAt: number;
  /** Which attempt this is (1-indexed). */
  attempt: number;
  /** Max attempts before escalating. */
  maxAttempts: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETENTION_DAYS = 14;
const MAX_JOURNAL_BYTES = 10 * 1024 * 1024; // 10 MB safety cap
const MAX_ENTRIES = 5000; // max entries to read

// ═══════════════════════════════════════════════════════════════════════════
// Journal Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the default journal file path.
 * Falls back to `~/.openclaw/cron/remediation-journal.jsonl`.
 */
export function resolveJournalPath(cronStoreDir?: string): string {
  if (cronStoreDir) {
    return path.join(cronStoreDir, "remediation-journal.jsonl");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".openclaw", "cron", "remediation-journal.jsonl");
}

/**
 * Create a new remediation entry and append it to the journal.
 *
 * Returns the created entry (with generated ID and computed expiresAt).
 */
export function createEntry(params: {
  journalPath: string;
  probe: string;
  action: RemediationAction;
  target: { jobId?: string; jobName?: string };
  description: string;
  previousState: Record<string, unknown>;
  appliedPatch: Record<string, unknown>;
  testResult?: { status: string; error?: string };
  ttlMs?: number;
  maxAttempts?: number;
  attempt?: number;
  nowMs?: number;
}): RemediationEntry {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;

  const entry: RemediationEntry = {
    id: randomUUID(),
    timestamp: nowMs,
    probe: params.probe,
    action: params.action,
    target: params.target,
    description: params.description,
    previousState: params.previousState,
    appliedPatch: params.appliedPatch,
    outcome: "applied",
    testResult: params.testResult,
    ttlMs,
    expiresAt: nowMs + ttlMs,
    attempt: params.attempt ?? 1,
    maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  };

  appendEntry(params.journalPath, entry);
  return entry;
}

/**
 * Append a single entry to the JSONL file.
 * Creates the file and parent directories if needed.
 */
export function appendEntry(journalPath: string, entry: RemediationEntry): void {
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(journalPath, line, "utf-8");
}

/**
 * Read all entries from the journal.
 * Returns empty array if file doesn't exist.
 */
export function readAllEntries(journalPath: string): RemediationEntry[] {
  if (!fs.existsSync(journalPath)) {
    return [];
  }
  try {
    // Safety: reject oversized files to avoid memory pressure
    const stat = fs.statSync(journalPath);
    if (stat.size > MAX_JOURNAL_BYTES) {
      // Truncate to keep only the last MAX_JOURNAL_BYTES
      const content = fs.readFileSync(journalPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      // Keep only the most recent MAX_ENTRIES
      const truncated = lines.slice(-MAX_ENTRIES);
      const entries: RemediationEntry[] = [];
      for (const line of truncated) {
        try {
          entries.push(JSON.parse(line) as RemediationEntry);
        } catch {
          // skip malformed lines
        }
      }
      return entries;
    }

    const content = fs.readFileSync(journalPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: RemediationEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as RemediationEntry);
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
 * Read only active (outcome === 'applied') entries that haven't expired.
 */
export function readActiveEntries(journalPath: string, nowMs?: number): RemediationEntry[] {
  const now = nowMs ?? Date.now();
  return readAllEntries(journalPath).filter((e) => e.outcome === "applied" && e.expiresAt > now);
}

/**
 * Read all pending (outcome === 'applied') entries, regardless of expiry.
 * Used by the watchdog to process both active and TTL-expired entries.
 */
export function readPendingEntries(journalPath: string): RemediationEntry[] {
  return readAllEntries(journalPath).filter((e) => e.outcome === "applied");
}

/**
 * Update the outcome of a specific journal entry.
 *
 * Since JSONL is append-only, this rewrites the file with the updated entry.
 * For small journals (< ~1000 entries over 14 days), this is fine.
 */
export function markEntry(
  journalPath: string,
  entryId: string,
  outcome: RemediationOutcome,
  reason?: string,
): boolean {
  const entries = readAllEntries(journalPath);
  const idx = entries.findIndex((e) => e.id === entryId);
  if (idx === -1) {
    return false;
  }

  entries[idx].outcome = outcome;
  if (reason) {
    entries[idx].rollbackReason = reason;
  }

  // Rewrite the file
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(journalPath, content, "utf-8");
  return true;
}

/**
 * Delete entries older than retentionDays.
 * Returns number of entries pruned.
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
      // Delete the file entirely
      try {
        fs.unlinkSync(journalPath);
      } catch {
        /* ok */
      }
    } else {
      const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
      fs.writeFileSync(journalPath, content, "utf-8");
    }
  }

  return pruned;
}

/**
 * Query journal history, optionally filtered by jobId.
 */
export function getJournalHistory(
  journalPath: string,
  opts?: { jobId?: string; limit?: number },
): RemediationEntry[] {
  let entries = readAllEntries(journalPath);
  if (opts?.jobId) {
    entries = entries.filter((e) => e.target.jobId === opts.jobId);
  }
  // Most recent first
  entries.sort((a, b) => b.timestamp - a.timestamp);
  if (opts?.limit && opts.limit > 0) {
    entries = entries.slice(0, opts.limit);
  }
  return entries;
}

/**
 * Count previous attempts for a specific job + probe combination.
 */
export function countPreviousAttempts(journalPath: string, jobId: string, probe: string): number {
  return readAllEntries(journalPath).filter((e) => e.target.jobId === jobId && e.probe === probe)
    .length;
}
