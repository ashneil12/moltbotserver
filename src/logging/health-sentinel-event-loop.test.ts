/**
 * Tests for event loop degradation classification and gateway-restart playbook.
 *
 * Covers:
 * - classifyHealthIssues: event loop check → correct classification
 * - createGatewayRestartPlaybook: matching, remediation, verify, and edge cases
 */

import { describe, it, expect, vi } from "vitest";
import {
  createGatewayRestartPlaybook,
  type RemediationContext,
} from "./health-sentinel-playbooks.js";
import { createMockHealthSummary, createMockSystemReport } from "./health-sentinel-test-helpers.js";
import type { ClassifiedIssue } from "./health-sentinel-types.js";
import { classifyHealthIssues } from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Classification Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("event loop classification", () => {
  it("classifies event loop fail as auto-fixable", () => {
    const systemReport = createMockSystemReport([
      {
        name: "process.event_loop_delay",
        status: "fail",
        detail:
          "Event loop severely degraded: p99=3000ms mean=2500ms min=10ms max=5000ms (threshold: 2000ms)",
      },
    ]);
    const healthSummary = createMockHealthSummary();
    const issues = classifyHealthIssues(healthSummary, systemReport, {});

    expect(issues).toHaveLength(1);
    expect(issues[0].classification).toBe("auto-fixable");
    expect(issues[0].key).toBe("system:process.event_loop_delay");
    expect(issues[0].summary).toContain("severely degraded");
    expect(issues[0].suggestedAction).toContain("restart");
  });

  it("classifies event loop warn as warning", () => {
    const systemReport = createMockSystemReport([
      {
        name: "process.event_loop_delay",
        status: "warn",
        detail:
          "Event loop lag elevated: p99=700ms mean=400ms min=5ms max=900ms (threshold: 500ms)",
      },
    ]);
    const healthSummary = createMockHealthSummary();
    const issues = classifyHealthIssues(healthSummary, systemReport, {});

    expect(issues).toHaveLength(1);
    expect(issues[0].classification).toBe("warning");
    expect(issues[0].key).toBe("system:process.event_loop_delay");
    expect(issues[0].summary).toContain("elevated");
  });

  it("does not classify passing event loop checks", () => {
    const systemReport = createMockSystemReport([
      {
        name: "process.event_loop_delay",
        status: "pass",
        detail: "p99=15ms mean=8ms min=1ms max=30ms",
      },
    ]);
    const healthSummary = createMockHealthSummary();
    const issues = classifyHealthIssues(healthSummary, systemReport, {});

    // Pass checks should not generate any issues
    expect(issues).toHaveLength(0);
  });

  it("does not classify skipped event loop checks", () => {
    const systemReport = createMockSystemReport([
      {
        name: "process.event_loop_delay",
        status: "skip",
        detail: "Event loop monitor not started",
      },
    ]);
    const healthSummary = createMockHealthSummary();
    const issues = classifyHealthIssues(healthSummary, systemReport, {});

    expect(issues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gateway Restart Playbook Tests
// ═══════════════════════════════════════════════════════════════════════════

function makeEventLoopIssue(classification: ClassifiedIssue["classification"]): ClassifiedIssue {
  return {
    key: "system:process.event_loop_delay",
    classification,
    summary: "Event loop severely degraded: p99=3000ms",
    suggestedAction: "Gateway restart recommended",
    source: {
      name: "process.event_loop_delay",
      status: "fail",
      detail: "p99=3000ms",
    },
  };
}

function makeNonEventLoopIssue(): ClassifiedIssue {
  return {
    key: "system:disk.log_directory",
    classification: "auto-fixable",
    summary: "Disk usage high",
    source: {
      name: "disk.log_directory",
      status: "warn",
      detail: "logs at 800MB",
    },
  };
}

function createMockRemediationContext(overrides?: Partial<RemediationContext>): RemediationContext {
  return {
    restartChannel: vi.fn(async () => {}),
    probeChannelHealth: vi.fn(async () => true),
    rotateEventLogs: vi.fn(() => ({ rotated: [], deleted: [] })),
    checkDiskSpaceMB: vi.fn(() => 100),
    requestGatewayRestart: vi.fn(),
    ...overrides,
  };
}

describe("gateway-restart-event-loop playbook", () => {
  it("matches auto-fixable event loop issues", () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.matches(makeEventLoopIssue("auto-fixable"))).toBe(true);
  });

  it("does not match warning event loop issues", () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.matches(makeEventLoopIssue("warning"))).toBe(false);
  });

  it("does not match needs-agent event loop issues", () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.matches(makeEventLoopIssue("needs-agent"))).toBe(false);
  });

  it("does not match non-event-loop issues", () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.matches(makeNonEventLoopIssue())).toBe(false);
  });

  it("does not match if requestGatewayRestart is not available", () => {
    const ctx = createMockRemediationContext({ requestGatewayRestart: undefined });
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.matches(makeEventLoopIssue("auto-fixable"))).toBe(false);
  });

  it("calls requestGatewayRestart on remediation", async () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);
    const issue = makeEventLoopIssue("auto-fixable");

    const result = await playbook.remediate(issue);

    expect(result.status).toBe("success");
    expect(result.playbook).toBe("gateway-restart-event-loop");
    expect(ctx.requestGatewayRestart).toHaveBeenCalledTimes(1);
    expect(ctx.requestGatewayRestart).toHaveBeenCalledWith(
      expect.stringContaining("Event loop degradation auto-fix"),
    );
  });

  it("returns skipped if requestGatewayRestart disappears at remediation time", async () => {
    const ctx = createMockRemediationContext({ requestGatewayRestart: undefined });
    const playbook = createGatewayRestartPlaybook(ctx);
    const issue = makeEventLoopIssue("auto-fixable");

    const result = await playbook.remediate(issue);

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("no restart handler");
  });

  it("returns failed if requestGatewayRestart throws", async () => {
    const ctx = createMockRemediationContext({
      requestGatewayRestart: vi.fn(() => {
        throw new Error("exit refused");
      }),
    });
    const playbook = createGatewayRestartPlaybook(ctx);
    const issue = makeEventLoopIssue("auto-fixable");

    const result = await playbook.remediate(issue);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("exit refused");
  });

  it("verify always returns false (process should be restarting)", async () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);
    const issue = makeEventLoopIssue("auto-fixable");

    const verified = await playbook.verify(issue);

    expect(verified).toBe(false);
  });

  it("has correct playbook id", () => {
    const ctx = createMockRemediationContext();
    const playbook = createGatewayRestartPlaybook(ctx);

    expect(playbook.id).toBe("gateway-restart-event-loop");
  });
});
