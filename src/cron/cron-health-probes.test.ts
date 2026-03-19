/**
 * Tests for cron health probes.
 *
 * Verifies all 4 probes: scheduler liveness, consecutive errors,
 * auto-disabled jobs, and stale delivery targets.
 */

import { describe, expect, it } from "vitest";
import {
  checkSchedulerLiveness,
  checkConsecutiveErrors,
  checkAutoDisabledJobs,
  checkStaleDeliveryTargets,
  runCronHealthProbes,
  type CronHealthDeps,
  type CronHealthJob,
} from "./cron-health-probes.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<CronHealthJob> = {}): CronHealthJob {
  return {
    id: "job-1",
    name: "Test Job",
    enabled: true,
    state: {
      consecutiveErrors: 0,
      lastRunAtMs: Date.now(),
      lastStatus: "ok",
      scheduleErrorCount: 0,
    },
    delivery: { mode: "announce", channel: "telegram", to: "123456" },
    sessionTarget: "isolated",
    payload: { kind: "agentTurn" },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CronHealthDeps> = {}): CronHealthDeps {
  return {
    lastTickAtMs: Date.now() - 30_000, // 30s ago
    nowMs: Date.now(),
    jobs: [],
    ...overrides,
  };
}

// ── Scheduler Liveness ──────────────────────────────────────────────────

describe("checkSchedulerLiveness", () => {
  it("passes when scheduler ticked recently", () => {
    const result = checkSchedulerLiveness(makeDeps({ lastTickAtMs: Date.now() - 10_000 }));
    expect(result.status).toBe("pass");
    expect(result.name).toBe("cron.scheduler_liveness");
  });

  it("warns when scheduler has never ticked", () => {
    const result = checkSchedulerLiveness(makeDeps({ lastTickAtMs: undefined }));
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("not ticked yet");
  });

  it("fails when scheduler is stale", () => {
    const result = checkSchedulerLiveness(
      makeDeps({ lastTickAtMs: Date.now() - 10 * 60_000 }), // 10 min ago
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("may be dead");
  });

  it("respects custom liveness threshold", () => {
    const result = checkSchedulerLiveness(
      makeDeps({
        lastTickAtMs: Date.now() - 2 * 60_000, // 2 min ago
        livenessThresholdMs: 60_000, // 1 min threshold
      }),
    );
    expect(result.status).toBe("fail");
  });
});

// ── Consecutive Errors ──────────────────────────────────────────────────

describe("checkConsecutiveErrors", () => {
  it("passes when no jobs have errors", () => {
    const results = checkConsecutiveErrors(
      makeDeps({ jobs: [makeJob(), makeJob({ id: "job-2" })] }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
  });

  it("warns when some jobs have consecutive errors", () => {
    const results = checkConsecutiveErrors(
      makeDeps({
        jobs: [makeJob({ state: { consecutiveErrors: 3, lastStatus: "error" } })],
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("warn");
    expect(results[0].detail).toContain("Test Job");
  });

  it("fails when 3+ jobs have consecutive errors", () => {
    const results = checkConsecutiveErrors(
      makeDeps({
        jobs: [
          makeJob({ id: "j1", name: "J1", state: { consecutiveErrors: 2 } }),
          makeJob({ id: "j2", name: "J2", state: { consecutiveErrors: 3 } }),
          makeJob({ id: "j3", name: "J3", state: { consecutiveErrors: 5 } }),
        ],
      }),
    );
    expect(results[0].status).toBe("fail");
  });

  it("ignores disabled jobs", () => {
    const results = checkConsecutiveErrors(
      makeDeps({
        jobs: [makeJob({ enabled: false, state: { consecutiveErrors: 10 } })],
      }),
    );
    expect(results[0].status).toBe("pass");
  });
});

// ── Auto-Disabled Jobs ──────────────────────────────────────────────────

describe("checkAutoDisabledJobs", () => {
  it("passes when no jobs are auto-disabled", () => {
    const results = checkAutoDisabledJobs(makeDeps({ jobs: [makeJob()] }));
    expect(results[0].status).toBe("pass");
  });

  it("warns when jobs are auto-disabled by schedule errors", () => {
    const results = checkAutoDisabledJobs(
      makeDeps({
        jobs: [
          makeJob({
            enabled: false,
            state: { scheduleErrorCount: 3, consecutiveErrors: 0 },
          }),
        ],
      }),
    );
    expect(results[0].status).toBe("warn");
    expect(results[0].detail).toContain("auto-disabled");
  });

  it("warns when jobs are auto-disabled by consecutive errors", () => {
    const results = checkAutoDisabledJobs(
      makeDeps({
        jobs: [
          makeJob({
            enabled: false,
            state: { consecutiveErrors: 5, lastStatus: "error" },
          }),
        ],
      }),
    );
    expect(results[0].status).toBe("warn");
  });
});

// ── Stale Delivery Targets ──────────────────────────────────────────────

describe("checkStaleDeliveryTargets", () => {
  it("passes when all jobs have explicit targets", () => {
    const results = checkStaleDeliveryTargets(
      makeDeps({
        jobs: [makeJob({ delivery: { mode: "announce", channel: "telegram", to: "123" } })],
      }),
    );
    expect(results[0].status).toBe("pass");
  });

  it("warns when jobs use channel:last without explicit to", () => {
    const results = checkStaleDeliveryTargets(
      makeDeps({
        jobs: [makeJob({ delivery: { mode: "announce", channel: "last" } })],
      }),
    );
    expect(results[0].status).toBe("warn");
    expect(results[0].detail).toContain('channel:"last"');
  });

  it("ignores disabled jobs", () => {
    const results = checkStaleDeliveryTargets(
      makeDeps({
        jobs: [makeJob({ enabled: false, delivery: { mode: "announce", channel: "last" } })],
      }),
    );
    expect(results[0].status).toBe("pass");
  });

  it("ignores webhook/none mode", () => {
    const results = checkStaleDeliveryTargets(
      makeDeps({
        jobs: [makeJob({ delivery: { mode: "webhook", channel: "last" } })],
      }),
    );
    expect(results[0].status).toBe("pass");
  });
});

// ── Combined Probe ──────────────────────────────────────────────────────

describe("runCronHealthProbes", () => {
  it("returns results from all 4 probes", () => {
    const results = runCronHealthProbes(makeDeps({ jobs: [makeJob()] }));
    const names = results.map((r) => r.name);
    expect(names).toContain("cron.scheduler_liveness");
    expect(names).toContain("cron.consecutive_errors");
    expect(names).toContain("cron.auto_disabled");
    expect(names).toContain("cron.stale_delivery");
  });

  it("reports all healthy when everything is fine", () => {
    const results = runCronHealthProbes(makeDeps({ jobs: [makeJob()] }));
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });
});
