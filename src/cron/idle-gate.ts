/**
 * Idle Gate — MetaClaw-inspired OMLS (Opportunistic Meta-Learning Scheduler)
 *
 * Gates heavy cron jobs behind user idle detection. Jobs tagged with
 * `idleOnly: true` are deferred until the user has been inactive for a
 * configurable threshold OR the current time falls within a "sleep window".
 *
 * This prevents heavy background work (reflection, skill evolution, etc.)
 * from consuming resources while the user is actively chatting.
 *
 * Inspired by MetaClaw v0.3.0's OMLS scheduler which uses keyboard idle,
 * sleep hours, and Google Calendar signals. Our server-side adaptation
 * uses lastActivityAt timestamps from session bindings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdleGateConfig = {
  /**
   * Minimum idle time in milliseconds before a job is allowed to run.
   * Default: 30 minutes (1_800_000 ms).
   */
  idleThresholdMs: number;

  /**
   * Start of the sleep window in hours UTC (0–23).
   * During the sleep window, idle-gated jobs run unconditionally.
   * Set to undefined to disable the sleep window.
   */
  sleepWindowStartHour?: number;

  /**
   * End of the sleep window in hours UTC (0–23).
   * Set to undefined to disable the sleep window.
   */
  sleepWindowEndHour?: number;

  /**
   * Re-check interval in ms when a job is deferred due to user activity.
   * The job's nextRunAtMs is bumped by this amount.
   * Default: 5 minutes (300_000 ms).
   */
  deferIntervalMs: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** 30 minutes default idle threshold. */
export const DEFAULT_IDLE_THRESHOLD_MS = 30 * 60_000;

/** 5-minute re-check interval for deferred jobs. */
export const DEFAULT_DEFER_INTERVAL_MS = 5 * 60_000;

/** Default sleep window: 23:00–07:00 UTC. */
export const DEFAULT_SLEEP_WINDOW_START_HOUR = 23;
export const DEFAULT_SLEEP_WINDOW_END_HOUR = 7;

export const DEFAULT_IDLE_GATE_CONFIG: IdleGateConfig = {
  idleThresholdMs: DEFAULT_IDLE_THRESHOLD_MS,
  sleepWindowStartHour: DEFAULT_SLEEP_WINDOW_START_HOUR,
  sleepWindowEndHour: DEFAULT_SLEEP_WINDOW_END_HOUR,
  deferIntervalMs: DEFAULT_DEFER_INTERVAL_MS,
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Check if the user is idle based on the last activity timestamp.
 * Returns true if the user has been inactive for at least `idleThresholdMs`.
 *
 * When `lastActivityAtMs` is 0 or undefined, the user is considered idle
 * (no activity data → no reason to defer).
 */
export function isUserIdle(params: {
  lastActivityAtMs: number | undefined;
  nowMs: number;
  config: IdleGateConfig;
}): boolean {
  const { lastActivityAtMs, nowMs, config } = params;

  // No activity recorded → treat as idle (don't block jobs unnecessarily)
  if (!lastActivityAtMs || lastActivityAtMs <= 0) {
    return true;
  }

  const idleMs = nowMs - lastActivityAtMs;
  return idleMs >= config.idleThresholdMs;
}

/**
 * Check if the current time falls within the configured sleep window.
 * The sleep window wraps around midnight (e.g. 23:00–07:00).
 *
 * Returns false if sleep window is not configured (start or end is undefined).
 */
export function isInSleepWindow(params: { nowMs: number; config: IdleGateConfig }): boolean {
  const { nowMs, config } = params;
  const startHour = config.sleepWindowStartHour;
  const endHour = config.sleepWindowEndHour;

  if (startHour === undefined || endHour === undefined) {
    return false;
  }

  const currentHour = new Date(nowMs).getUTCHours();

  // Handle wrap-around (e.g. 23–07 means 23,0,1,2,3,4,5,6 are in window)
  if (startHour > endHour) {
    return currentHour >= startHour || currentHour < endHour;
  }

  // Non-wrapping (e.g. 2–6 means 2,3,4,5 are in window)
  return currentHour >= startHour && currentHour < endHour;
}

/**
 * Main entry point: should an idle-gated job run right now?
 *
 * Returns true if EITHER:
 * - The user is idle (no activity for `idleThresholdMs`)
 * - The current time is within the sleep window
 */
export function shouldRunIdleJob(params: {
  lastActivityAtMs: number | undefined;
  nowMs: number;
  config?: IdleGateConfig;
}): boolean {
  const config = params.config ?? DEFAULT_IDLE_GATE_CONFIG;

  if (isInSleepWindow({ nowMs: params.nowMs, config })) {
    return true;
  }

  return isUserIdle({
    lastActivityAtMs: params.lastActivityAtMs,
    nowMs: params.nowMs,
    config,
  });
}
