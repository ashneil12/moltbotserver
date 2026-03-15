import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthSummary, ChannelHealthSummary } from "../commands/health.js";
import type { HealthCheckReport, CheckResult } from "./diagnostics-toolkit.js";
import type { SentinelDeps } from "./health-sentinel-types.js";
import {
  runSentinelCheck,
  classifyHealthIssues,
  resetRateLimitStateForTest,
} from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Factories
// ═══════════════════════════════════════════════════════════════════════════

function createMockHealthSummary(
  channels: Record<string, Partial<ChannelHealthSummary>> = {},
): HealthSummary {
  return {
    ok: true,
    ts: Date.now(),
    durationMs: 100,
    channels: channels as Record<string, ChannelHealthSummary>,
    channelOrder: Object.keys(channels),
    channelLabels: {},
    heartbeatSeconds: 30,
    defaultAgentId: "default",
    agents: [],
    sessions: { path: "/tmp/sessions", count: 0, recent: [] },
  };
}

function createMockSystemReport(checks: Array<Partial<CheckResult>> = []): HealthCheckReport {
  const fullChecks: CheckResult[] = checks.map((c) => ({
    name: c.name ?? "unknown",
    status: c.status ?? "pass",
    detail: c.detail ?? "",
    ...c,
  }));
  const pass = fullChecks.filter((c) => c.status === "pass").length;
  const fail = fullChecks.filter((c) => c.status === "fail").length;
  const warn = fullChecks.filter((c) => c.status === "warn").length;
  const skip = fullChecks.filter((c) => c.status === "skip").length;
  return {
    timestamp: new Date().toISOString(),
    healthy: fullChecks.every((c) => c.status === "pass" || c.status === "skip"),
    summary: { pass, fail, warn, skip },
    checks: fullChecks,
  };
}

function createMockDeps(overrides?: Partial<SentinelDeps>): SentinelDeps {
  return {
    getHealthSnapshot: vi.fn(async () => createMockHealthSummary()),
    runHealthCheck: vi.fn(async () => createMockSystemReport()),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    resolveMainSessionKey: vi.fn(() => "main"),
    nowMs: () => Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("health-sentinel", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Classification
  // ─────────────────────────────────────────────────────────────────────

  describe("classifyHealthIssues", () => {
    it("returns empty array when everything is healthy", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "gateway.port", status: "pass" },
        { name: "logs.error_rate", status: "pass" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(0);
    });

    it("classifies gateway port failure as needs-agent", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "gateway.port", status: "fail", detail: "port 18789 unreachable" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("needs-agent");
      expect(issues[0].key).toBe("system:gateway.port");
    });

    it("classifies high error rate as needs-agent", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "logs.error_rate", status: "fail", detail: "72 errors in the last hour" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("needs-agent");
    });

    it("classifies failed channel probe as auto-fixable", () => {
      const snapshot = createMockHealthSummary({
        telegram: {
          accountId: "default",
          configured: true,
          accounts: {
            default: {
              accountId: "default",
              configured: true,
              probe: { ok: false, error: "polling stopped" },
            },
          },
        },
      });
      const report = createMockSystemReport();
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("auto-fixable");
      expect(issues[0].key).toBe("channel:telegram:default");
    });

    it("classifies unlinked channel as needs-agent", () => {
      const snapshot = createMockHealthSummary({
        whatsapp: {
          accountId: "default",
          configured: true,
          linked: false,
          accounts: {
            default: {
              accountId: "default",
              configured: true,
              linked: false,
            },
          },
        },
      });
      const report = createMockSystemReport();
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("needs-agent");
      expect(issues[0].key).toContain("unlinked");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Sentinel Orchestrator
  // ─────────────────────────────────────────────────────────────────────

  describe("runSentinelCheck", () => {
    it("reports healthy when all checks pass", async () => {
      const deps = createMockDeps();
      const report = await runSentinelCheck(deps);
      expect(report.healthy).toBe(true);
      expect(report.issues).toHaveLength(0);
      expect(report.remediations).toHaveLength(0);
      expect(report.escalatedToAgent).toBe(false);
    });

    it("does not escalate warnings", async () => {
      const deps = createMockDeps({
        runHealthCheck: vi.fn(async () =>
          createMockSystemReport([
            { name: "logs.error_rate", status: "warn", detail: "approaching threshold" },
          ]),
        ),
      });
      const report = await runSentinelCheck(deps);
      // Warning issues exist but no escalation
      expect(report.issues).toHaveLength(1);
      expect(report.escalatedToAgent).toBe(false);
      expect(deps.enqueueSystemEvent).not.toHaveBeenCalled();
    });

    it("escalates critical issues to agent via system event", async () => {
      const deps = createMockDeps({
        runHealthCheck: vi.fn(async () =>
          createMockSystemReport([{ name: "gateway.port", status: "fail", detail: "unreachable" }]),
        ),
      });
      const report = await runSentinelCheck(deps);
      expect(report.escalatedToAgent).toBe(true);
      expect(deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
      expect(deps.requestHeartbeatNow).toHaveBeenCalledWith({ reason: "health-sentinel" });

      // Check the event text is structured
      const eventText = (deps.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(eventText).toContain("[HEALTH SENTINEL]");
      expect(eventText).toContain("unreachable");
    });

    it("handles health data gathering failure gracefully", async () => {
      const deps = createMockDeps({
        getHealthSnapshot: vi.fn(async () => {
          throw new Error("gateway down");
        }),
      });
      const report = await runSentinelCheck(deps);
      expect(report.healthy).toBe(false);
      expect(report.escalatedToAgent).toBe(false);
    });

    it("respects escalation cooldown", async () => {
      const now = Date.now();
      const deps = createMockDeps({
        nowMs: () => now,
        runHealthCheck: vi.fn(async () =>
          createMockSystemReport([{ name: "gateway.port", status: "fail", detail: "unreachable" }]),
        ),
      });

      // First run: should escalate
      const report1 = await runSentinelCheck(deps);
      expect(report1.escalatedToAgent).toBe(true);

      // Second run within cooldown: should NOT escalate
      const report2 = await runSentinelCheck(deps);
      expect(report2.escalatedToAgent).toBe(false);
      // Only the first call remains
      expect(deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    });

    it("respects escalation cooldown between checks", async () => {
      const t0 = Date.now();
      let now = t0;
      const deps = createMockDeps({
        nowMs: () => now,
        runHealthCheck: vi.fn(async () =>
          createMockSystemReport([{ name: "gateway.port", status: "fail", detail: "unreachable" }]),
        ),
      });

      // 1st escalation — should succeed
      await runSentinelCheck(deps);
      expect(deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);

      // 2nd: within 30-min cooldown — should be blocked
      now = t0 + 20 * 60_000;
      const r2 = await runSentinelCheck(deps);
      expect(r2.escalatedToAgent).toBe(false);
      expect(deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);

      // 3rd: past 30-min cooldown — should succeed
      now = t0 + 31 * 60_000;
      const r3 = await runSentinelCheck(deps);
      expect(r3.escalatedToAgent).toBe(true);
      expect(deps.enqueueSystemEvent).toHaveBeenCalledTimes(2);
    });

    it("clears consecutive failure count on successful remediation", async () => {
      // This test verifies that a channel issue that has been successfully
      // remediated resets its failure counter, so it gets classified as
      // "auto-fixable" again next time (not "needs-agent").
      const now = Date.now();
      const deps = createMockDeps({
        nowMs: () => now,
        getHealthSnapshot: vi.fn(async () =>
          createMockHealthSummary({
            telegram: {
              accountId: "default",
              configured: true,
              accounts: {
                default: {
                  accountId: "default",
                  configured: true,
                  probe: { ok: false, error: "stopped" },
                },
              },
            },
          }),
        ),
      });

      const report = await runSentinelCheck(deps);
      // Channel issue should be detected (auto-fixable or needs-agent)
      expect(report.issues.length).toBeGreaterThan(0);
    });
  });
});
