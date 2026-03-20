/**
 * Cron Heal Tool — agent self-healing tool for cron job remediation.
 *
 * Follows the snapshot → fix → test → journal flow:
 * 1. Snapshot current state before making changes
 * 2. Apply the fix
 * 3. Test that the fix worked
 * 4. Journal everything for audit trail + rollback
 *
 * Actions:
 * - diagnose: Check cron health + disk health, return structured assessment
 * - re-enable: Re-enable a disabled job (snapshot → patch → test-run → journal)
 * - adjust-schedule: Change a job's schedule (snapshot → patch → journal)
 * - force-run: Trigger immediate execution of a job
 * - cleanup-disk: Run disk cleanup, journal freed space
 * - rollback: Revert a specific journal entry
 * - journal: View remediation history
 */

import { Type } from "@sinclair/typebox";
import {
  createEntry,
  getJournalHistory,
  markEntry,
  countPreviousAttempts,
  resolveJournalPath,
  readAllEntries,
} from "../../cron/remediation-journal.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions, type GatewayCallOptions } from "./gateway.js";

// ═══════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════

const HEAL_ACTIONS = [
  "diagnose",
  "re-enable",
  "adjust-schedule",
  "force-run",
  "cleanup-disk",
  "rollback",
  "journal",
] as const;

const CronHealToolSchema = Type.Object(
  {
    action: stringEnum(HEAL_ACTIONS),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    /** Target job ID (for re-enable, adjust-schedule, force-run). */
    jobId: Type.Optional(Type.String()),
    /** Agent's stated intent — what you're doing and why. Required for mutations. */
    description: Type.Optional(Type.String()),
    /** New schedule object (for adjust-schedule). */
    newSchedule: Type.Optional(Type.Object({}, { additionalProperties: true })),
    /** Journal entry ID (for rollback). */
    entryId: Type.Optional(Type.String()),
    /** Result limit (for journal). */
    limit: Type.Optional(Type.Number()),
    /** Filter by probe name (for journal). */
    probe: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

type GatewayToolCaller = typeof callGatewayTool;

type CronHealToolDeps = {
  callGatewayTool?: GatewayToolCaller;
  journalPath?: string;
};

/**
 * Lookup a cron job by ID via the gateway.
 * Avoids duplicating the cron.status → filter → find pattern.
 */
async function lookupJob(
  callGateway: GatewayToolCaller,
  gatewayOpts: GatewayCallOptions,
  jobId: string,
): Promise<Record<string, unknown>> {
  const jobState = await callGateway("cron.status", gatewayOpts, {});
  const jobs = Array.isArray(jobState?.jobs)
    ? (jobState.jobs as Array<Record<string, unknown>>)
    : [];
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found. Use cron_heal diagnose to list available jobs.`);
  }
  return job;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Factory
// ═══════════════════════════════════════════════════════════════════════════

export function createCronHealTool(deps?: CronHealToolDeps): AnyAgentTool {
  const callGateway = deps?.callGatewayTool ?? callGatewayTool;
  const journalPath = deps?.journalPath ?? resolveJournalPath();

  return {
    label: "Cron Heal",
    name: "cron_heal",
    ownerOnly: true,
    description: `Self-healing tool for cron job remediation. Use this to diagnose and fix cron issues autonomously.

ACTIONS:
- diagnose: Check cron health + disk health. Returns structured assessment with problem jobs and suggested actions.
- re-enable: Re-enable a disabled/erroring job. Snapshots current state, patches enabled:true, runs a test execution, and journals everything.
- adjust-schedule: Change a job's schedule. Snapshots previous schedule, applies new one, journals the change.
- force-run: Trigger immediate execution of a job to test if it's working.
- cleanup-disk: Run disk cleanup (sessions, cache, logs). Journals freed space.
- rollback: Revert a specific remediation by its entry ID. Restores the previous state snapshot.
- journal: View remediation history. Use to check what fixes have been attempted.

IMPORTANT RULES:
- Always provide a 'description' for any mutation (re-enable, adjust-schedule, cleanup-disk). This is your stated intent and is logged for accountability.
- The system will auto-rollback your fix if the job fails again within 30 minutes.
- After 2 failed attempts for the same issue, the system escalates to the human automatically.
- Every action is fully auditable — the journal records previous state, applied changes, and test results.
- You CANNOT delete jobs or change delivery targets through this tool. Those require human action.`,
    parameters: CronHealToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts: GatewayCallOptions = {
        ...readGatewayCallOptions(params),
        timeoutMs:
          typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
            ? params.timeoutMs
            : 60_000,
      };

      switch (action) {
        // ─── Diagnose ──────────────────────────────────────────────
        case "diagnose": {
          const [cronHealth, diskHealth] = await Promise.allSettled([
            callGateway("cron.health", gatewayOpts, {}),
            callGateway("system.diskHealth", gatewayOpts, {}),
          ]);

          const cron =
            cronHealth.status === "fulfilled" ? cronHealth.value : { error: "unavailable" };
          const disk =
            diskHealth.status === "fulfilled" ? diskHealth.value : { error: "unavailable" };

          // Get recent remediation history
          const history = getJournalHistory(journalPath, { limit: 10 });

          return jsonResult({
            cronHealth: cron,
            diskHealth: disk,
            recentRemediations: history.map((e) => ({
              id: e.id,
              timestamp: e.timestamp,
              action: e.action,
              target: e.target,
              description: e.description,
              outcome: e.outcome,
              rollbackReason: e.rollbackReason,
            })),
            suggestedActions: buildSuggestions(cron, disk),
          });
        }

        // ─── Re-enable ─────────────────────────────────────────────
        case "re-enable": {
          const jobId = readStringParam(params, "jobId", { required: true });
          const description = readStringParam(params, "description", { required: true });

          // 1. Snapshot current state
          const job = await lookupJob(callGateway, gatewayOpts, jobId);

          const previousState = {
            enabled: job.enabled,
            autoDisabled: job.autoDisabled,
          };

          // Check previous attempts
          const prevAttempts = countPreviousAttempts(journalPath, jobId, "agent.re-enable");
          if (prevAttempts >= 2) {
            return jsonResult({
              error: "max_attempts_exceeded",
              message: `Already attempted re-enable ${prevAttempts} times for this job. Escalating to human.`,
              previousAttempts: prevAttempts,
            });
          }

          // 2. Apply fix
          await callGateway("cron.update", gatewayOpts, {
            id: jobId,
            patch: { enabled: true },
          });

          // 3. Test — force run and check result
          let testResult: { status: string; error?: string };
          try {
            const runResult = await callGateway("cron.run", gatewayOpts, {
              id: jobId,
              mode: "force",
            });
            testResult = { status: "pass", error: undefined };
            // Check if run result contains an error
            if (runResult && typeof runResult === "object" && "error" in runResult) {
              testResult = {
                status: "fail",
                error: String(runResult.error),
              };
            }
          } catch (err) {
            testResult = {
              status: "fail",
              error: err instanceof Error ? err.message : String(err),
            };
          }

          // 4. Journal
          const entry = createEntry({
            journalPath,
            probe: "agent.re-enable",
            action: "re-enable",
            target: { jobId, jobName: String((job.name as string | undefined) ?? jobId) },
            description,
            previousState,
            appliedPatch: { enabled: true },
            testResult,
            attempt: prevAttempts + 1,
          });

          return jsonResult({
            success: true,
            journalEntryId: entry.id,
            previousState,
            testResult,
            watchdogExpiresAt: new Date(entry.expiresAt).toISOString(),
            message:
              testResult.status === "pass"
                ? `Re-enabled "${(job.name as string | undefined) ?? jobId}" and test run passed. Watchdog will monitor for 30 minutes.`
                : `Re-enabled "${(job.name as string | undefined) ?? jobId}" but test run failed: ${testResult.error}. Watchdog will auto-rollback if it fails again.`,
          });
        }

        // ─── Adjust Schedule ───────────────────────────────────────
        case "adjust-schedule": {
          const jobId = readStringParam(params, "jobId", { required: true });
          const description = readStringParam(params, "description", { required: true });
          const newSchedule = params.newSchedule;
          if (!newSchedule || typeof newSchedule !== "object") {
            throw new Error("newSchedule required for adjust-schedule action");
          }

          // 1. Snapshot
          const job = await lookupJob(callGateway, gatewayOpts, jobId);

          const previousState = { schedule: job.schedule };

          // Check previous attempts
          const prevAttempts = countPreviousAttempts(journalPath, jobId, "agent.adjust-schedule");
          if (prevAttempts >= 2) {
            return jsonResult({
              error: "max_attempts_exceeded",
              message: `Already attempted schedule adjustment ${prevAttempts} times. Escalating to human.`,
            });
          }

          // 2. Apply
          await callGateway("cron.update", gatewayOpts, {
            id: jobId,
            patch: { schedule: newSchedule },
          });

          // 3. Journal
          const entry = createEntry({
            journalPath,
            probe: "agent.adjust-schedule",
            action: "adjust-schedule",
            target: { jobId, jobName: String((job.name as string | undefined) ?? jobId) },
            description,
            previousState,
            appliedPatch: { schedule: newSchedule },
            attempt: prevAttempts + 1,
          });

          return jsonResult({
            success: true,
            journalEntryId: entry.id,
            previousSchedule: job.schedule,
            newSchedule,
            watchdogExpiresAt: new Date(entry.expiresAt).toISOString(),
            message: `Adjusted schedule for "${(job.name as string | undefined) ?? jobId}". Watchdog will monitor for 30 minutes — auto-rollback if job fails.`,
          });
        }

        // ─── Force Run ─────────────────────────────────────────────
        case "force-run": {
          const jobId = readStringParam(params, "jobId", { required: true });
          const result = await callGateway("cron.run", gatewayOpts, {
            id: jobId,
            mode: "force",
          });
          return jsonResult({
            success: true,
            runResult: result,
            message: `Force-triggered job ${jobId}.`,
          });
        }

        // ─── Disk Cleanup ──────────────────────────────────────────
        case "cleanup-disk": {
          const description =
            readStringParam(params, "description") ?? "Agent-initiated disk cleanup";

          // 1. Snapshot — get current disk state
          let beforeScan: unknown;
          try {
            beforeScan = await callGateway("system.diskHealth", gatewayOpts, {});
          } catch {
            beforeScan = { error: "scan unavailable" };
          }

          // 2. Apply
          const cleanupResult = await callGateway("system.diskCleanup", gatewayOpts, {});

          // 3. Journal
          const entry = createEntry({
            journalPath,
            probe: "agent.disk-cleanup",
            action: "disk-cleanup",
            target: {},
            description,
            previousState: { diskScan: beforeScan },
            appliedPatch: { cleanup: cleanupResult },
            testResult: { status: "pass" },
            ttlMs: 0, // no watchdog needed for cleanup — not reversible
          });

          return jsonResult({
            success: true,
            journalEntryId: entry.id,
            cleanupResult,
            message: `Disk cleanup complete.`,
          });
        }

        // ─── Rollback ──────────────────────────────────────────────
        case "rollback": {
          const entryId = readStringParam(params, "entryId", { required: true });

          // Find the entry
          const history = readAllEntries(journalPath);
          const entry = history.find((e) => e.id === entryId);
          if (!entry) {
            throw new Error(`Journal entry ${entryId} not found`);
          }
          if (entry.outcome !== "applied") {
            return jsonResult({
              error: "not_applicable",
              message: `Entry ${entryId} has outcome "${entry.outcome}" — cannot rollback.`,
            });
          }
          if (!entry.target.jobId) {
            return jsonResult({
              error: "no_target",
              message: "Entry has no job target to rollback.",
            });
          }

          // Apply the previous state
          await callGateway("cron.update", gatewayOpts, {
            id: entry.target.jobId,
            patch: entry.previousState,
          });

          // Mark as rolled back
          markEntry(journalPath, entryId, "rolled-back", "Agent-initiated rollback");

          return jsonResult({
            success: true,
            message: `Rolled back entry ${entryId}. Restored previous state for "${entry.target.jobName ?? entry.target.jobId}".`,
            restoredState: entry.previousState,
          });
        }

        // ─── Journal ───────────────────────────────────────────────
        case "journal": {
          const jobId = readStringParam(params, "jobId");
          const limit = typeof params.limit === "number" ? params.limit : 20;
          const history = getJournalHistory(journalPath, {
            jobId: jobId ?? undefined,
            limit,
          });
          return jsonResult({
            entries: history.map((e) => ({
              id: e.id,
              timestamp: new Date(e.timestamp).toISOString(),
              action: e.action,
              probe: e.probe,
              target: e.target,
              description: e.description,
              outcome: e.outcome,
              testResult: e.testResult,
              rollbackReason: e.rollbackReason,
              attempt: e.attempt,
              maxAttempts: e.maxAttempts,
            })),
            total: history.length,
          });
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function buildSuggestions(cronHealth: unknown, diskHealth: unknown): string[] {
  const suggestions: string[] = [];

  if (cronHealth && typeof cronHealth === "object" && !("error" in cronHealth)) {
    const ch = cronHealth as Record<string, unknown>;
    const summary = ch.summary as Record<string, number> | undefined;
    const problemJobs = ch.problemJobs as Array<Record<string, unknown>> | undefined;

    if (summary?.erroring && summary.erroring > 0) {
      suggestions.push(
        `${summary.erroring} job(s) are erroring. Use re-enable after diagnosing the cause.`,
      );
    }
    if (summary?.disabled && summary.disabled > 0) {
      suggestions.push(
        `${summary.disabled} job(s) are disabled. Check if they were auto-disabled due to failures.`,
      );
    }
    if (problemJobs && problemJobs.length > 0) {
      for (const job of problemJobs.slice(0, 3)) {
        suggestions.push(`Job "${String(job.name ?? job.id)}": ${String(job.issue)}`);
      }
    }
  }

  if (diskHealth && typeof diskHealth === "object" && !("error" in diskHealth)) {
    const dh = diskHealth as Record<string, number>;
    if (dh.totalMB && dh.totalMB > 500) {
      suggestions.push(`Disk usage is ${dh.totalMB}MB. Consider running cleanup-disk.`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push("No issues detected. System looks healthy.");
  }

  return suggestions;
}
