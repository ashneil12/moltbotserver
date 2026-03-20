/**
 * Memory file rotator — consolidates old daily memory files into monthly archives.
 *
 * OpenClaw's memory-flush system writes daily `memory/YYYY-MM-DD.md` files.
 * Over months, hundreds of daily files accumulate and degrade retrieval quality.
 * This module consolidates files older than a configurable threshold into
 * monthly archives at `memory/archive/YYYY-MM.md`.
 *
 * Designed to be called periodically from the cron timer tick (self-throttled).
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory-file-rotator");

/** Default: rotate daily files older than 30 days. */
const DEFAULT_MAX_AGE_DAYS = 30;

/** Minimum rotation interval: once per day. */
const DEFAULT_ROTATION_INTERVAL_MS = 24 * 60 * 60_000;

/** Minimum interval to prevent tight loops. */
const MIN_ROTATION_INTERVAL_MS = 60 * 60_000; // 1 hour

/** Pattern matching daily memory files: YYYY-MM-DD.md */
const DAILY_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

const lastRotationAtMsByDir = new Map<string, number>();

export type MemoryFileGroup = {
  /** Month key: YYYY-MM */
  month: string;
  /** Daily files in this month, sorted chronologically. */
  files: Array<{ name: string; date: string; absPath: string }>;
};

export type RotationResult = {
  rotated: boolean;
  /** Number of monthly archive files created/updated. */
  archivesWritten: number;
  /** Number of daily files deleted after archiving. */
  dailyFilesDeleted: number;
};

/**
 * Scan a memory directory for daily files eligible for rotation.
 * Returns files grouped by month.
 */
export function resolveMemoryFilesToRotate(
  memoryDir: string,
  nowMs: number,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): MemoryFileGroup[] {
  if (!fs.existsSync(memoryDir)) {
    return [];
  }

  const cutoffMs = nowMs - maxAgeDays * 24 * 60 * 60_000;
  const entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  const groups = new Map<string, MemoryFileGroup>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = DAILY_FILE_PATTERN.exec(entry.name);
    if (!match) {
      continue;
    }

    const [, year, month, day] = match;
    const dateStr = `${year}-${month}-${day}`;
    const fileDate = new Date(`${dateStr}T00:00:00Z`).getTime();

    // Guard against invalid dates (e.g. 2025-02-30.md)
    if (Number.isNaN(fileDate)) {
      continue;
    }

    // Only rotate files older than the cutoff
    if (fileDate >= cutoffMs) {
      continue;
    }

    const monthKey = `${year}-${month}`;
    if (!groups.has(monthKey)) {
      groups.set(monthKey, { month: monthKey, files: [] });
    }
    groups.get(monthKey)!.files.push({
      name: entry.name,
      date: dateStr,
      absPath: path.join(memoryDir, entry.name),
    });
  }

  // Sort files within each group chronologically
  for (const group of groups.values()) {
    group.files.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Sort groups chronologically
  return [...groups.values()].toSorted((a, b) => a.month.localeCompare(b.month));
}

/**
 * Rotate old daily memory files into monthly archives.
 *
 * @param workspaceDir - The agent's workspace directory (contains `memory/`).
 * @param opts - Configuration options.
 */
export function rotateOldMemoryFiles(
  workspaceDir: string,
  opts?: {
    maxAgeDays?: number;
    nowMs?: number;
    /** If true, skip throttle check. */
    force?: boolean;
    /** Override rotation interval in ms. */
    intervalMs?: number;
  },
): RotationResult {
  const now = opts?.nowMs ?? Date.now();
  const memoryDir = path.join(workspaceDir, "memory");
  const intervalMs = Math.max(
    MIN_ROTATION_INTERVAL_MS,
    opts?.intervalMs ?? DEFAULT_ROTATION_INTERVAL_MS,
  );

  // Self-throttle
  const lastRotation = lastRotationAtMsByDir.get(memoryDir) ?? 0;
  if (!opts?.force && now - lastRotation < intervalMs) {
    return { rotated: false, archivesWritten: 0, dailyFilesDeleted: 0 };
  }

  lastRotationAtMsByDir.set(memoryDir, now);

  const groups = resolveMemoryFilesToRotate(
    memoryDir,
    now,
    opts?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
  );

  if (groups.length === 0) {
    return { rotated: true, archivesWritten: 0, dailyFilesDeleted: 0 };
  }

  const archiveDir = path.join(memoryDir, "archive");
  let archivesWritten = 0;
  let dailyFilesDeleted = 0;

  for (const group of groups) {
    const archivePath = path.join(archiveDir, `${group.month}.md`);

    try {
      // Build the content to append
      const sections: string[] = [];
      for (const file of group.files) {
        const content = fs.readFileSync(file.absPath, "utf-8").trim();
        if (!content) {
          continue;
        }
        sections.push(`## ${file.date}\n\n${content}`);
      }

      if (sections.length === 0) {
        // All files were empty — clean them up but don't create an archive
        for (const file of group.files) {
          try {
            fs.unlinkSync(file.absPath);
            dailyFilesDeleted++;
          } catch {
            // skip
          }
        }
        continue;
      }

      const newContent = sections.join("\n\n---\n\n");

      // Create archive directory if needed
      fs.mkdirSync(archiveDir, { recursive: true });

      // Append to existing archive or create new
      if (fs.existsSync(archivePath)) {
        const existing = fs.readFileSync(archivePath, "utf-8").trimEnd();
        fs.writeFileSync(archivePath, `${existing}\n\n---\n\n${newContent}\n`, "utf-8");
      } else {
        fs.writeFileSync(
          archivePath,
          `# Memory Archive — ${group.month}\n\n${newContent}\n`,
          "utf-8",
        );
      }
      archivesWritten++;

      // Delete the original daily files
      for (const file of group.files) {
        try {
          fs.unlinkSync(file.absPath);
          dailyFilesDeleted++;
        } catch {
          // skip — file may have been removed externally
        }
      }
    } catch (err) {
      log.warn(`failed to archive ${group.month}: ${String(err)}`);
    }
  }

  if (archivesWritten > 0 || dailyFilesDeleted > 0) {
    log.info(
      `archived ${dailyFilesDeleted} daily files into ${archivesWritten} monthly archive(s)`,
    );
  }

  return { rotated: true, archivesWritten, dailyFilesDeleted };
}

/** Reset the throttle timer (for tests). */
export function resetMemoryFileRotatorThrottle(): void {
  lastRotationAtMsByDir.clear();
}
