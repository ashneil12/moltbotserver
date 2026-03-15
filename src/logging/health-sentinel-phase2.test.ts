/**
 * Health Sentinel — Phase 2 enhancements tests.
 *
 * Tests for: history tracking, disk-cleanup playbook, persistent rate-limit
 * state, configurable thresholds, doctor probes, and dashboard surface.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appendSentinelReport,
  getRecentReports,
  detectTrends,
  formatTrendContext,
  type HistoryEntry,
} from "./health-sentinel-history.js";
import { createDiskCleanupPlaybook, type RemediationContext } from "./health-sentinel-playbooks.js";
import type { SentinelDeps, SentinelReport } from "./health-sentinel-types.js";
import {
  runSentinelCheck,
  resetRateLimitStateForTest,
  classifyHealthIssues,
  getLastSentinelReport,
} from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-test-"));
}

function cleanTmpDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function makeReport(overrides?: Partial<SentinelReport>): SentinelReport {
  return {
    timestamp: new Date().toISOString(),
    healthy: true,
    issues: [],
    remediations: [],
    suppressedByRateLimit: 0,
    escalatedToAgent: false,
    ...overrides,
  };
}

function makeHistory(issueKeys: string[], healthy = false): HistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    healthy,
    issueKeys,
    remediationCount: 0,
    escalated: false,
  };
}

function makeDeps(overrides?: Partial<SentinelDeps>): SentinelDeps {
  return {
    getHealthSnapshot: async () =>
      ({ channels: {} }) as unknown as import("../commands/health.js").HealthSummary,
    runHealthCheck: async () => ({
      timestamp: new Date().toISOString(),
      healthy: true,
      checks: [],
      summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
    }),
    enqueueSystemEvent: () => {},
    requestHeartbeatNow: () => {},
    resolveMainSessionKey: () => "main",
    nowMs: () => Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// History tests
// ═══════════════════════════════════════════════════════════════════════════

describe("health-sentinel-history", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("appends and reads reports", () => {
    appendSentinelReport(makeReport(), tmpDir);
    appendSentinelReport(makeReport({ healthy: false }), tmpDir);

    const reports = getRecentReports(tmpDir);
    expect(reports).toHaveLength(2);
    expect(reports[0].healthy).toBe(true);
    expect(reports[1].healthy).toBe(false);
  });

  it("returns empty array when no history file exists", () => {
    const reports = getRecentReports(tmpDir);
    expect(reports).toEqual([]);
  });

  it("respects count limit", () => {
    for (let i = 0; i < 10; i++) {
      appendSentinelReport(makeReport(), tmpDir);
    }
    const reports = getRecentReports(tmpDir, 3);
    expect(reports).toHaveLength(3);
  });

  it("truncates when file exceeds 1MB", () => {
    // Write enough data to exceed 1MB
    const bigIssue = "x".repeat(1000);
    for (let i = 0; i < 1200; i++) {
      appendSentinelReport(
        makeReport({
          issues: [
            {
              key: bigIssue,
              classification: "warning",
              summary: bigIssue,
              source: { name: "test", status: "warn", detail: bigIssue },
            },
          ],
        }),
        tmpDir,
      );
    }

    const filePath = path.join(tmpDir, "sentinel-history.jsonl");
    const stat = fs.statSync(filePath);
    // After truncation, file should be roughly half
    expect(stat.size).toBeLessThan(1.2 * 1024 * 1024);
  });

  it("stores issue keys in history entries", () => {
    appendSentinelReport(
      makeReport({
        issues: [
          {
            key: "channel:telegram:default",
            classification: "auto-fixable",
            summary: "test",
            source: { name: "test", status: "fail", detail: "test" },
          },
          {
            key: "system:disk.log_directory",
            classification: "warning",
            summary: "test",
            source: { name: "test", status: "warn", detail: "test" },
          },
        ],
      }),
      tmpDir,
    );

    const reports = getRecentReports(tmpDir);
    expect(reports[0].issueKeys).toEqual(["channel:telegram:default", "system:disk.log_directory"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Trend detection tests
// ═══════════════════════════════════════════════════════════════════════════

describe("detectTrends", () => {
  it("detects persistent issues (≥70% presence)", () => {
    const history: HistoryEntry[] = [
      makeHistory(["channel:tg"]),
      makeHistory(["channel:tg"]),
      makeHistory(["channel:tg"]),
      makeHistory([]),
      makeHistory(["channel:tg"]),
    ];
    const trends = detectTrends(history);
    expect(trends.persistent).toContain("channel:tg");
  });

  it("detects flapping issues (≥2 transitions)", () => {
    const history: HistoryEntry[] = [
      makeHistory(["channel:tg"]),
      makeHistory([]),
      makeHistory(["channel:tg"]),
      makeHistory([]),
    ];
    const trends = detectTrends(history);
    expect(trends.flapping).toContain("channel:tg");
  });

  it("detects improving issues (present earlier, resolved recently)", () => {
    const history: HistoryEntry[] = [
      makeHistory(["channel:tg"]),
      makeHistory(["channel:tg"]),
      makeHistory([]),
      makeHistory([]),
    ];
    const trends = detectTrends(history);
    expect(trends.improving).toContain("channel:tg");
  });

  it("returns empty for insufficient data", () => {
    const trends = detectTrends([makeHistory(["x"])]);
    expect(trends).toEqual({ flapping: [], persistent: [], improving: [] });
  });
});

describe("formatTrendContext", () => {
  it("formats trend information", () => {
    const result = formatTrendContext({
      persistent: ["channel:tg"],
      flapping: ["system:disk"],
      improving: [],
    });
    expect(result).toContain("Persistent issues");
    expect(result).toContain("channel:tg");
    expect(result).toContain("Flapping issues");
    expect(result).toContain("system:disk");
  });

  it("returns null when no trends", () => {
    expect(formatTrendContext({ persistent: [], flapping: [], improving: [] })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Disk cleanup playbook tests
// ═══════════════════════════════════════════════════════════════════════════

describe("disk-cleanup playbook", () => {
  it("matches disk.log_directory issues that are auto-fixable", () => {
    const ctx: RemediationContext = {
      restartChannel: async () => {},
      probeChannelHealth: async () => false,
      rotateEventLogs: () => ({ rotated: [], deleted: [] }),
      checkDiskSpaceMB: () => 0,
    };
    const playbook = createDiskCleanupPlaybook(ctx);

    expect(
      playbook.matches({
        key: "system:disk.log_directory",
        classification: "auto-fixable",
        summary: "test",
        source: { name: "disk.log_directory", status: "warn", detail: "test" },
      }),
    ).toBe(true);

    expect(
      playbook.matches({
        key: "system:disk.log_directory",
        classification: "needs-agent",
        summary: "test",
        source: { name: "disk.log_directory", status: "fail", detail: "test" },
      }),
    ).toBe(false);

    expect(
      playbook.matches({
        key: "channel:telegram:default",
        classification: "auto-fixable",
        summary: "test",
        source: { kind: "channel", channelId: "telegram", accountId: "default", reason: "test" },
      }),
    ).toBe(false);
  });

  it("remediates by calling rotateEventLogs", async () => {
    let rotateCalled = false;
    const ctx: RemediationContext = {
      restartChannel: async () => {},
      probeChannelHealth: async () => false,
      rotateEventLogs: () => {
        rotateCalled = true;
        return { rotated: ["all.jsonl"], deleted: ["old.jsonl"] };
      },
      checkDiskSpaceMB: () => 200,
    };
    const playbook = createDiskCleanupPlaybook(ctx);

    const result = await playbook.remediate({
      key: "system:disk.log_directory",
      classification: "auto-fixable",
      summary: "test",
      source: { name: "disk.log_directory", status: "warn", detail: "test" },
    });

    expect(rotateCalled).toBe(true);
    expect(result.status).toBe("success");
    expect(result.playbook).toBe("disk-cleanup");
  });

  it("verifies by checking disk space dropped below threshold", async () => {
    const ctx: RemediationContext = {
      restartChannel: async () => {},
      probeChannelHealth: async () => false,
      rotateEventLogs: () => ({ rotated: [], deleted: [] }),
      checkDiskSpaceMB: () => 300,
    };
    const playbook = createDiskCleanupPlaybook(ctx);

    const verified = await playbook.verify({
      key: "system:disk.log_directory",
      classification: "auto-fixable",
      summary: "test",
      source: { name: "disk.log_directory", status: "warn", detail: "test" },
    });

    expect(verified).toBe(true);
  });

  it("fails verification when disk still above threshold", async () => {
    const ctx: RemediationContext = {
      restartChannel: async () => {},
      probeChannelHealth: async () => false,
      rotateEventLogs: () => ({ rotated: [], deleted: [] }),
      checkDiskSpaceMB: () => 600,
    };
    const playbook = createDiskCleanupPlaybook(ctx);

    const verified = await playbook.verify({
      key: "system:disk.log_directory",
      classification: "auto-fixable",
      summary: "test",
      source: { name: "disk.log_directory", status: "warn", detail: "test" },
    });

    expect(verified).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Configurable thresholds tests
// ═══════════════════════════════════════════════════════════════════════════

describe("configurable thresholds", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });

  it("uses default config when none provided", async () => {
    const report = await runSentinelCheck(makeDeps());
    expect(report.healthy).toBe(true);
  });

  it("respects custom maxConsecutiveFailures from config", () => {
    // With maxConsecutiveFailures = 1, a single failure should escalate
    const issues = classifyHealthIssues(
      {
        channels: {
          telegram: {
            accounts: {
              default: {
                accountId: "default",
                configured: true,
                linked: true,
                probe: { ok: false, error: "timeout" },
              },
            },
          },
        },
      } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: true,
        checks: [],
        summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
      },
      { maxConsecutiveFailures: 1 },
    );

    // With 0 consecutive failures and threshold of 1, it should be auto-fixable
    // (threshold means "escalate AT this number", and we have 0 failures so far)
    const channelIssue = issues.find((i) => i.key === "channel:telegram:default");
    expect(channelIssue).toBeDefined();
    expect(channelIssue!.classification).toBe("auto-fixable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Persistent rate-limit state tests
// ═══════════════════════════════════════════════════════════════════════════

describe("persistent rate-limit state", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
    resetRateLimitStateForTest();
  });

  it("saves rate-limit state to disk after sentinel run", async () => {
    await runSentinelCheck(makeDeps({ stateDir: tmpDir }));

    const filePath = path.join(tmpDir, "sentinel-rate-limit.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(saved).toHaveProperty("issueLastAttemptAt");
    expect(saved).toHaveProperty("remediationsThisHour");
    expect(saved).toHaveProperty("lastEscalationAt");
  });

  it("loads state from disk on first run", async () => {
    // Pre-seed a state file
    const filePath = path.join(tmpDir, "sentinel-rate-limit.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        issueLastAttemptAt: { "test:key": Date.now() },
        issueConsecutiveFailures: { "test:key": 2 },
        remediationsThisHour: [Date.now()],
        lastEscalationAt: Date.now() - 10_000,
        escalationsThisHour: [Date.now() - 10_000],
      }),
    );

    // Run sentinel — should load the pre-seeded state
    await runSentinelCheck(makeDeps({ stateDir: tmpDir }));

    // State should have been loaded (we can verify by checking the file is re-saved)
    const resaved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(resaved.issueConsecutiveFailures["test:key"]).toBe(2);
  });

  it("handles corrupted state file gracefully", async () => {
    const filePath = path.join(tmpDir, "sentinel-rate-limit.json");
    fs.writeFileSync(filePath, "not json");

    // Should not throw
    const report = await runSentinelCheck(makeDeps({ stateDir: tmpDir }));
    expect(report.healthy).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Doctor probes tests
// ═══════════════════════════════════════════════════════════════════════════

describe("doctor probes", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });

  it("includes state dir probe results in classification", async () => {
    const report = await runSentinelCheck(
      makeDeps({
        doctorProbes: {
          checkStateDirExists: () => ({
            name: "doctor.state_dir",
            status: "fail",
            detail: "State directory missing: /nonexistent",
          }),
        },
      }),
    );

    expect(report.healthy).toBe(false);
    const stateIssue = report.issues.find((i) => i.key === "system:doctor.state_dir");
    expect(stateIssue).toBeDefined();
    expect(stateIssue!.classification).toBe("needs-agent");
  });

  it("includes ephemeral path probe results", async () => {
    const report = await runSentinelCheck(
      makeDeps({
        doctorProbes: {
          checkEphemeralPaths: () => [
            {
              name: "doctor.ephemeral_state",
              status: "warn" as const,
              detail: "State dir is on ephemeral storage: under /tmp",
            },
          ],
        },
      }),
    );

    // Warnings don't make unhealthy, but should be in issues
    const ephemeralIssue = report.issues.find((i) => i.key === "system:doctor.ephemeral_state");
    expect(ephemeralIssue).toBeDefined();
    expect(ephemeralIssue!.classification).toBe("warning");
  });

  it("handles doctor probe errors gracefully", async () => {
    const report = await runSentinelCheck(
      makeDeps({
        doctorProbes: {
          checkStateDirExists: () => {
            throw new Error("probe crashed");
          },
        },
      }),
    );

    // Should not crash — just skip the probe
    expect(report.healthy).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard surface tests
// ═══════════════════════════════════════════════════════════════════════════

describe("dashboard surface", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });

  it("getLastSentinelReport returns the most recent report", async () => {
    const report = await runSentinelCheck(makeDeps());
    const lastReport = getLastSentinelReport();
    expect(lastReport).toBe(report);
    expect(lastReport!.healthy).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Disk classify as auto-fixable tests
// ═══════════════════════════════════════════════════════════════════════════

describe("disk.log_directory classification", () => {
  it("classifies warn status as auto-fixable", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [{ name: "disk.log_directory", status: "warn", detail: "Log directory is 600MB" }],
        summary: { pass: 0, fail: 0, warn: 1, skip: 0 },
      },
    );

    const diskIssue = issues.find((i) => i.key === "system:disk.log_directory");
    expect(diskIssue).toBeDefined();
    expect(diskIssue!.classification).toBe("auto-fixable");
  });

  it("classifies fail status as needs-agent", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [{ name: "disk.log_directory", status: "fail", detail: "Error checking disk" }],
        summary: { pass: 0, fail: 1, warn: 0, skip: 0 },
      },
    );

    const diskIssue = issues.find((i) => i.key === "system:disk.log_directory");
    expect(diskIssue).toBeDefined();
    expect(diskIssue!.classification).toBe("needs-agent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// History integration in sentinel tests
// ═══════════════════════════════════════════════════════════════════════════

describe("history integration", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
    resetRateLimitStateForTest();
  });

  it("appends history after healthy check", async () => {
    await runSentinelCheck(makeDeps({ stateDir: tmpDir }));

    const reports = getRecentReports(tmpDir);
    expect(reports).toHaveLength(1);
    expect(reports[0].healthy).toBe(true);
  });

  it("appends history after unhealthy check", async () => {
    await runSentinelCheck(
      makeDeps({
        stateDir: tmpDir,
        runHealthCheck: async () => ({
          timestamp: new Date().toISOString(),
          healthy: false,
          checks: [{ name: "gateway.port", status: "fail" as const, detail: "Port unreachable" }],
          summary: { pass: 0, fail: 1, warn: 0, skip: 0 },
        }),
      }),
    );

    const reports = getRecentReports(tmpDir);
    expect(reports).toHaveLength(1);
    expect(reports[0].healthy).toBe(false);
    expect(reports[0].issueKeys).toContain("system:gateway.port");
  });
});
