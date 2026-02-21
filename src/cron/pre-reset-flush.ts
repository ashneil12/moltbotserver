/**
 * Pre-reset memory flush — runs a memory flush agent turn on all active
 * sessions ~20 minutes before the daily session reset so the agent can
 * persist durable memories before the context is discarded.
 *
 * Lifecycle: started alongside the CronService in `server-cron.ts`,
 * fires once daily at `resetAtHour - leadMinutes` (default 3:40 AM).
 */

import type { OpenClawConfig } from "../config/config.js";
import type { CronJob } from "./types.js";
import {
  loadSessionStore,
  updateSessionStoreEntry,
  type SessionEntry,
} from "../config/sessions.js";
import { DEFAULT_RESET_AT_HOUR } from "../config/sessions/reset.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import type { RunCronAgentTurnResult } from "./isolated-agent.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many minutes before the daily reset to run the flush. */
export const DEFAULT_PRE_RESET_LEAD_MINUTES = 20;

/** Minimum context tokens a session must have to be worth flushing. */
const MIN_FLUSH_TOKENS = 2000;

/** Maximum number of sessions to flush per sweep (prevent runaway API usage). */
const MAX_FLUSH_PER_SWEEP = 20;

/** Timer re-arm interval — recompute next flush every 60 seconds. */
const TIMER_TICK_MS = 60_000;

const PRE_RESET_FLUSH_PROMPT = [
  "Pre-reset memory flush.",
  "The daily session reset will happen in ~20 minutes — store any durable memories now.",
  "Use memory/YYYY-MM-DD.md; create memory/ if needed.",
  "IMPORTANT: If the file already exists, APPEND new content only and do not overwrite existing entries.",
  `If nothing to store, reply with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

// ---------------------------------------------------------------------------
// Timer computation
// ---------------------------------------------------------------------------

/**
 * Compute the next flush time as an absolute timestamp (ms since epoch).
 *
 * The flush fires at `atHour` hours minus `leadMinutes` minutes, in the
 * gateway host's local timezone (matching resolveDailyResetAtMs behavior).
 */
export function computeNextPreResetFlushMs(
  nowMs: number,
  atHour: number,
  leadMinutes: number = DEFAULT_PRE_RESET_LEAD_MINUTES,
): number {
  const normalizedHour = Math.max(0, Math.min(23, Math.floor(atHour)));
  const flushDate = new Date(nowMs);

  // Compute flush hour and minute: e.g. atHour=4, lead=20 → 3:40 AM
  const totalMinutes = normalizedHour * 60 - leadMinutes;
  const flushHour = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60);
  const flushMinute = ((totalMinutes % 1440) + 1440) % 1440 % 60;

  flushDate.setHours(flushHour, flushMinute, 0, 0);

  // If the computed time is in the past, schedule for tomorrow
  if (flushDate.getTime() <= nowMs) {
    flushDate.setDate(flushDate.getDate() + 1);
  }

  return flushDate.getTime();
}

/**
 * Returns the ms delta from `nowMs` until the next pre-reset flush.
 */
export function msUntilNextPreResetFlush(
  nowMs: number,
  atHour: number,
  leadMinutes?: number,
): number {
  return computeNextPreResetFlushMs(nowMs, atHour, leadMinutes) - nowMs;
}

// ---------------------------------------------------------------------------
// Session eligibility
// ---------------------------------------------------------------------------

/**
 * Determine whether a session entry is eligible for a pre-reset flush.
 *
 * A session is eligible when:
 * 1. It has meaningful context (totalTokens ≥ threshold)
 * 2. It hasn't already been pre-reset-flushed today
 * 3. It's not a cron-run session (transient, separate lifecycle)
 */
export function isEligibleForPreResetFlush(
  sessionKey: string,
  entry: SessionEntry,
  nowMs: number,
): boolean {
  // Skip cron run sessions (ephemeral, managed by the reaper)
  if (sessionKey.includes(":cron:") && sessionKey.includes(":run:")) {
    return false;
  }

  // Must have meaningful context
  const totalTokens = entry.totalTokens;
  if (typeof totalTokens !== "number" || totalTokens < MIN_FLUSH_TOKENS) {
    return false;
  }

  // Skip if already flushed in the last 20 hours (prevents double-flush across restarts)
  const lastFlush = entry.preResetFlushAt;
  if (typeof lastFlush === "number" && nowMs - lastFlush < 20 * 3_600_000) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sweep logic
// ---------------------------------------------------------------------------

export type PreResetFlushResult = {
  flushed: number;
  skipped: number;
  errors: number;
};

export type PreResetFlushDeps = {
  cfg: OpenClawConfig;
  sessionStorePath: string;
  runIsolatedAgentJob: (params: {
    job: CronJob;
    message: string;
  }) => Promise<RunCronAgentTurnResult>;
  log: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
};

/**
 * Sweep all sessions in the store and run pre-reset memory flush turns
 * on eligible ones.
 */
export async function runPreResetFlushSweep(
  deps: PreResetFlushDeps,
): Promise<PreResetFlushResult> {
  const nowMs = Date.now();
  const store = loadSessionStore(deps.sessionStorePath, { skipCache: true });
  const eligible: Array<{ key: string; entry: SessionEntry }> = [];

  for (const [key, entry] of Object.entries(store)) {
    if (entry && isEligibleForPreResetFlush(key, entry, nowMs)) {
      eligible.push({ key, entry });
    }
  }

  if (eligible.length === 0) {
    deps.log.info({}, "pre-reset-flush: no eligible sessions");
    return { flushed: 0, skipped: 0, errors: 0 };
  }

  // Sort by most context first (flush the most valuable sessions first)
  eligible.sort((a, b) => (b.entry.totalTokens ?? 0) - (a.entry.totalTokens ?? 0));

  // Cap to prevent runaway usage
  const toFlush = eligible.slice(0, MAX_FLUSH_PER_SWEEP);
  const skipped = eligible.length - toFlush.length;

  deps.log.info(
    { eligible: eligible.length, flushing: toFlush.length, skipped },
    `pre-reset-flush: starting sweep for ${toFlush.length} session(s)`,
  );

  let flushed = 0;
  let errors = 0;

  for (const { key, entry } of toFlush) {
    try {
      // Build a synthetic cron job for the flush turn
      const syntheticJob = buildPreResetFlushJob(key, entry);
      await deps.runIsolatedAgentJob({
        job: syntheticJob,
        message: PRE_RESET_FLUSH_PROMPT,
      });

      // Mark session as flushed
      try {
        await updateSessionStoreEntry({
          storePath: deps.sessionStorePath,
          sessionKey: key,
          update: async () => ({ preResetFlushAt: Date.now() }),
        });
      } catch {
        // Best-effort metadata update
      }

      flushed++;
      deps.log.info(
        { sessionKey: key, tokens: entry.totalTokens },
        `pre-reset-flush: flushed session ${key}`,
      );
    } catch (err) {
      errors++;
      deps.log.warn(
        { sessionKey: key, err: String(err) },
        `pre-reset-flush: failed to flush session ${key}`,
      );
    }
  }

  deps.log.info(
    { flushed, skipped, errors },
    `pre-reset-flush: sweep complete — flushed=${flushed} skipped=${skipped} errors=${errors}`,
  );

  return { flushed, skipped, errors };
}

// ---------------------------------------------------------------------------
// Synthetic job builder
// ---------------------------------------------------------------------------

function buildPreResetFlushJob(sessionKey: string, entry: SessionEntry): CronJob {
  const now = Date.now();
  return {
    id: `__pre-reset-flush:${sessionKey}`,
    name: "Pre-reset memory flush",
    description: "Automated pre-reset memory flush before daily session expiry",
    enabled: true,
    deleteAfterRun: true,
    createdAtMs: now,
    updatedAtMs: now,
    sessionKey,
    schedule: { kind: "at", at: new Date(now).toISOString() },
    sessionTarget: "main",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: PRE_RESET_FLUSH_PROMPT,
      deliver: false,
    },
    state: {},
  };
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

let activeTimer: ReturnType<typeof setTimeout> | null = null;

export type PreResetFlushTimerDeps = PreResetFlushDeps & {
  /** The configured daily reset hour (0–23). */
  resetAtHour?: number;
  /** Minutes before reset to run the flush. */
  leadMinutes?: number;
};

/**
 * Start the pre-reset flush timer. Fires once daily at the computed time.
 * Safe to call multiple times — stops any existing timer first.
 */
export function startPreResetFlushTimer(deps: PreResetFlushTimerDeps): void {
  stopPreResetFlushTimer();

  const atHour = deps.resetAtHour ?? DEFAULT_RESET_AT_HOUR;
  const leadMinutes = deps.leadMinutes ?? DEFAULT_PRE_RESET_LEAD_MINUTES;

  const tick = () => {
    const now = Date.now();
    const msUntil = msUntilNextPreResetFlush(now, atHour, leadMinutes);

    // If the flush is due within the next tick interval, run it now
    if (msUntil <= TIMER_TICK_MS) {
      deps.log.info(
        { msUntil, atHour, leadMinutes },
        "pre-reset-flush: timer firing — starting sweep",
      );
      void runPreResetFlushSweep(deps).catch((err) => {
        deps.log.warn(
          { err: String(err) },
          "pre-reset-flush: sweep failed unexpectedly",
        );
      });
    }
  };

  // Start ticking
  activeTimer = setInterval(tick, TIMER_TICK_MS);

  // Unref so the timer doesn't prevent process exit
  if (activeTimer && typeof activeTimer === "object" && "unref" in activeTimer) {
    activeTimer.unref();
  }

  const now = Date.now();
  const nextFlushMs = computeNextPreResetFlushMs(now, atHour, leadMinutes);
  const msUntil = nextFlushMs - now;
  const minutesUntil = Math.round(msUntil / 60_000);
  deps.log.info(
    { nextFlushAt: new Date(nextFlushMs).toISOString(), minutesUntil, atHour, leadMinutes },
    `pre-reset-flush: timer started — next flush in ~${minutesUntil} minute(s)`,
  );
}

/**
 * Stop the pre-reset flush timer.
 */
export function stopPreResetFlushTimer(): void {
  if (activeTimer !== null) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}
