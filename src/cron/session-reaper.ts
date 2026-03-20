/**
 * Cron session reaper — prunes completed isolated cron run sessions
 * from the session store after a configurable retention period.
 *
 * Pattern: sessions keyed as `...:cron:<jobId>:run:<uuid>` are ephemeral
 * run records. The base session (`...:cron:<jobId>`) is kept as-is.
 */

import fs from "node:fs";
import path from "node:path";
import { parseDurationMs } from "../cli/parse-duration.js";
import {
  archiveRemovedSessionTranscripts,
  loadSessionStore,
  updateSessionStore,
} from "../config/sessions.js";
import type { CronConfig } from "../config/types.cron.js";
import { cleanupArchivedSessionTranscripts } from "../gateway/session-utils.fs.js";
import { isCronRunSessionKey } from "../sessions/session-key-utils.js";
import type { Logger } from "./service/state.js";

const DEFAULT_RETENTION_MS = 24 * 3_600_000; // 24 hours

/** Minimum interval between reaper sweeps (avoid running every timer tick). */
const MIN_SWEEP_INTERVAL_MS = 5 * 60_000; // 5 minutes

const lastSweepAtMsByStore = new Map<string, number>();

export function resolveRetentionMs(cronConfig?: CronConfig): number | null {
  if (cronConfig?.sessionRetention === false) {
    return null; // pruning disabled
  }
  const raw = cronConfig?.sessionRetention;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseDurationMs(raw.trim(), { defaultUnit: "h" });
    } catch {
      return DEFAULT_RETENTION_MS;
    }
  }
  return DEFAULT_RETENTION_MS;
}

export type ReaperResult = {
  swept: boolean;
  pruned: number;
};

/**
 * Sweep the session store and prune expired cron run sessions.
 * Designed to be called from the cron timer tick — self-throttles via
 * MIN_SWEEP_INTERVAL_MS to avoid excessive I/O.
 *
 * Lock ordering: this function acquires the session-store file lock via
 * `updateSessionStore`. It must be called OUTSIDE of the cron service's
 * own `locked()` section to avoid lock-order inversions. The cron timer
 * calls this after all `locked()` sections have been released.
 */
export async function sweepCronRunSessions(params: {
  cronConfig?: CronConfig;
  /** Resolved path to sessions.json — required. */
  sessionStorePath: string;
  nowMs?: number;
  log: Logger;
  /** Override for testing — skips the min-interval throttle. */
  force?: boolean;
}): Promise<ReaperResult> {
  const now = params.nowMs ?? Date.now();
  const storePath = params.sessionStorePath;
  const lastSweepAtMs = lastSweepAtMsByStore.get(storePath) ?? 0;

  // Throttle: don't sweep more often than every 5 minutes.
  if (!params.force && now - lastSweepAtMs < MIN_SWEEP_INTERVAL_MS) {
    return { swept: false, pruned: 0 };
  }

  const retentionMs = resolveRetentionMs(params.cronConfig);
  if (retentionMs === null) {
    lastSweepAtMsByStore.set(storePath, now);
    return { swept: false, pruned: 0 };
  }

  let pruned = 0;
  const prunedSessions = new Map<string, string | undefined>();
  try {
    await updateSessionStore(storePath, (store) => {
      const cutoff = now - retentionMs;
      for (const key of Object.keys(store)) {
        if (!isCronRunSessionKey(key)) {
          continue;
        }
        const entry = store[key];
        if (!entry) {
          continue;
        }
        const updatedAt = entry.updatedAt ?? 0;
        if (updatedAt < cutoff) {
          if (!prunedSessions.has(entry.sessionId) || entry.sessionFile) {
            prunedSessions.set(entry.sessionId, entry.sessionFile);
          }
          delete store[key];
          pruned++;
        }
      }
    });
  } catch (err) {
    params.log.warn({ err: String(err) }, "cron-reaper: failed to sweep session store");
    return { swept: false, pruned: 0 };
  }

  lastSweepAtMsByStore.set(storePath, now);

  if (prunedSessions.size > 0) {
    try {
      const store = loadSessionStore(storePath, { skipCache: true });
      const referencedSessionIds = new Set(
        Object.values(store)
          .map((entry) => entry?.sessionId)
          .filter((id): id is string => Boolean(id)),
      );
      const archivedDirs = archiveRemovedSessionTranscripts({
        removedSessionFiles: prunedSessions,
        referencedSessionIds,
        storePath,
        reason: "deleted",
        restrictToStoreDir: true,
      });
      if (archivedDirs.size > 0) {
        await cleanupArchivedSessionTranscripts({
          directories: [...archivedDirs],
          olderThanMs: retentionMs,
          reason: "deleted",
          nowMs: now,
        });
      }
    } catch (err) {
      params.log.warn({ err: String(err) }, "cron-reaper: transcript cleanup failed");
    }
  }

  if (pruned > 0) {
    params.log.info(
      { pruned, retentionMs },
      `cron-reaper: pruned ${pruned} expired cron run session(s)`,
    );
  }

  return { swept: true, pruned };
}

// ═══════════════════════════════════════════════════════════════════════════
// File-age retention — delete orphaned .jsonl files from disk
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SESSION_FILE_RETENTION_DAYS = 30;

/** Files that must never be deleted regardless of age. */
const PROTECTED_FILES = new Set(["sessions.json", "main.jsonl"]);

function resolveFileRetentionMs(cronConfig?: CronConfig): number | null {
  if (cronConfig?.sessionFileRetentionDays === false) {
    return null; // disabled
  }
  const days = cronConfig?.sessionFileRetentionDays ?? DEFAULT_SESSION_FILE_RETENTION_DAYS;
  if (typeof days === "number" && days > 0) {
    return days * 24 * 3_600_000;
  }
  return DEFAULT_SESSION_FILE_RETENTION_DAYS * 24 * 3_600_000;
}

export type StaleFileResult = {
  swept: boolean;
  deleted: number;
  freedBytes: number;
};

const lastFileSweepAtMsByStore = new Map<string, number>();

/**
 * Sweep session directories for orphaned .jsonl files older than
 * `sessionFileRetentionDays`. This catch-all handles files that metadata
 * pruning may have missed (e.g. old files from before metadata tracking).
 *
 * Directly addresses the community-reported issue where cron session files
 * accumulate into GBs and degrade OpenClaw performance.
 */
export async function sweepStaleSessionFiles(params: {
  cronConfig?: CronConfig;
  /** Directory containing per-agent session directories. */
  sessionStorePath: string;
  nowMs?: number;
  log: Logger;
  force?: boolean;
}): Promise<StaleFileResult> {
  const now = params.nowMs ?? Date.now();
  const storePath = params.sessionStorePath;
  const lastSweep = lastFileSweepAtMsByStore.get(storePath) ?? 0;

  // Throttle to every 30 minutes (heavier than metadata sweep).
  if (!params.force && now - lastSweep < 30 * 60_000) {
    return { swept: false, deleted: 0, freedBytes: 0 };
  }

  const retentionMs = resolveFileRetentionMs(params.cronConfig);
  if (retentionMs === null) {
    lastFileSweepAtMsByStore.set(storePath, now);
    return { swept: false, deleted: 0, freedBytes: 0 };
  }

  // Determine the sessions directory from the session store path.
  // sessionStorePath is typically "agents/<agentId>/sessions/sessions.json"
  // or just the directory containing session files.
  const sessionsDir = storePath.endsWith("sessions.json") ? path.dirname(storePath) : storePath;

  let deleted = 0;
  let freedBytes = 0;

  try {
    if (!fs.existsSync(sessionsDir)) {
      lastFileSweepAtMsByStore.set(storePath, now);
      return { swept: true, deleted: 0, freedBytes: 0 };
    }

    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    const cutoff = now - retentionMs;

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) {
        continue;
      }
      if (PROTECTED_FILES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(sessionsDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          deleted++;
          freedBytes += stat.size;
        }
      } catch {
        // skip inaccessible files
      }
    }
  } catch (err) {
    params.log.warn({ err: String(err) }, "cron-reaper: stale file sweep failed");
    return { swept: false, deleted: 0, freedBytes: 0 };
  }

  lastFileSweepAtMsByStore.set(storePath, now);

  if (deleted > 0) {
    const freedMB = Math.round(freedBytes / 1024 / 1024);
    params.log.info(
      { deleted, freedBytes, freedMB },
      `cron-reaper: deleted ${deleted} stale session file(s), freed ${freedMB}MB`,
    );
  }

  return { swept: true, deleted, freedBytes };
}

/** Reset the throttle timer (for tests). */
export function resetReaperThrottle(): void {
  lastSweepAtMsByStore.clear();
  lastFileSweepAtMsByStore.clear();
}
