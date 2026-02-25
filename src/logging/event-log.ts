/**
 * Structured event logging system.
 *
 * Provides per-event JSONL files and a unified `all.jsonl` stream.
 * All entries are auto-redacted for secrets before writing.
 *
 * Usage:
 * ```ts
 * const logger = createEventLogger({ baseDir: "data/logs" });
 * logger.log({ event: "email.received", level: "info", data: { sender: "a@b.com" } });
 * ```
 */

import fs from "node:fs";
import path from "node:path";
import { redactSensitiveText } from "./redact.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventLevel = "debug" | "info" | "warn" | "error";

export interface EventEntry {
  /** ISO 8601 timestamp (auto-generated if omitted) */
  timestamp?: string;
  /** Dot-namespaced event name, e.g. "email.received", "cron.failed" */
  event: string;
  /** Severity level */
  level: EventLevel;
  /** Arbitrary structured data */
  data: Record<string, unknown>;
  /** Source subsystem */
  subsystem?: string;
}

export interface StoredEventEntry extends Required<Pick<EventEntry, "timestamp">> {
  event: string;
  level: EventLevel;
  data: Record<string, unknown>;
  subsystem?: string;
}

export interface EventLoggerOptions {
  /** Directory for log files. Default: "data/logs" */
  baseDir?: string;
  /** Whether to redact secrets prior to writing. Default: true */
  redact?: boolean;
  /** Custom write function (for testing). Default: fs.appendFileSync */
  writeFn?: (filePath: string, data: string) => void;
}

export interface EventLogFilters {
  /** Filter by event name (exact match or prefix with trailing dot) */
  event?: string;
  /** Filter by minimum level */
  level?: EventLevel;
  /** Full-text substring search in the serialized entry */
  search?: string;
  /** Start time (ISO string or Date) */
  since?: string | Date;
  /** End time (ISO string or Date) */
  until?: string | Date;
  /** Max results to return */
  limit?: number;
}

export interface LogRotationOptions {
  /** Max file size in bytes before rotation. Default: 50MB */
  maxBytes?: number;
  /** Number of rotated files to keep per event. Default: 3 */
  keepCount?: number;
}

export interface LogReviewReport {
  /** Time range reviewed */
  since: string;
  until: string;
  /** Total entries reviewed */
  totalEntries: number;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warnCount: number;
  /** Errors grouped by event name */
  errorsByEvent: Record<string, number>;
  /** Most frequent error messages (top 10) */
  topErrors: Array<{ message: string; count: number; event: string }>;
  /** Subsystems with the most errors */
  errorsBySubsystem: Record<string, number>;
  /** Actionable summary for self-healing */
  actionItems: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNIFIED_LOG_FILE = "all.jsonl";
const DEFAULT_BASE_DIR = "data/logs";
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_KEEP_COUNT = 3;

const LEVEL_PRIORITY: Record<EventLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeEventName(event: string): string {
  // Strip path traversal sequences, then remove anything that's not alphanumeric/dot/dash/underscore.
  // Finally, collapse runs of underscores and trim leading/trailing underscores.
  const stripped = event
    .replace(/\.\.\//g, "")
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return stripped || "unknown";
}

function eventFileName(event: string): string {
  return `${sanitizeEventName(event)}.jsonl`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultWriteFn(filePath: string, data: string): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, data, { encoding: "utf8" });
}

function serializeEntry(entry: StoredEventEntry, redact: boolean): string {
  const raw = JSON.stringify(entry);
  return redact ? redactSensitiveText(raw) : raw;
}

// ---------------------------------------------------------------------------
// Event Logger
// ---------------------------------------------------------------------------

export interface EventLogger {
  /** Log a structured event */
  log(entry: EventEntry): void;
  /** Read and filter the unified event log */
  query(filters?: EventLogFilters): StoredEventEntry[];
  /** Get the base directory */
  readonly baseDir: string;
}

/**
 * Create a structured event logger that writes to per-event JSONL files
 * and a unified stream.
 */
export function createEventLogger(options?: EventLoggerOptions): EventLogger {
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
  const shouldRedact = options?.redact !== false;
  const writeFn = options?.writeFn ?? defaultWriteFn;

  const log = (entry: EventEntry) => {
    const stored: StoredEventEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      event: entry.event,
      level: entry.level,
      data: entry.data,
      subsystem: entry.subsystem,
    };

    const line = serializeEntry(stored, shouldRedact) + "\n";

    // Write to per-event file
    const eventFile = path.join(baseDir, eventFileName(stored.event));
    try {
      writeFn(eventFile, line);
    } catch {
      // Never block on logging failures
    }

    // Write to unified stream
    const unifiedFile = path.join(baseDir, UNIFIED_LOG_FILE);
    try {
      writeFn(unifiedFile, line);
    } catch {
      // Never block on logging failures
    }
  };

  const query = (filters?: EventLogFilters): StoredEventEntry[] => {
    const unifiedPath = path.join(baseDir, UNIFIED_LOG_FILE);
    if (!fs.existsSync(unifiedPath)) {
      return [];
    }

    const raw = fs.readFileSync(unifiedPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const limit = filters?.limit ?? 1000;

    const results: StoredEventEntry[] = [];

    for (const line of lines) {
      if (results.length >= limit) {
        break;
      }

      let entry: StoredEventEntry;
      try {
        entry = JSON.parse(line) as StoredEventEntry;
      } catch {
        continue;
      }

      // Apply filters
      if (filters?.event) {
        if (filters.event.endsWith(".")) {
          if (!entry.event.startsWith(filters.event)) {
            continue;
          }
        } else if (entry.event !== filters.event) {
          continue;
        }
      }

      if (filters?.level && LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[filters.level]) {
        continue;
      }

      if (filters?.since) {
        const since = typeof filters.since === "string" ? filters.since : filters.since.toISOString();
        if (entry.timestamp < since) {
          continue;
        }
      }

      if (filters?.until) {
        const until = typeof filters.until === "string" ? filters.until : filters.until.toISOString();
        if (entry.timestamp > until) {
          continue;
        }
      }

      if (filters?.search) {
        if (!line.includes(filters.search)) {
          continue;
        }
      }

      results.push(entry);
    }

    return results;
  };

  return { log, query, baseDir };
}

// ---------------------------------------------------------------------------
// Convenience queries
// ---------------------------------------------------------------------------

/**
 * Get recent errors from the event log.
 */
export function getRecentErrors(
  logger: EventLogger,
  hours: number = 24,
): StoredEventEntry[] {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return logger.query({ level: "error", since });
}

/**
 * Get history for a specific event type.
 */
export function getEventHistory(
  logger: EventLogger,
  event: string,
  limit: number = 50,
): StoredEventEntry[] {
  return logger.query({ event, limit });
}

// ---------------------------------------------------------------------------
// Log rotation
// ---------------------------------------------------------------------------

/**
 * Rotate event log files that exceed the size threshold.
 * Old rotated files beyond keepCount are deleted.
 */
export function rotateEventLogs(
  baseDir: string,
  options?: LogRotationOptions,
): { rotated: string[]; deleted: string[] } {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const keepCount = options?.keepCount ?? DEFAULT_KEEP_COUNT;
  const rotated: string[] = [];
  const deleted: string[] = [];

  if (!fs.existsSync(baseDir)) {
    return { rotated, deleted };
  }

  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const filePath = path.join(baseDir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    if (stat.size <= maxBytes) {
      continue;
    }

    // Rotate: rename to file.TIMESTAMP.jsonl
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = file.replace(/\.jsonl$/, "");
    const rotatedName = `${baseName}.${timestamp}.jsonl`;
    const rotatedPath = path.join(baseDir, rotatedName);

    try {
      fs.renameSync(filePath, rotatedPath);
      rotated.push(rotatedName);
    } catch {
      continue;
    }

    // Clean up old rotations beyond keepCount
    const rotatedFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.startsWith(`${baseName}.`) && f !== file && f.endsWith(".jsonl"))
      .toSorted()
      .toReversed();

    for (const oldFile of rotatedFiles.slice(keepCount)) {
      try {
        fs.unlinkSync(path.join(baseDir, oldFile));
        deleted.push(oldFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return { rotated, deleted };
}

// ---------------------------------------------------------------------------
// Log review (self-healing support)
// ---------------------------------------------------------------------------

/**
 * Review recent logs and produce an actionable report.
 * Designed to be called from a morning cron job — the agent reads
 * this report and auto-fixes any issues.
 */
export function reviewLogs(
  logger: EventLogger,
  since: Date,
  until?: Date,
): LogReviewReport {
  const sinceStr = since.toISOString();
  const untilStr = (until ?? new Date()).toISOString();

  const allEntries = logger.query({ since: sinceStr, until: untilStr, limit: 10000 });

  const errors = allEntries.filter((e) => e.level === "error");
  const warnings = allEntries.filter((e) => e.level === "warn");

  // Group errors by event
  const errorsByEvent: Record<string, number> = {};
  for (const e of errors) {
    errorsByEvent[e.event] = (errorsByEvent[e.event] ?? 0) + 1;
  }

  // Group errors by subsystem
  const errorsBySubsystem: Record<string, number> = {};
  for (const e of errors) {
    const sub = e.subsystem ?? "unknown";
    errorsBySubsystem[sub] = (errorsBySubsystem[sub] ?? 0) + 1;
  }

  // Find most frequent error messages
  const messageCounts = new Map<string, { count: number; event: string }>();
  for (const e of errors) {
    const msg = String(e.data.message ?? e.data.error ?? JSON.stringify(e.data)).slice(0, 200);
    const existing = messageCounts.get(msg);
    if (existing) {
      existing.count += 1;
    } else {
      messageCounts.set(msg, { count: 1, event: e.event });
    }
  }

  const topErrors = [...messageCounts.entries()]
    .map(([message, { count, event }]) => ({ message, count, event }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  // Generate action items
  const actionItems: string[] = [];

  if (errors.length > 20) {
    actionItems.push(
      `High error volume: ${errors.length} errors in the review period. Investigate the top error sources.`,
    );
  }

  for (const [event, count] of Object.entries(errorsByEvent)) {
    if (count >= 5) {
      actionItems.push(
        `Recurring errors in "${event}": ${count} occurrences. Check the ${event} subsystem for systematic issues.`,
      );
    }
  }

  for (const { message, count } of topErrors) {
    if (count >= 3) {
      actionItems.push(`Repeated error (${count}x): "${message.slice(0, 100)}"`);
    }
  }

  if (warnings.length > 50) {
    actionItems.push(
      `High warning volume: ${warnings.length} warnings. Review for patterns indicating degradation.`,
    );
  }

  if (actionItems.length === 0 && errors.length === 0) {
    actionItems.push("No errors found. All systems healthy.");
  }

  return {
    since: sinceStr,
    until: untilStr,
    totalEntries: allEntries.length,
    errorCount: errors.length,
    warnCount: warnings.length,
    errorsByEvent,
    topErrors,
    errorsBySubsystem,
    actionItems,
  };
}
