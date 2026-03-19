/**
 * Cron health probes — deterministic checks for cron scheduler health.
 *
 * Returns `CheckResult[]` compatible with the health sentinel pipeline.
 * Each probe inspects the cron service state to detect:
 * - Scheduler liveness (is the timer firing?)
 * - Jobs with consecutive errors above threshold
 * - Jobs auto-disabled by schedule errors or retry exhaustion
 * - Stale delivery targets (channel: "last" without explicit target)
 */

import type { CheckResult } from "../logging/diagnostics-toolkit.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CronHealthJob {
  id: string;
  name?: string;
  enabled: boolean;
  state: {
    consecutiveErrors?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    scheduleErrorCount?: number;
  };
  delivery?: {
    mode?: string;
    channel?: string;
    to?: string;
  };
  sessionTarget?: string;
  payload?: { kind?: string };
}

export interface CronHealthDeps {
  /** Timestamp (ms) of the last scheduler timer tick. undefined = never ticked. */
  lastTickAtMs: number | undefined;
  /** Current time in ms. */
  nowMs: number;
  /** All cron jobs (including disabled). */
  jobs: CronHealthJob[];
  /** Threshold in ms — scheduler is considered dead if no tick within this window. Default: 5 min. */
  livenessThresholdMs?: number;
  /** Consecutive error count that triggers a warning. Default: 2. */
  consecutiveErrorThreshold?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_LIVENESS_THRESHOLD_MS = 5 * 60_000; // 5 minutes
const DEFAULT_CONSECUTIVE_ERROR_THRESHOLD = 2;

// ═══════════════════════════════════════════════════════════════════════════
// Probes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if the cron scheduler is alive (timer has ticked recently).
 */
export function checkSchedulerLiveness(deps: CronHealthDeps): CheckResult {
  const start = Date.now();
  const thresholdMs = deps.livenessThresholdMs ?? DEFAULT_LIVENESS_THRESHOLD_MS;

  if (deps.lastTickAtMs === undefined) {
    // Scheduler has never ticked — might be a fresh start
    return {
      name: "cron.scheduler_liveness",
      status: "warn",
      detail: "Cron scheduler has not ticked yet (may be starting up)",
      durationMs: Date.now() - start,
    };
  }

  const elapsed = deps.nowMs - deps.lastTickAtMs;
  if (elapsed > thresholdMs) {
    const elapsedMin = Math.round(elapsed / 60_000);
    return {
      name: "cron.scheduler_liveness",
      status: "fail",
      detail: `Cron scheduler last ticked ${elapsedMin} minute(s) ago — may be dead`,
      durationMs: Date.now() - start,
    };
  }

  return {
    name: "cron.scheduler_liveness",
    status: "pass",
    detail: `Cron scheduler ticked ${Math.round(elapsed / 1000)}s ago`,
    durationMs: Date.now() - start,
  };
}

/**
 * Check for jobs with consecutive errors above threshold.
 */
export function checkConsecutiveErrors(deps: CronHealthDeps): CheckResult[] {
  const start = Date.now();
  const threshold = deps.consecutiveErrorThreshold ?? DEFAULT_CONSECUTIVE_ERROR_THRESHOLD;
  const results: CheckResult[] = [];

  const problemJobs = deps.jobs.filter(
    (j) =>
      j.enabled &&
      typeof j.state.consecutiveErrors === "number" &&
      j.state.consecutiveErrors >= threshold,
  );

  if (problemJobs.length === 0) {
    results.push({
      name: "cron.consecutive_errors",
      status: "pass",
      detail: `No jobs with ${threshold}+ consecutive errors`,
      durationMs: Date.now() - start,
    });
    return results;
  }

  const names = problemJobs
    .map((j) => `"${j.name || j.id}" (${j.state.consecutiveErrors} errors)`)
    .join(", ");

  results.push({
    name: "cron.consecutive_errors",
    status: problemJobs.length >= 3 ? "fail" : "warn",
    detail: `${problemJobs.length} job(s) with consecutive errors: ${names}`,
    durationMs: Date.now() - start,
  });

  return results;
}

/**
 * Check for jobs that were auto-disabled (by schedule errors or retry exhaustion).
 */
export function checkAutoDisabledJobs(deps: CronHealthDeps): CheckResult[] {
  const start = Date.now();
  const results: CheckResult[] = [];

  const autoDisabled = deps.jobs.filter(
    (j) =>
      !j.enabled &&
      ((typeof j.state.scheduleErrorCount === "number" && j.state.scheduleErrorCount > 0) ||
        (typeof j.state.consecutiveErrors === "number" &&
          j.state.consecutiveErrors > 0 &&
          j.state.lastStatus === "error")),
  );

  if (autoDisabled.length === 0) {
    results.push({
      name: "cron.auto_disabled",
      status: "pass",
      detail: "No auto-disabled jobs found",
      durationMs: Date.now() - start,
    });
    return results;
  }

  const names = autoDisabled.map((j) => `"${j.name || j.id}"`).join(", ");

  results.push({
    name: "cron.auto_disabled",
    status: "warn",
    detail: `${autoDisabled.length} job(s) auto-disabled: ${names}`,
    durationMs: Date.now() - start,
  });

  return results;
}

/**
 * Check for jobs with potentially stale delivery targets.
 * Flags jobs using channel: "last" or missing explicit delivery target
 * when in announce mode with isolated sessions.
 */
export function checkStaleDeliveryTargets(deps: CronHealthDeps): CheckResult[] {
  const start = Date.now();
  const results: CheckResult[] = [];

  const suspiciousJobs = deps.jobs.filter((j) => {
    if (!j.enabled) {
      return false;
    }
    if (!j.delivery || j.delivery.mode === "none" || j.delivery.mode === "webhook") {
      return false;
    }
    // Flag announce-mode jobs with channel: "last" and no explicit "to"
    const channel = j.delivery.channel;
    if (channel === "last" && !j.delivery.to) {
      return true;
    }
    // Flag announce-mode jobs with no channel at all
    if (!channel && !j.delivery.to && j.delivery.mode === "announce") {
      return true;
    }
    return false;
  });

  if (suspiciousJobs.length === 0) {
    results.push({
      name: "cron.stale_delivery",
      status: "pass",
      detail: "All jobs have explicit delivery targets",
      durationMs: Date.now() - start,
    });
    return results;
  }

  const names = suspiciousJobs.map((j) => `"${j.name || j.id}"`).join(", ");

  results.push({
    name: "cron.stale_delivery",
    status: "warn",
    detail: `${suspiciousJobs.length} job(s) using channel:"last" or missing explicit delivery target: ${names}. May deliver to wrong channel.`,
    durationMs: Date.now() - start,
  });

  return results;
}

/**
 * Run all cron health probes and return combined results.
 */
export function runCronHealthProbes(deps: CronHealthDeps): CheckResult[] {
  return [
    checkSchedulerLiveness(deps),
    ...checkConsecutiveErrors(deps),
    ...checkAutoDisabledJobs(deps),
    ...checkStaleDeliveryTargets(deps),
  ];
}
