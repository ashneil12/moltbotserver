import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "./diagnostics-toolkit.js";
import {
  createBrowserRestartPlaybook,
  type RemediationContext,
} from "./health-sentinel-playbooks.js";
import {
  createMockHealthSummary,
  createMockSystemReport,
  createMockDeps,
} from "./health-sentinel-test-helpers.js";
import {
  runSentinelCheck,
  classifyHealthIssues,
  resetRateLimitStateForTest,
} from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("health-sentinel — browser probes", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Classification
  // ─────────────────────────────────────────────────────────────────────

  describe("classifyHealthIssues — browser checks", () => {
    it("classifies browser container failure as auto-fixable (first occurrence)", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        {
          name: "sandbox.browser.browser-dan",
          status: "fail",
          detail: "Container exists but not running. CDP port 49221",
        },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("auto-fixable");
      expect(issues[0].key).toBe("system:sandbox.browser.browser-dan");
      expect(issues[0].summary).toContain("browser-dan");
    });

    it("classifies browser CDP unreachable as auto-fixable", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        {
          name: "sandbox.browser.browser-ezra",
          status: "fail",
          detail: "CDP port 49222 unreachable: ECONNREFUSED",
        },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("auto-fixable");
      expect(issues[0].summary).toContain("browser-ezra");
    });

    it("does not classify passed browser checks as issues", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        {
          name: "sandbox.browser.browser-dan",
          status: "pass",
          detail: "Healthy (CDP port 49221, 12ms)",
        },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(0);
    });

    it("does not classify skipped browser checks as issues", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        {
          name: "sandbox.browser.browser-dan",
          status: "skip",
          detail: "No browser containers registered",
        },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Orchestrator integration — doctorProbes.checkBrowserHealth
  // ─────────────────────────────────────────────────────────────────────

  describe("runSentinelCheck — browser probe integration", () => {
    it("includes browser checks from doctorProbes in the report", async () => {
      const browserChecks: CheckResult[] = [
        {
          name: "sandbox.browser.browser-dan",
          status: "pass",
          detail: "Healthy (CDP port 49221, 10ms)",
          durationMs: 10,
        },
        {
          name: "sandbox.browser.browser-ezra",
          status: "fail",
          detail: "CDP port 49222 unreachable: ECONNREFUSED",
          durationMs: 5,
        },
      ];

      const deps = createMockDeps({
        doctorProbes: {
          checkBrowserHealth: vi.fn(async () => browserChecks),
        },
      });

      const report = await runSentinelCheck(deps);
      // One browser healthy, one unhealthy → 1 auto-fixable issue
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].classification).toBe("auto-fixable");
      expect(report.issues[0].key).toBe("system:sandbox.browser.browser-ezra");
    });

    it("handles checkBrowserHealth throwing gracefully", async () => {
      const deps = createMockDeps({
        doctorProbes: {
          checkBrowserHealth: vi.fn(async () => {
            throw new Error("probe crashed");
          }),
        },
      });

      // Should not throw — probe errors are caught and logged
      const report = await runSentinelCheck(deps);
      expect(report.healthy).toBe(true);
    });

    it("browser failures do not block escalation of other issues", async () => {
      const deps = createMockDeps({
        runHealthCheck: vi.fn(async () =>
          createMockSystemReport([
            {
              name: "gateway.port",
              status: "fail",
              detail: "Port unreachable",
            },
          ]),
        ),
        doctorProbes: {
          checkBrowserHealth: vi.fn(async () => [
            {
              name: "sandbox.browser.browser-dan",
              status: "fail" as const,
              detail: "Container not found. CDP port 49221",
              durationMs: 5,
            },
          ]),
        },
      });

      const report = await runSentinelCheck(deps);
      // Gateway port issue + browser issue
      expect(report.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Browser Restart Playbook
  // ─────────────────────────────────────────────────────────────────────

  describe("createBrowserRestartPlaybook", () => {
    it("matches auto-fixable browser issues when restart handler is provided", () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
        probeBrowserCdp: vi.fn(),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Container exists but not running. CDP port 49221",
        },
      };

      expect(playbook.matches(issue)).toBe(true);
    });

    it("does not match when restartBrowserContainer is not provided", () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Container not running",
        },
      };

      expect(playbook.matches(issue)).toBe(false);
    });

    it("does not match non-browser issues", () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:disk.log_directory",
        classification: "auto-fixable" as const,
        summary: "Disk issue",
        source: {
          name: "disk.log_directory",
          status: "warn" as const,
          detail: "Disk space low",
        },
      };

      expect(playbook.matches(issue)).toBe(false);
    });

    it("does not match needs-agent classification", () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "needs-agent" as const,
        summary: "Persistent browser failure",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Still broken",
        },
      };

      expect(playbook.matches(issue)).toBe(false);
    });

    it("calls restartBrowserContainer with extracted container name", async () => {
      const restartFn = vi.fn(async () => {});
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: restartFn,
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Container not running. CDP port 49221",
        },
      };

      const result = await playbook.remediate(issue);
      expect(result.status).toBe("success");
      expect(result.playbook).toBe("browser-container-restart");
      expect(restartFn).toHaveBeenCalledWith("browser-dan");
    });

    it("returns failed when restartBrowserContainer throws", async () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(async () => {
          throw new Error("docker restart failed");
        }),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Container not running. CDP port 49221",
        },
      };

      const result = await playbook.remediate(issue);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("docker restart failed");
    });

    it("returns skipped when container name cannot be extracted", async () => {
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      // Edge case: key has the prefix but no name after it
      const issue = {
        key: "system:sandbox.browser.",
        classification: "auto-fixable" as const,
        summary: "Malformed issue",
        source: {
          name: "sandbox.browser.",
          status: "fail" as const,
          detail: "Bad",
        },
      };

      const result = await playbook.remediate(issue);
      expect(result.status).toBe("skipped");
    });

    it("verify extracts CDP port from detail and probes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const probeFn = vi.fn(async () => true);
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
        probeBrowserCdp: probeFn,
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "CDP port 49221 unreachable: ECONNREFUSED",
        },
      };

      const verifyPromise = playbook.verify(issue);
      await vi.advanceTimersByTimeAsync(10_000);
      const verified = await verifyPromise;

      expect(verified).toBe(true);
      expect(probeFn).toHaveBeenCalledWith(49221);
      vi.useRealTimers();
    });

    it("verify returns false when CDP port cannot be extracted", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
        probeBrowserCdp: vi.fn(async () => true),
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "Container not running — no port info",
        },
      };

      const verifyPromise = playbook.verify(issue);
      await vi.advanceTimersByTimeAsync(10_000);
      const verified = await verifyPromise;

      expect(verified).toBe(false);
      vi.useRealTimers();
    });

    it("verify returns false when CDP probe reports failure", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const probeFn = vi.fn(async () => false);
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
        probeBrowserCdp: probeFn,
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container browser-dan unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "CDP port 49221 unreachable: ECONNREFUSED",
        },
      };

      const verifyPromise = playbook.verify(issue);
      await vi.advanceTimersByTimeAsync(10_000);
      const verified = await verifyPromise;

      expect(verified).toBe(false);
      expect(probeFn).toHaveBeenCalledWith(49221);
      vi.useRealTimers();
    });

    it("rejects malicious container names in issue keys (command injection guard)", async () => {
      const restartFn = vi.fn(async () => {});
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: restartFn,
      };

      const playbook = createBrowserRestartPlaybook(ctx);

      // Attempt injection via semicolon
      const issue = {
        key: "system:sandbox.browser.browser-dan;rm -rf /",
        classification: "auto-fixable" as const,
        summary: "Malicious issue",
        source: {
          name: "sandbox.browser.browser-dan;rm -rf /",
          status: "fail" as const,
          detail: "Bad",
        },
      };

      const result = await playbook.remediate(issue);
      expect(result.status).toBe("skipped");
      expect(restartFn).not.toHaveBeenCalled();
    });

    it("rejects out-of-range port numbers", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const probeFn = vi.fn(async () => true);
      const ctx: RemediationContext = {
        restartChannel: vi.fn(),
        probeChannelHealth: vi.fn(),
        rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
        checkDiskSpaceMB: vi.fn(() => 0),
        restartBrowserContainer: vi.fn(),
        probeBrowserCdp: probeFn,
      };

      const playbook = createBrowserRestartPlaybook(ctx);
      const issue = {
        key: "system:sandbox.browser.browser-dan",
        classification: "auto-fixable" as const,
        summary: "Browser container unhealthy",
        source: {
          name: "sandbox.browser.browser-dan",
          status: "fail" as const,
          detail: "CDP port 99999 unreachable",
        },
      };

      const verifyPromise = playbook.verify(issue);
      await vi.advanceTimersByTimeAsync(10_000);
      const verified = await verifyPromise;

      expect(verified).toBe(false);
      expect(probeFn).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
