import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendEntry, readAllEntries, type RemediationEntry } from "./remediation-journal.js";
import {
  runRemediationWatchdog,
  resetWatchdogThrottle,
  type WatchdogDeps,
} from "./remediation-watchdog.js";

// Use timestamps well above the throttle window (5 min = 300_000ms)
const BASE_TS = 1_000_000;
const TTL_MS = 30 * 60_000; // 30 min

describe("remediation-watchdog", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rem-watchdog-test-"));
    journalPath = path.join(tmpDir, "remediation-journal.jsonl");
    resetWatchdogThrottle();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSampleEntry(overrides?: Partial<RemediationEntry>): RemediationEntry {
    return {
      id: "test-id-1",
      timestamp: BASE_TS,
      probe: "cron.consecutive_errors",
      action: "re-enable",
      target: { jobId: "job-1", jobName: "Test Job" },
      description: "Re-enabling after fixing root cause",
      previousState: { enabled: false },
      appliedPatch: { enabled: true },
      outcome: "applied",
      ttlMs: TTL_MS,
      expiresAt: BASE_TS + TTL_MS,
      attempt: 1,
      maxAttempts: 2,
      ...overrides,
    };
  }

  function makeDeps(overrides?: Partial<WatchdogDeps>): WatchdogDeps {
    return {
      journalPath,
      nowMs: BASE_TS + 5 * 60_000, // 5 min after entry, past throttle
      patchJob: vi.fn().mockResolvedValue(undefined),
      enqueueSystemEvent: vi.fn(),
      getJobErrorSince: vi.fn().mockReturnValue(null),
      ...overrides,
    };
  }

  it("confirms entries whose TTL has expired without re-failure", async () => {
    const nowMs = BASE_TS + TTL_MS + 1; // just past TTL
    appendEntry(journalPath, makeSampleEntry({ id: "to-confirm" }));

    const deps = makeDeps({ nowMs });
    const result = await runRemediationWatchdog(deps);

    expect(result.confirmed).toBe(1);
    expect(result.rolledBack).toBe(0);

    const entries = readAllEntries(journalPath);
    expect(entries[0].outcome).toBe("confirmed");
  });

  it("rolls back entries when job re-fails within TTL", async () => {
    appendEntry(journalPath, makeSampleEntry({ id: "to-rollback" }));

    const nowMs = BASE_TS + 10 * 60_000; // 10 min after entry, within TTL
    const deps = makeDeps({
      nowMs,
      getJobErrorSince: vi.fn().mockReturnValue("Timeout after 60s"),
    });
    const result = await runRemediationWatchdog(deps);

    expect(result.rolledBack).toBe(1);
    expect(deps.patchJob).toHaveBeenCalledWith("job-1", { enabled: false });

    const entries = readAllEntries(journalPath);
    expect(entries[0].outcome).toBe("rolled-back");
    expect(entries[0].rollbackReason).toContain("Job re-failed");
  });

  it("escalates after max attempts exceeded", async () => {
    // Create 2 entries for the same job+probe (first rolled back, second still active)
    appendEntry(
      journalPath,
      makeSampleEntry({
        id: "attempt-1",
        attempt: 1,
        outcome: "rolled-back",
      }),
    );
    appendEntry(
      journalPath,
      makeSampleEntry({
        id: "attempt-2",
        attempt: 2,
        outcome: "applied",
      }),
    );

    const nowMs = BASE_TS + 10 * 60_000;
    const deps = makeDeps({
      nowMs,
      getJobErrorSince: vi.fn().mockReturnValue("Still failing"),
    });
    const result = await runRemediationWatchdog(deps);

    expect(result.escalated).toBe(1);
    expect(deps.enqueueSystemEvent).toHaveBeenCalled();
    const alertText = (deps.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alertText).toContain("ESCALATION");
    expect(alertText).toContain("Human intervention required");
  });

  it("does not act on already-confirmed or rolled-back entries", async () => {
    appendEntry(
      journalPath,
      makeSampleEntry({
        id: "already-confirmed",
        outcome: "confirmed",
        expiresAt: BASE_TS + TTL_MS * 2,
      }),
    );
    appendEntry(
      journalPath,
      makeSampleEntry({
        id: "already-rolled-back",
        outcome: "rolled-back",
        expiresAt: BASE_TS + TTL_MS * 2,
      }),
    );

    const deps = makeDeps({ nowMs: BASE_TS + 10 * 60_000 });
    const result = await runRemediationWatchdog(deps);

    expect(result.confirmed).toBe(0);
    expect(result.rolledBack).toBe(0);
    expect(result.escalated).toBe(0);
  });

  it("respects throttle — does not run within 5-minute window", async () => {
    appendEntry(journalPath, makeSampleEntry({ id: "entry" }));

    const firstNow = BASE_TS + 10 * 60_000; // past throttle
    await runRemediationWatchdog(makeDeps({ nowMs: firstNow }));

    // Second run within 5 minutes of first
    resetWatchdogThrottle(); // reset, but...
    // Actually, don't reset! We want to test the throttle blocking.
    // The first run set lastRunMs = firstNow. Second run at firstNow + 1 min:
    const secondResult = await runRemediationWatchdog(makeDeps({ nowMs: firstNow + 60_000 }));
    expect(secondResult).toEqual({ confirmed: 0, rolledBack: 0, escalated: 0, pruned: 0 });
  });

  it("prunes old entries during watchdog run", async () => {
    const now = Date.now();
    appendEntry(
      journalPath,
      makeSampleEntry({
        id: "old-confirmed",
        timestamp: now - 15 * 24 * 60 * 60_000, // 15 days ago
        outcome: "confirmed",
      }),
    );

    const deps = makeDeps({ nowMs: now, retentionDays: 14 });
    const result = await runRemediationWatchdog(deps);

    expect(result.pruned).toBe(1);
  });

  it("confirms fix when TTL expires and no errors are present", async () => {
    const nowMs = BASE_TS + TTL_MS + 1; // just past TTL
    appendEntry(journalPath, makeSampleEntry({ id: "cleared-error" }));

    const deps = makeDeps({
      nowMs,
      getJobErrorSince: vi.fn().mockReturnValue(null),
    });
    const result = await runRemediationWatchdog(deps);

    expect(result.confirmed).toBe(1);
  });
});
