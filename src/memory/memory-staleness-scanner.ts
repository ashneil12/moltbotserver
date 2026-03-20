/**
 * Memory staleness scanner — detects dated entries in MEMORY.md
 * that may have gone stale and should be reviewed.
 *
 * This is a pure function module with no side effects. The caller
 * decides whether to emit a system event, log, or alert.
 *
 * Designed to be called periodically (e.g. from a heartbeat or
 * lightweight cron job) to nudge the agent toward self-review.
 */

import fs from "node:fs";

/** Default: entries older than 90 days are considered potentially stale. */
const DEFAULT_STALENESS_THRESHOLD_DAYS = 90;

/** Matches date markers like [2025-03], [2025-06-15], (2025-01), etc. */
const DATE_MARKER_PATTERN = /[[(](\d{4})-(\d{2})(?:-(\d{2}))?[\])]/g;

export type StaleEntry = {
  /** The matched date string, e.g. "2025-03" or "2025-06-15". */
  date: string;
  /** The line number in the file (1-indexed). */
  line: number;
  /** A short snippet of the surrounding text (up to 100 chars). */
  snippet: string;
};

export type StalenessResult = {
  /** Number of stale entries found. */
  staleCount: number;
  /** The stale entries with context. */
  entries: StaleEntry[];
  /** Whether the file was found and readable. */
  fileFound: boolean;
};

/**
 * Scan a memory file for dated entries that are older than the threshold.
 *
 * @param memoryFilePath - Path to the memory file (e.g. `MEMORY.md`).
 * @param opts - Configuration options.
 */
export function scanMemoryForStaleness(
  memoryFilePath: string,
  opts?: {
    /** Threshold in days — entries older than this are stale. Default: 90. */
    thresholdDays?: number;
    /** Override "now" for testing. */
    nowMs?: number;
  },
): StalenessResult {
  const thresholdDays = opts?.thresholdDays ?? DEFAULT_STALENESS_THRESHOLD_DAYS;
  const nowMs = opts?.nowMs ?? Date.now();
  const cutoffMs = nowMs - thresholdDays * 24 * 60 * 60_000;

  if (!fs.existsSync(memoryFilePath)) {
    return { staleCount: 0, entries: [], fileFound: false };
  }

  let content: string;
  try {
    content = fs.readFileSync(memoryFilePath, "utf-8");
  } catch {
    return { staleCount: 0, entries: [], fileFound: false };
  }

  const lines = content.split("\n");
  const staleEntries: StaleEntry[] = [];
  const seenDates = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    // Reset regex state for each line
    DATE_MARKER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = DATE_MARKER_PATTERN.exec(line)) !== null) {
      const [, yearStr, monthStr, dayStr] = match;
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = dayStr ? Number(dayStr) : 1;

      // Basic validation
      if (year < 2020 || year > 2100) {
        continue;
      }
      if (month < 1 || month > 12) {
        continue;
      }
      if (day < 1 || day > 31) {
        continue;
      }

      const dateStr = dayStr ? `${yearStr}-${monthStr}-${dayStr}` : `${yearStr}-${monthStr}`;

      // Skip if we already recorded this date on an earlier line
      if (seenDates.has(dateStr)) {
        continue;
      }

      const dateMs = new Date(
        `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}T00:00:00Z`,
      ).getTime();

      if (Number.isNaN(dateMs)) {
        continue;
      }

      if (dateMs < cutoffMs) {
        seenDates.add(dateStr);
        // Build a snippet: trim the line and cap at 100 chars
        const snippet = line.trim().slice(0, 100);
        staleEntries.push({
          date: dateStr,
          line: i + 1, // 1-indexed
          snippet,
        });
      }
    }
  }

  return {
    staleCount: staleEntries.length,
    entries: staleEntries,
    fileFound: true,
  };
}

/**
 * Build a human-readable summary of stale entries for system event emission.
 */
export function formatStalenessSummary(result: StalenessResult): string | null {
  if (result.staleCount === 0) {
    return null;
  }

  const header = `Found ${result.staleCount} potentially stale memory ${result.staleCount === 1 ? "entry" : "entries"} — consider reviewing during your next self-review:`;
  const items = result.entries
    .slice(0, 10) // Cap at 10 to avoid overwhelming the agent
    .map((entry) => `  • Line ${entry.line} [${entry.date}]: ${entry.snippet}`);

  if (result.staleCount > 10) {
    items.push(`  • ...and ${result.staleCount - 10} more`);
  }

  return [header, ...items].join("\n");
}
