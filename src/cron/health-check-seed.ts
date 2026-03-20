/**
 * Health Check Cron Seed — auto-creates a periodic health-check cron job
 * on startup if one doesn't already exist.
 *
 * The job runs `cron_heal diagnose` in an isolated session every 6 hours,
 * giving the agent visibility into cron and disk health proactively
 * (rather than waiting for the sentinel to fire on a failure).
 *
 * - Idempotent: only creates if `__system_health_check` doesn't exist
 * - Isolated session: won't bloat the main context
 * - Delivery: none (silent — agent only escalates if it finds issues)
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { CronJob, CronJobCreate } from "./types.js";

const log = createSubsystemLogger("cron:health-seed");

/** Well-known ID for the system health check job. */
export const HEALTH_CHECK_JOB_ID = "__system_health_check";

/** Default schedule: every 6 hours (00:00, 06:00, 12:00, 18:00). */
const DEFAULT_SCHEDULE = "0 */6 * * *";

/** The message sent to the agent in isolated session. */
const HEALTH_CHECK_MESSAGE = [
  "Run a proactive health check:",
  "",
  "1. Use `cron_heal diagnose` to assess cron job health and disk usage.",
  "2. If any jobs are disabled, erroring, or have stale delivery targets, attempt to fix them:",
  "   - Use `cron_heal re-enable <jobId>` for disabled/erroring jobs",
  "   - Use `cron_heal adjust-schedule <jobId>` for scheduling issues",
  "3. If disk usage is high (>80%), run `cron_heal cleanup-disk`.",
  "4. Check `cron_heal journal` for any recent failed remediations.",
  "",
  "Report only if you find and fix issues. If everything is healthy, stay silent.",
  "If a fix doesn't work after 2 attempts, escalate to the user.",
].join("\n");

/**
 * Build the health check cron job definition.
 */
export function buildHealthCheckJob(opts?: {
  /** Override the default schedule (cron expression). */
  schedule?: string;
  /** Agent ID to scope the job to. */
  agentId?: string;
}): CronJobCreate {
  return {
    name: "System Health Check",
    description:
      "Proactive health check — diagnoses cron health and disk usage in an isolated session. Auto-seeded by the gateway.",
    enabled: true,
    schedule: {
      kind: "cron",
      expr: opts?.schedule ?? DEFAULT_SCHEDULE,
    },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: HEALTH_CHECK_MESSAGE,
      lightContext: true,
    },
    delivery: {
      mode: "none",
    },
    ...(opts?.agentId ? { agentId: opts.agentId } : {}),
  };
}

/**
 * Seed the health check cron job if it doesn't already exist.
 *
 * @returns true if the job was created, false if it already existed.
 */
export function seedHealthCheckJob(params: {
  /** Current jobs in the cron store. */
  jobs: CronJob[];
  /** Callback to add a job to the cron store. */
  addJob: (job: CronJobCreate) => CronJob | undefined;
  /** Optional agent ID. */
  agentId?: string;
  /** Optional schedule override. */
  schedule?: string;
}): boolean {
  // Check if health check job already exists (by ID or name)
  const existing = params.jobs.find(
    (j) => j.id === HEALTH_CHECK_JOB_ID || j.name === "System Health Check",
  );

  if (existing) {
    log.debug("health check job already exists, skipping seed");
    return false;
  }

  const jobDef = buildHealthCheckJob({
    schedule: params.schedule,
    agentId: params.agentId,
  });

  try {
    const created = params.addJob(jobDef);
    if (created) {
      log.info(
        `seeded system health check cron job: ${created.id} schedule=${JSON.stringify(jobDef.schedule)}`,
      );
      return true;
    }
  } catch (err) {
    log.warn(
      `failed to seed health check cron job: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return false;
}
