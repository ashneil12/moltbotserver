/**
 * Session Health Sentinel — integration helpers.
 *
 * Thin adapter that wires the pure-function session-health module into the
 * agent runner. Handles reading/writing the health state on the SessionEntry
 * and building recovery prompts for context injection.
 */

import type { SessionEntry } from "../../config/sessions/types.js";
import {
  buildRecoveryHint,
  createHealthState,
  recordError,
  recordSuccess,
  type SessionHealthConfig,
  type SessionHealthState,
} from "./session-health.js";

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

/**
 * Read the health state from a session entry.
 * Returns a default (healthy) state if none exists.
 */
export function readHealthState(entry?: SessionEntry | null): SessionHealthState {
  return entry?.healthState ?? createHealthState();
}

/**
 * Write the health state into a session entry (mutates in place).
 * Returns the updated entry for convenience.
 */
export function writeHealthState(entry: SessionEntry, state: SessionHealthState): SessionEntry {
  entry.healthState = state;
  return entry;
}

// ---------------------------------------------------------------------------
// High-level integration functions
// ---------------------------------------------------------------------------

/**
 * Called after a successful agent run.
 * Resets the error counter and clears the health state on the session.
 */
export function onRunSuccess(entry?: SessionEntry | null): void {
  if (!entry) {
    return;
  }
  const current = readHealthState(entry);
  const next = recordSuccess(current);
  // Only write if state actually changed (avoid unnecessary session mutations)
  if (next !== current) {
    writeHealthState(entry, next);
  }
}

/**
 * Called after a failed agent run.
 * Records the error reason and returns a recovery hint if the session is degraded.
 */
export function onRunError(
  entry: SessionEntry | undefined | null,
  reason: string,
  config?: SessionHealthConfig,
): string | null {
  if (!entry) {
    return null;
  }
  const current = readHealthState(entry);
  const next = recordError(current, reason);
  writeHealthState(entry, next);
  return buildRecoveryHint(next, config);
}
