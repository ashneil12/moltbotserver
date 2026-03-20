/**
 * Alignment State Tracker
 *
 * In-memory per-session state for alignment drift scoring.
 * Follows the same pure-function pattern as session-health.ts.
 *
 * State is per-session and not persisted — alignment checks restart
 * each session, which is correct since agent context resets anyway.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlignmentState = {
  /** Current turn number (incremented on each before_agent_start). */
  turnNumber: number;
  /** Turn number of the last alignment check. */
  lastCheckTurn: number;
  /** Most recent alignment score (0–1, higher = better alignment). */
  lastScore: number | null;
  /** Count of consecutive scores in the "mild drift" range (threshold .. threshold+0.2). */
  consecutiveMildDrifts: number;
  /** Total number of alignment checks performed this session. */
  totalChecks: number;
  /** Total number of corrections injected this session. */
  totalCorrections: number;
};

export type AlignmentConfig = {
  /** Enable alignment checking. Default: true (enforced by enforce-config.mjs). */
  enabled?: boolean;
  /** Log scores but don't inject corrections. Default: false (enforced by enforce-config.mjs). */
  observeOnly?: boolean;
  /** Minimum turns between alignment checks. Default: 3. */
  cooldownTurns?: number;
  /** Score below which a correction is injected (0–1). Default: 0.7. */
  correctionThreshold?: number;
  /** Score below which the check is considered "severe" drift. Default: 0.5. */
  severeThreshold?: number;
  /** Number of consecutive mild drifts that escalate to a correction. Default: 3. */
  mildDriftEscalation?: number;
  /** Timeout in ms for the LLM scoring call. Default: 2000. */
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_TURNS = 3;
const DEFAULT_CORRECTION_THRESHOLD = 0.7;
const DEFAULT_SEVERE_THRESHOLD = 0.5;
const DEFAULT_MILD_DRIFT_ESCALATION = 3;

export const ALIGNMENT_DEFAULTS = {
  cooldownTurns: DEFAULT_COOLDOWN_TURNS,
  correctionThreshold: DEFAULT_CORRECTION_THRESHOLD,
  severeThreshold: DEFAULT_SEVERE_THRESHOLD,
  mildDriftEscalation: DEFAULT_MILD_DRIFT_ESCALATION,
  timeoutMs: 2000,
} as const;

// ---------------------------------------------------------------------------
// State management (pure functions)
// ---------------------------------------------------------------------------

/** Create a fresh alignment state for a new session. */
export function createAlignmentState(): AlignmentState {
  return {
    turnNumber: 0,
    lastCheckTurn: -Infinity,
    lastScore: null,
    consecutiveMildDrifts: 0,
    totalChecks: 0,
    totalCorrections: 0,
  };
}

/** Advance to the next turn. Call once per before_agent_start. */
export function advanceTurn(state: AlignmentState): AlignmentState {
  return { ...state, turnNumber: state.turnNumber + 1 };
}

/**
 * Decide whether an alignment check should run on this turn.
 *
 * Returns true when:
 * - Enough turns have passed since the last check (cooldown), OR
 * - Consecutive mild drifts have accumulated to the escalation threshold
 */
export function shouldCheck(state: AlignmentState, config?: AlignmentConfig): boolean {
  const cooldown = config?.cooldownTurns ?? DEFAULT_COOLDOWN_TURNS;
  const escalation = config?.mildDriftEscalation ?? DEFAULT_MILD_DRIFT_ESCALATION;

  // Always allow the first check (lastCheckTurn starts at -Infinity)
  const turnsSinceLastCheck = state.turnNumber - state.lastCheckTurn;

  // Escalation override: if mild drifts are accumulating, check early
  if (state.consecutiveMildDrifts >= escalation) {
    return true;
  }

  return turnsSinceLastCheck >= cooldown;
}

/**
 * Record the result of an alignment check.
 */
export function recordCheck(
  state: AlignmentState,
  score: number,
  correctionInjected: boolean,
  config?: AlignmentConfig,
): AlignmentState {
  const correctionThreshold = config?.correctionThreshold ?? DEFAULT_CORRECTION_THRESHOLD;
  const severeThreshold = config?.severeThreshold ?? DEFAULT_SEVERE_THRESHOLD;

  const isMildDrift = score < correctionThreshold && score >= severeThreshold;

  return {
    ...state,
    lastCheckTurn: state.turnNumber,
    lastScore: score,
    consecutiveMildDrifts: isMildDrift ? state.consecutiveMildDrifts + 1 : 0,
    totalChecks: state.totalChecks + 1,
    totalCorrections: state.totalCorrections + (correctionInjected ? 1 : 0),
  };
}

/**
 * Determine the severity level from a score.
 */
export function scoreSeverity(
  score: number,
  config?: AlignmentConfig,
): "aligned" | "mild" | "severe" {
  const correctionThreshold = config?.correctionThreshold ?? DEFAULT_CORRECTION_THRESHOLD;
  const severeThreshold = config?.severeThreshold ?? DEFAULT_SEVERE_THRESHOLD;

  if (score >= correctionThreshold) {
    return "aligned";
  }
  if (score >= severeThreshold) {
    return "mild";
  }
  return "severe";
}
