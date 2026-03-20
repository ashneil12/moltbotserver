/**
 * Remediation Watchdog — runs on each timer tick to check active remediations.
 *
 * For each active (outcome === 'applied') journal entry:
 * 1. Check if the target job has re-failed since the remediation was applied
 * 2. If re-failed → auto-rollback previous state + mark 'rolled-back'
 * 3. If TTL expired without refire → mark 'confirmed' (fix held)
 * 4. If max attempts exceeded → mark 'escalated' + alert human
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { RemediationEntry } from "./remediation-journal.js";
import {
  readPendingEntries,
  markEntry,
  pruneOldEntries,
  countPreviousAttempts,
} from "./remediation-journal.js";

const log = createSubsystemLogger("remediation-watchdog");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface WatchdogDeps {
  /** Path to the remediation journal JSONL file. */
  journalPath: string;
  /** Current timestamp in ms. */
  nowMs: number;
  /** Apply a rollback patch to a cron job. */
  patchJob: (jobId: string, patch: Record<string, unknown>) => Promise<void>;
  /** Send a system event to the agent. */
  enqueueSystemEvent: (text: string, opts?: { sessionKey?: string }) => void;
  /** Resolve the main session key (for system events). */
  sessionKey?: string;
  /** Check if a job has errored since a given timestamp. Returns the error if so. */
  getJobErrorSince: (jobId: string, sinceMs: number) => string | null;
  /** Retention in days for journal pruning. */
  retentionDays?: number;
}

export interface WatchdogResult {
  /** Number of entries confirmed (fix held). */
  confirmed: number;
  /** Number of entries rolled back. */
  rolledBack: number;
  /** Number of entries escalated to human. */
  escalated: number;
  /** Number of old entries pruned. */
  pruned: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Throttle (run at most once per 5 minutes)
// ═══════════════════════════════════════════════════════════════════════════

let lastRunMs = 0;
const THROTTLE_MS = 5 * 60_000; // 5 minutes

/** Reset throttle state (for testing). */
export function resetWatchdogThrottle(): void {
  lastRunMs = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Watchdog
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the remediation watchdog. Should be called from the timer tick.
 *
 * Checks all active remediation entries and:
 * - Confirms entries whose TTL has expired without the job re-failing
 * - Rolls back entries where the job has re-failed
 * - Escalates to human when max attempts exceeded
 * - Prunes old entries beyond retention period
 */
export async function runRemediationWatchdog(deps: WatchdogDeps): Promise<WatchdogResult> {
  // Throttle: don't run more than once per 5 minutes
  if (deps.nowMs - lastRunMs < THROTTLE_MS) {
    return { confirmed: 0, rolledBack: 0, escalated: 0, pruned: 0 };
  }
  lastRunMs = deps.nowMs;

  const result: WatchdogResult = {
    confirmed: 0,
    rolledBack: 0,
    escalated: 0,
    pruned: 0,
  };

  const activeEntries = readPendingEntries(deps.journalPath);

  for (const entry of activeEntries) {
    try {
      await processEntry(entry, deps, result);
    } catch (err) {
      log.warn(
        `watchdog error processing entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Prune old entries
  result.pruned = pruneOldEntries(deps.journalPath, deps.retentionDays, deps.nowMs);

  if (result.confirmed + result.rolledBack + result.escalated > 0) {
    log.info(
      `watchdog: confirmed=${result.confirmed} rolledBack=${result.rolledBack} escalated=${result.escalated} pruned=${result.pruned}`,
    );
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry Processing
// ═══════════════════════════════════════════════════════════════════════════

async function processEntry(
  entry: RemediationEntry,
  deps: WatchdogDeps,
  result: WatchdogResult,
): Promise<void> {
  const jobId = entry.target.jobId;

  // Case 1: TTL expired — the fix held
  if (deps.nowMs >= entry.expiresAt) {
    // Check if job has errored even though TTL expired
    if (jobId) {
      const error = deps.getJobErrorSince(jobId, entry.timestamp);
      if (error) {
        // Job did error, handle as failure
        await handleFailure(entry, error, deps, result);
        return;
      }
    }
    // No errors — fix confirmed
    markEntry(deps.journalPath, entry.id, "confirmed");
    result.confirmed++;
    log.info(
      `confirmed remediation ${entry.id} for ${entry.target.jobName ?? entry.target.jobId ?? "unknown"} — fix held for ${Math.round(entry.ttlMs / 60_000)}min`,
    );
    return;
  }

  // Case 2: TTL not expired — check if job has re-failed
  if (jobId) {
    const error = deps.getJobErrorSince(jobId, entry.timestamp);
    if (error) {
      await handleFailure(entry, error, deps, result);
    }
    // No error yet and TTL not expired — keep watching
  }
}

async function handleFailure(
  entry: RemediationEntry,
  error: string,
  deps: WatchdogDeps,
  result: WatchdogResult,
): Promise<void> {
  const jobLabel = entry.target.jobName ?? entry.target.jobId ?? "unknown";
  const totalAttempts = entry.target.jobId
    ? countPreviousAttempts(deps.journalPath, entry.target.jobId, entry.probe)
    : entry.attempt;

  // Check if max attempts exceeded
  if (totalAttempts >= entry.maxAttempts) {
    // Escalate — rollback and alert human
    await rollbackEntry(entry, deps);
    markEntry(
      deps.journalPath,
      entry.id,
      "escalated",
      `Max ${entry.maxAttempts} attempts reached. Last error: ${error}`,
    );
    result.escalated++;

    // Alert the human via system event
    const alertText = [
      `🚨 ESCALATION: Automated fix for "${jobLabel}" failed after ${totalAttempts} attempts.`,
      `Probe: ${entry.probe}`,
      `Last action: ${entry.action} — "${entry.description}"`,
      `Last error: ${error}`,
      `Previous state has been restored. Human intervention required.`,
      `View remediation history in the Cron Dashboard for details.`,
    ].join("\n");

    deps.enqueueSystemEvent(alertText, {
      sessionKey: deps.sessionKey,
    });

    log.warn(`escalated remediation for "${jobLabel}" after ${totalAttempts} attempts`);
    return;
  }

  // Rollback — revert to previous state
  await rollbackEntry(entry, deps);
  markEntry(
    deps.journalPath,
    entry.id,
    "rolled-back",
    `Job re-failed within watchdog window. Error: ${error}`,
  );
  result.rolledBack++;

  log.info(`rolled back remediation ${entry.id} for "${jobLabel}" — job re-failed: ${error}`);
}

async function rollbackEntry(entry: RemediationEntry, deps: WatchdogDeps): Promise<void> {
  if (!entry.target.jobId) {
    return;
  }
  if (Object.keys(entry.previousState).length === 0) {
    return;
  }

  try {
    await deps.patchJob(entry.target.jobId, entry.previousState);
    log.info(
      `rolled back job ${entry.target.jobId} to previous state: ${JSON.stringify(entry.previousState)}`,
    );
  } catch (err) {
    log.warn(
      `failed to rollback job ${entry.target.jobId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
