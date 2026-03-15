/**
 * Health Sentinel — history tracking.
 *
 * Appends SentinelReport summaries to a JSONL file for trend analysis.
 * The agent escalation message is enriched with trend context
 * (e.g. "channel:telegram has failed 4 of last 6 checks").
 *
 * Max file size: 1MB — auto-truncates oldest half when exceeded.
 */

import fs from "node:fs";
import path from "node:path";
import type { SentinelReport } from "./health-sentinel-types.js";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("health-sentinel/history");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const HISTORY_FILE = "sentinel-history.jsonl";
const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Compact summary stored per sentinel run (not the full report). */
export interface HistoryEntry {
  timestamp: string;
  healthy: boolean;
  issueKeys: string[];
  remediationCount: number;
  escalated: boolean;
}

export interface TrendAnalysis {
  /** Issue keys that appeared then disappeared then appeared again (≥2 transitions in window) */
  flapping: string[];
  /** Issue keys present in ≥70% of recent reports */
  persistent: string[];
  /** Issue keys that were present earlier but resolved in the most recent reports */
  improving: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// File operations
// ═══════════════════════════════════════════════════════════════════════════

function resolveHistoryPath(stateDir: string): string {
  return path.join(stateDir, HISTORY_FILE);
}

/**
 * Append a sentinel report summary to the history file.
 * Auto-truncates if the file exceeds MAX_FILE_BYTES.
 */
export function appendSentinelReport(report: SentinelReport, stateDir: string): void {
  const entry: HistoryEntry = {
    timestamp: report.timestamp,
    healthy: report.healthy,
    issueKeys: report.issues.map((i) => i.key),
    remediationCount: report.remediations.length,
    escalated: report.escalatedToAgent,
  };

  const filePath = resolveHistoryPath(stateDir);
  const line = JSON.stringify(entry) + "\n";

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line, "utf8");

    // Check size and truncate if needed
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      truncateHistory(filePath);
    }
  } catch (err) {
    log.warn?.(`failed to append sentinel history: ${String(err)}`);
  }
}

/**
 * Truncate the history file by removing the oldest half of entries.
 */
function truncateHistory(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const keepFrom = Math.floor(lines.length / 2);
    const kept = lines.slice(keepFrom).join("\n") + "\n";
    fs.writeFileSync(filePath, kept, "utf8");
    log.info?.(
      `truncated sentinel history: kept ${lines.length - keepFrom}/${lines.length} entries`,
    );
  } catch (err) {
    log.warn?.(`failed to truncate sentinel history: ${String(err)}`);
  }
}

/**
 * Read the most recent N history entries.
 */
export function getRecentReports(stateDir: string, count: number = 20): HistoryEntry[] {
  const filePath = resolveHistoryPath(stateDir);
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const recent = lines.slice(-count);
    const entries: HistoryEntry[] = [];
    for (const line of recent) {
      try {
        entries.push(JSON.parse(line) as HistoryEntry);
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
 * Detect trends from recent history entries.
 */
export function detectTrends(reports: HistoryEntry[]): TrendAnalysis {
  if (reports.length < 2) {
    return { flapping: [], persistent: [], improving: [] };
  }

  // Count presence of each issue key
  const keyPresence = new Map<string, boolean[]>();
  for (const report of reports) {
    const keysInReport = new Set(report.issueKeys);
    // Track all keys we've ever seen
    for (const key of keysInReport) {
      if (!keyPresence.has(key)) {
        keyPresence.set(key, []);
      }
    }
    // For all tracked keys, record whether they were present in this report
    for (const [key, presence] of keyPresence) {
      presence.push(keysInReport.has(key));
    }
  }

  const flapping: string[] = [];
  const persistent: string[] = [];
  const improving: string[] = [];

  for (const [key, presence] of keyPresence) {
    // Only analyze keys that have enough data points
    if (presence.length < 2) {
      continue;
    }

    const presenceCount = presence.filter(Boolean).length;
    const presenceRate = presenceCount / presence.length;

    // Persistent: present in ≥70% of reports
    if (presenceRate >= 0.7 && presenceCount >= 2) {
      persistent.push(key);
      continue;
    }

    // Count transitions (present→absent or absent→present)
    let transitions = 0;
    for (let i = 1; i < presence.length; i++) {
      if (presence[i] !== presence[i - 1]) {
        transitions++;
      }
    }

    // Flapping: ≥2 transitions
    if (transitions >= 2) {
      flapping.push(key);
      continue;
    }

    // Improving: was present earlier but resolved in the last 2 reports
    const recentReports = presence.slice(-2);
    const olderReports = presence.slice(0, -2);
    if (olderReports.some(Boolean) && recentReports.every((p) => !p)) {
      improving.push(key);
    }
  }

  return { flapping, persistent, improving };
}

/**
 * Format trend context for inclusion in agent escalation messages.
 */
export function formatTrendContext(trends: TrendAnalysis): string | null {
  const lines: string[] = [];

  if (trends.persistent.length > 0) {
    lines.push(
      `Persistent issues (present in ≥70% of recent checks): ${trends.persistent.join(", ")}`,
    );
  }
  if (trends.flapping.length > 0) {
    lines.push(`Flapping issues (appearing and disappearing): ${trends.flapping.join(", ")}`);
  }
  if (trends.improving.length > 0) {
    lines.push(`Recently resolved: ${trends.improving.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
