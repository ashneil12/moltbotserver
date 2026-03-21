/**
 * Error Journal — structured error capture for auto-heal pipeline.
 *
 * Append-only JSONL log at `~/.openclaw/auto-heal/error-journal.jsonl`.
 * Each entry captures a runtime error with enough context for the auto-heal
 * subagent to diagnose and attempt repairs.
 *
 * Mirrors the remediation-journal.ts pattern:
 * - Append-only JSONL (no in-place mutations except mark + prune)
 * - Safety cap on file size
 * - Auto-prune entries older than retention window
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("error-journal");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type ErrorStatus =
  | "pending" // awaiting auto-heal attempt
  | "in-progress" // auto-heal subagent currently working on it
  | "resolved" // successfully fixed
  | "escalated" // exhausted auto-heal, escalated to main agent or human
  | "dismissed"; // error was transient or manually dismissed

export interface ErrorJournalEntry {
  /** Unique entry ID. */
  id: string;
  /** Timestamp when the error was captured (ms). */
  timestamp: number;
  /** Source file path where the error originated. */
  sourceFile: string;
  /** Error message (first line / summary). */
  errorMessage: string;
  /** Full stack trace (if available). */
  stackTrace?: string;
  /** The tool or subsystem that produced the error. */
  toolContext?: string;
  /** Severity classification. */
  severity: ErrorSeverity;
  /** Current processing status. */
  status: ErrorStatus;
  /** Number of times this exact error has been seen (deduplication counter). */
  occurrenceCount: number;
  /** Timestamp of last occurrence (for deduplication). */
  lastSeenAt: number;
  /** Reference to the auto-heal journal entry that resolved this (if any). */
  resolvedByRef?: string;
  /** Human-readable resolution summary. */
  resolutionSummary?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_RETENTION_DAYS = 30;
const MAX_JOURNAL_BYTES = 5 * 1024 * 1024; // 5 MB safety cap
const MAX_ENTRIES = 2000;

// ═══════════════════════════════════════════════════════════════════════════
// Path Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the default error journal file path.
 * Falls back to `~/.openclaw/auto-heal/error-journal.jsonl`.
 */
export function resolveErrorJournalPath(baseDir?: string): string {
  if (baseDir) {
    return path.join(baseDir, "error-journal.jsonl");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".openclaw", "auto-heal", "error-journal.jsonl");
}

// ═══════════════════════════════════════════════════════════════════════════
// Severity Classification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify error severity based on heuristics.
 * Can be overridden by the caller if they have better context.
 */
export function classifyErrorSeverity(params: {
  errorMessage: string;
  sourceFile: string;
  occurrenceCount?: number;
}): ErrorSeverity {
  const msg = params.errorMessage.toLowerCase();
  const file = params.sourceFile.toLowerCase();

  // Critical: security, auth, data corruption
  if (
    msg.includes("security") ||
    msg.includes("unauthorized") ||
    msg.includes("corruption") ||
    msg.includes("data loss") ||
    file.includes("security/")
  ) {
    return "critical";
  }

  // High: recurring errors (seen 3+ times), core system errors
  if (
    (params.occurrenceCount ?? 1) >= 3 ||
    file.includes("system-prompt") ||
    file.includes("pi-embedded-runner") ||
    msg.includes("fatal") ||
    msg.includes("crash")
  ) {
    return "high";
  }

  // Medium: tool errors, API failures
  if (
    file.includes("/tools/") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("rate limit")
  ) {
    return "medium";
  }

  // Low: everything else
  return "low";
}

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a deduplication key from error message + source file.
 * Strips dynamic content (line numbers, timestamps, IDs) for stable matching.
 */
export function errorDeduplicationKey(errorMessage: string, sourceFile: string): string {
  const normalizedMsg = errorMessage
    .replace(/\b\d{10,}\b/g, "<TIMESTAMP>") // epoch timestamps
    .replace(/\b[0-9a-f]{8,}\b/gi, "<ID>") // hex IDs/hashes
    .replace(/:\d+:\d+/g, ":<LINE>:<COL>") // line:col refs
    .replace(/\d+/g, "<N>") // all remaining numbers
    .trim()
    .slice(0, 200); // cap length for reasonable key size

  const normalizedFile = path.basename(sourceFile);
  return `${normalizedFile}::${normalizedMsg}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Journal Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append an error to the journal. If a matching unresolved error already exists
 * (by dedup key), increments the occurrence counter instead of creating a new entry.
 *
 * Returns the created or updated entry.
 */
export function appendError(params: {
  journalPath: string;
  sourceFile: string;
  errorMessage: string;
  stackTrace?: string;
  toolContext?: string;
  severity?: ErrorSeverity;
  nowMs?: number;
}): ErrorJournalEntry {
  const nowMs = params.nowMs ?? Date.now();
  const dedupKey = errorDeduplicationKey(params.errorMessage, params.sourceFile);

  // Check for existing unresolved duplicate
  const existing = readAllEntries(params.journalPath);
  const duplicate = existing.find(
    (e) =>
      (e.status === "pending" || e.status === "in-progress") &&
      errorDeduplicationKey(e.errorMessage, e.sourceFile) === dedupKey,
  );

  if (duplicate) {
    // Update occurrence count + lastSeenAt
    duplicate.occurrenceCount += 1;
    duplicate.lastSeenAt = nowMs;
    // Possibly escalate severity if recurring
    if (duplicate.occurrenceCount >= 3 && duplicate.severity === "low") {
      duplicate.severity = "medium";
    }
    if (duplicate.occurrenceCount >= 5 && duplicate.severity === "medium") {
      duplicate.severity = "high";
    }
    // Rewrite the journal
    writeAllEntries(params.journalPath, existing);
    log.info(
      `error-journal: bumped occurrence count for ${duplicate.id} (${duplicate.occurrenceCount}x)`,
    );
    return duplicate;
  }

  // New entry
  const severity =
    params.severity ??
    classifyErrorSeverity({
      errorMessage: params.errorMessage,
      sourceFile: params.sourceFile,
    });

  const entry: ErrorJournalEntry = {
    id: randomUUID(),
    timestamp: nowMs,
    sourceFile: params.sourceFile,
    errorMessage: params.errorMessage,
    stackTrace: params.stackTrace,
    toolContext: params.toolContext,
    severity,
    status: "pending",
    occurrenceCount: 1,
    lastSeenAt: nowMs,
  };

  appendEntryRaw(params.journalPath, entry);
  log.info(
    `error-journal: captured ${severity} error from ${params.sourceFile}: ${params.errorMessage.slice(0, 100)}`,
  );
  return entry;
}

/**
 * Append a single entry to the JSONL file.
 * Creates the file and parent directories if needed.
 */
function appendEntryRaw(journalPath: string, entry: ErrorJournalEntry): void {
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
export function readAllEntries(journalPath: string): ErrorJournalEntry[] {
  if (!fs.existsSync(journalPath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(journalPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // Safety: if oversized, keep only the most recent entries
    const toProcess = content.length > MAX_JOURNAL_BYTES ? lines.slice(-MAX_ENTRIES) : lines;
    const entries: ErrorJournalEntry[] = [];
    for (const line of toProcess) {
      try {
        entries.push(JSON.parse(line) as ErrorJournalEntry);
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
 * Write all entries back to the journal (for in-place updates like dedup bumps).
 */
function writeAllEntries(journalPath: string, entries: ErrorJournalEntry[]): void {
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  // Atomic write: write to temp file, then rename to prevent corruption on crash
  const tmpPath = journalPath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, journalPath);
}

/**
 * Read only pending (unresolved) errors.
 */
export function readPendingErrors(journalPath: string): ErrorJournalEntry[] {
  return readAllEntries(journalPath).filter((e) => e.status === "pending");
}

/**
 * Read errors by status.
 */
export function readErrorsByStatus(journalPath: string, status: ErrorStatus): ErrorJournalEntry[] {
  return readAllEntries(journalPath).filter((e) => e.status === status);
}

/**
 * Mark an error entry with a new status.
 */
export function markError(
  journalPath: string,
  entryId: string,
  status: ErrorStatus,
  extra?: { resolvedByRef?: string; resolutionSummary?: string },
): boolean {
  const entries = readAllEntries(journalPath);
  const idx = entries.findIndex((e) => e.id === entryId);
  if (idx === -1) {
    return false;
  }

  entries[idx].status = status;
  if (extra?.resolvedByRef) {
    entries[idx].resolvedByRef = extra.resolvedByRef;
  }
  if (extra?.resolutionSummary) {
    entries[idx].resolutionSummary = extra.resolutionSummary;
  }

  writeAllEntries(journalPath, entries);
  return true;
}

/**
 * Prune entries older than retentionDays.
 * Returns the number of entries pruned.
 */
export function pruneOldErrors(
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
      writeAllEntries(journalPath, kept);
    }
  }

  return pruned;
}

/**
 * Get a summary of error journal state for diagnostics.
 */
export function getErrorJournalSummary(journalPath: string): {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  escalated: number;
  dismissed: number;
  bySeverity: Record<ErrorSeverity, number>;
} {
  const entries = readAllEntries(journalPath);
  const summary = {
    total: entries.length,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    escalated: 0,
    dismissed: 0,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } as Record<ErrorSeverity, number>,
  };

  for (const e of entries) {
    switch (e.status) {
      case "pending":
        summary.pending++;
        break;
      case "in-progress":
        summary.inProgress++;
        break;
      case "resolved":
        summary.resolved++;
        break;
      case "escalated":
        summary.escalated++;
        break;
      case "dismissed":
        summary.dismissed++;
        break;
    }
    summary.bySeverity[e.severity]++;
  }

  return summary;
}
