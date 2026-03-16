import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "./diagnostics-toolkit.js";
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

describe("health-sentinel — sidecar probes", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Classification
  // ─────────────────────────────────────────────────────────────────────

  describe("classifyHealthIssues — sidecar checks", () => {
    it("classifies SearXNG failure as warning (non-critical)", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "sidecar.searxng", status: "fail", detail: "Unreachable: ECONNREFUSED" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("warning");
      expect(issues[0].key).toBe("system:sidecar.searxng");
      expect(issues[0].summary).toContain("SearXNG");
    });

    it("classifies Scrapling failure as warning (non-critical)", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "sidecar.scrapling", status: "fail", detail: "Timed out after 5000ms" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(1);
      expect(issues[0].classification).toBe("warning");
      expect(issues[0].summary).toContain("Scrapling");
    });

    it("does not classify passed sidecar checks as issues", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "sidecar.searxng", status: "pass", detail: "Healthy (200, 12ms)" },
        { name: "sidecar.scrapling", status: "pass", detail: "Healthy (200, 8ms)" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(0);
    });

    it("does not classify skipped sidecar checks as issues", () => {
      const snapshot = createMockHealthSummary();
      const report = createMockSystemReport([
        { name: "sidecar.searxng", status: "skip", detail: "SEARXNG_BASE_URL not set" },
      ]);
      const issues = classifyHealthIssues(snapshot, report);
      expect(issues).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Orchestrator integration — doctorProbes.checkSidecarHealth
  // ─────────────────────────────────────────────────────────────────────

  describe("runSentinelCheck — sidecar probe integration", () => {
    it("includes sidecar checks from doctorProbes in the report", async () => {
      const sidecarChecks: CheckResult[] = [
        { name: "sidecar.searxng", status: "pass", detail: "Healthy (200, 10ms)", durationMs: 10 },
        {
          name: "sidecar.scrapling",
          status: "fail",
          detail: "Unreachable: ECONNREFUSED",
          durationMs: 5,
        },
      ];

      const deps = createMockDeps({
        doctorProbes: {
          checkSidecarHealth: vi.fn(async () => sidecarChecks),
        },
      });

      const report = await runSentinelCheck(deps);
      // Scrapling failure → warning, not escalated
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].classification).toBe("warning");
      expect(report.escalatedToAgent).toBe(false);
    });

    it("handles checkSidecarHealth throwing gracefully", async () => {
      const deps = createMockDeps({
        doctorProbes: {
          checkSidecarHealth: vi.fn(async () => {
            throw new Error("probe crashed");
          }),
        },
      });

      // Should not throw — probe errors are caught and logged
      const report = await runSentinelCheck(deps);
      expect(report.healthy).toBe(true);
    });

    it("sidecar warnings do not trigger agent escalation", async () => {
      const deps = createMockDeps({
        doctorProbes: {
          checkSidecarHealth: vi.fn(async () => [
            {
              name: "sidecar.searxng",
              status: "fail" as const,
              detail: "Unreachable",
              durationMs: 5,
            },
            {
              name: "sidecar.scrapling",
              status: "fail" as const,
              detail: "Unreachable",
              durationMs: 5,
            },
          ]),
        },
      });

      const report = await runSentinelCheck(deps);
      // Both are warnings, no escalation
      expect(report.issues).toHaveLength(2);
      expect(report.escalatedToAgent).toBe(false);
      expect(deps.enqueueSystemEvent).not.toHaveBeenCalled();
    });
  });
});
