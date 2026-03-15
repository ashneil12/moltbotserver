/**
 * Session Health Sentinel
 *
 * Circuit breaker that detects cascading failures within a session and triggers
 * recovery. Inspired by autoresearch's `if math.isnan(loss): exit(1)` pattern.
 *
 * Design:
 * - Pure functions operating on immutable state — easy to test, no side effects
 * - State is stored on SessionEntry (session store) and persists across messages
 * - Recovery is non-destructive: injects a hint rather than killing the session
 * - Configurable thresholds and time windows for per-instance tuning
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionHealthState = {
  /** Number of consecutive errors (resets to 0 on success). */
  consecutiveErrors: number;
  /** Timestamp (ms) of the last recorded error. */
  lastErrorAt?: number;
  /** Circular buffer of recent error reasons for pattern detection. */
  errorReasons: string[];
};

export type SessionHealthConfig = {
  /** Max consecutive errors before the session is considered degraded. Default: 5 */
  maxConsecutiveErrors?: number;
  /** Window in ms — errors older than this don't count toward degradation. Default: 300_000 (5min) */
  errorWindowMs?: number;
  /** Max error reasons to retain in the circular buffer. Default: 10 */
  maxErrorReasons?: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
const DEFAULT_ERROR_WINDOW_MS = 300_000; // 5 minutes
const DEFAULT_MAX_ERROR_REASONS = 10;

// ---------------------------------------------------------------------------
// State management (pure functions)
// ---------------------------------------------------------------------------

/** Create an empty health state. */
export function createHealthState(): SessionHealthState {
  return { consecutiveErrors: 0, errorReasons: [] };
}

/** Record a successful response — resets the error counter. */
export function recordSuccess(state: SessionHealthState): SessionHealthState {
  if (state.consecutiveErrors === 0 && state.errorReasons.length === 0) {
    return state; // no-op if already healthy
  }
  return { consecutiveErrors: 0, errorReasons: [], lastErrorAt: state.lastErrorAt };
}

/** Record an error — increments counter, pushes reason into buffer. */
export function recordError(
  state: SessionHealthState,
  reason: string,
  now: number = Date.now(),
): SessionHealthState {
  const maxReasons = DEFAULT_MAX_ERROR_REASONS;
  const newReasons = [...state.errorReasons, reason];
  // Trim to circular buffer size
  const trimmedReasons =
    newReasons.length > maxReasons ? newReasons.slice(newReasons.length - maxReasons) : newReasons;
  return {
    consecutiveErrors: state.consecutiveErrors + 1,
    lastErrorAt: now,
    errorReasons: trimmedReasons,
  };
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

/**
 * Check if the session health is degraded (circuit breaker tripped).
 *
 * A session is considered degraded when:
 * 1. Consecutive errors exceed the threshold, AND
 * 2. The most recent error is within the time window
 */
export function isSessionDegraded(
  state: SessionHealthState,
  config?: SessionHealthConfig,
  now: number = Date.now(),
): boolean {
  const maxErrors = config?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const windowMs = config?.errorWindowMs ?? DEFAULT_ERROR_WINDOW_MS;

  if (state.consecutiveErrors < maxErrors) {
    return false;
  }

  // If the last error is outside the time window, the session has recovered naturally
  if (state.lastErrorAt !== undefined && now - state.lastErrorAt > windowMs) {
    return false;
  }

  return true;
}

/**
 * Detect if the errors are all the same type (stuck in a loop on the same failure).
 */
export function detectRepeatedPattern(state: SessionHealthState): string | null {
  if (state.errorReasons.length < 3) {
    return null;
  }
  // Count consecutive trailing errors with the same reason
  const last = state.errorReasons[state.errorReasons.length - 1];
  let repeatedCount = 0;
  for (let i = state.errorReasons.length - 1; i >= 0; i--) {
    if (state.errorReasons[i] !== last) {
      break;
    }
    repeatedCount++;
  }
  return repeatedCount >= 3 ? last : null;
}

// ---------------------------------------------------------------------------
// Recovery hint
// ---------------------------------------------------------------------------

/**
 * Build a recovery hint string for injection into the agent's context.
 * Returns null if the session is healthy (no hint needed).
 */
export function buildRecoveryHint(
  state: SessionHealthState,
  config?: SessionHealthConfig,
  now: number = Date.now(),
): string | null {
  if (!isSessionDegraded(state, config, now)) {
    return null;
  }

  const repeatedPattern = detectRepeatedPattern(state);
  const lines = [
    `⚠️ Session health alert: ${state.consecutiveErrors} consecutive errors detected.`,
  ];

  if (repeatedPattern) {
    lines.push(`Repeated failure pattern: "${repeatedPattern}" — this approach is not working.`);
    lines.push(
      "Consider: try a completely different strategy, check if the service is available, or simplify your approach.",
    );
  } else {
    lines.push(
      "Consider: simplify your current approach, verify service availability, or try a different strategy entirely.",
    );
  }

  lines.push("Do NOT repeat the same failing approach. Change something fundamental.");

  return lines.join(" ");
}
