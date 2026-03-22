/**
 * Health Sentinel — Doctor-derived playbooks + classification tests.
 *
 * Tests for: config-repair playbook, session-lock-cleanup playbook,
 * config.* issue classification, and session_locks issue classification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createConfigRepairPlaybook,
  createSessionLockPlaybook,
  type RemediationContext,
} from "./health-sentinel-playbooks.js";
import { classifyHealthIssues, resetRateLimitStateForTest } from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function baseCtx(): RemediationContext {
  return {
    restartChannel: async () => {},
    probeChannelHealth: async () => false,
    rotateEventLogs: () => ({ rotated: [], deleted: [] }),
    checkDiskSpaceMB: () => 0,
  };
}

function configIssue(status: "fail" | "warn" = "fail") {
  return {
    key: "system:config.missing_token" as const,
    classification: "auto-fixable" as const,
    summary: "Config issue: gateway auth token is missing",
    source: { name: "config.missing_token", status, detail: "gateway auth token is missing" },
  };
}

function sessionLockIssue() {
  return {
    key: "system:process.session_locks" as const,
    classification: "auto-fixable" as const,
    summary: "Stale session locks: 3 stale lock files detected",
    source: {
      name: "process.session_locks",
      status: "fail" as const,
      detail: "3 stale lock files detected",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Config Repair Playbook Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("config-repair playbook", () => {
  it("matches system:config.* issues when auto-fixable and validateConfig is provided", () => {
    const ctx = { ...baseCtx(), validateConfig: async () => ({ valid: true, issues: [] }) };
    const playbook = createConfigRepairPlaybook(ctx);

    expect(playbook.matches(configIssue())).toBe(true);
  });

  it("does not match when validateConfig is not provided", () => {
    const playbook = createConfigRepairPlaybook(baseCtx());

    expect(playbook.matches(configIssue())).toBe(false);
  });

  it("does not match non-config issues", () => {
    const ctx = { ...baseCtx(), validateConfig: async () => ({ valid: true, issues: [] }) };
    const playbook = createConfigRepairPlaybook(ctx);

    expect(
      playbook.matches({
        key: "channel:telegram:default",
        classification: "auto-fixable",
        summary: "test",
        source: { kind: "channel", channelId: "telegram", accountId: "default", reason: "test" },
      }),
    ).toBe(false);
  });

  it("does not match needs-agent classification even for config issues", () => {
    const ctx = { ...baseCtx(), validateConfig: async () => ({ valid: true, issues: [] }) };
    const playbook = createConfigRepairPlaybook(ctx);

    expect(
      playbook.matches({
        ...configIssue(),
        classification: "needs-agent",
      }),
    ).toBe(false);
  });

  it("remediates successfully when config becomes valid", async () => {
    const ctx = { ...baseCtx(), validateConfig: async () => ({ valid: true, issues: [] }) };
    const playbook = createConfigRepairPlaybook(ctx);

    const result = await playbook.remediate(configIssue());

    expect(result.status).toBe("success");
    expect(result.playbook).toBe("doctor-config-repair");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports failure when config validation still has issues", async () => {
    const ctx = {
      ...baseCtx(),
      validateConfig: async () => ({
        valid: false,
        issues: [{ path: "gateway.auth.token", message: "required" }],
      }),
    };
    const playbook = createConfigRepairPlaybook(ctx);

    const result = await playbook.remediate(configIssue());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("1 validation issues remain");
  });

  it("reports failure when validateConfig throws", async () => {
    const ctx = {
      ...baseCtx(),
      validateConfig: async () => {
        throw new Error("config read failed");
      },
    };
    const playbook = createConfigRepairPlaybook(ctx);

    const result = await playbook.remediate(configIssue());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("config read failed");
  });

  it("skips remediation when validateConfig is undefined", async () => {
    const playbook = createConfigRepairPlaybook(baseCtx());

    const result = await playbook.remediate(configIssue());

    expect(result.status).toBe("skipped");
    expect(result.error).toBe("no config validator");
  });

  it("verifies by re-checking config validity", async () => {
    const ctx = { ...baseCtx(), validateConfig: async () => ({ valid: true, issues: [] }) };
    const playbook = createConfigRepairPlaybook(ctx);

    const verified = await playbook.verify(configIssue());

    expect(verified).toBe(true);
  });

  it("fails verification when config still invalid", async () => {
    const ctx = {
      ...baseCtx(),
      validateConfig: async () => ({
        valid: false,
        issues: [{ path: "gateway.mode", message: "unset" }],
      }),
    };
    const playbook = createConfigRepairPlaybook(ctx);

    const verified = await playbook.verify(configIssue());

    expect(verified).toBe(false);
  });

  it("fails verification when validateConfig is undefined", async () => {
    const playbook = createConfigRepairPlaybook(baseCtx());

    const verified = await playbook.verify(configIssue());

    expect(verified).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Session Lock Cleanup Playbook Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("session-lock-cleanup playbook", () => {
  it("matches session_locks issues when auto-fixable and cleanStaleLocks is provided", () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 0, removedCount: 0 }),
    };
    const playbook = createSessionLockPlaybook(ctx);

    expect(playbook.matches(sessionLockIssue())).toBe(true);
  });

  it("does not match when cleanStaleLocks is not provided", () => {
    const playbook = createSessionLockPlaybook(baseCtx());

    expect(playbook.matches(sessionLockIssue())).toBe(false);
  });

  it("does not match non-session-lock issues", () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 0, removedCount: 0 }),
    };
    const playbook = createSessionLockPlaybook(ctx);

    expect(
      playbook.matches({
        key: "system:disk.log_directory",
        classification: "auto-fixable",
        summary: "test",
        source: { name: "disk.log_directory", status: "warn", detail: "test" },
      }),
    ).toBe(false);
  });

  it("remediates successfully when stale locks are removed", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 3, removedCount: 3 }),
    };
    const playbook = createSessionLockPlaybook(ctx);

    const result = await playbook.remediate(sessionLockIssue());

    expect(result.status).toBe("success");
    expect(result.playbook).toBe("doctor-session-lock-cleanup");
  });

  it("remediates successfully even when no stale locks found", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 0, removedCount: 0 }),
    };
    const playbook = createSessionLockPlaybook(ctx);

    const result = await playbook.remediate(sessionLockIssue());

    expect(result.status).toBe("success");
  });

  it("reports failure when cleanStaleLocks throws", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => {
        throw new Error("permission denied");
      },
    };
    const playbook = createSessionLockPlaybook(ctx);

    const result = await playbook.remediate(sessionLockIssue());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("permission denied");
  });

  it("skips remediation when cleanStaleLocks is undefined", async () => {
    const playbook = createSessionLockPlaybook(baseCtx());

    const result = await playbook.remediate(sessionLockIssue());

    expect(result.status).toBe("skipped");
    expect(result.error).toBe("no lock cleanup handler");
  });

  it("verifies by re-counting stale locks (zero = success)", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 0, removedCount: 0 }),
      countStaleLocks: async () => 0,
    };
    const playbook = createSessionLockPlaybook(ctx);

    const verified = await playbook.verify(sessionLockIssue());

    expect(verified).toBe(true);
  });

  it("fails verification when stale locks still exist", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 2, removedCount: 0 }),
      countStaleLocks: async () => 2,
    };
    const playbook = createSessionLockPlaybook(ctx);

    const verified = await playbook.verify(sessionLockIssue());

    expect(verified).toBe(false);
  });

  it("fails verification when countStaleLocks is undefined", async () => {
    const ctx = {
      ...baseCtx(),
      cleanStaleLocks: async () => ({ staleCount: 0, removedCount: 0 }),
    };
    const playbook = createSessionLockPlaybook(ctx);

    const verified = await playbook.verify(sessionLockIssue());

    expect(verified).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue Classification Tests (config.* and process.session_locks)
// ═══════════════════════════════════════════════════════════════════════════

describe("config.* issue classification", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });

  it("classifies config fail status as auto-fixable", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [
          { name: "config.missing_token", status: "fail", detail: "gateway auth token is missing" },
        ],
        summary: { pass: 0, fail: 1, warn: 0, skip: 0 },
      },
    );

    const configIssue = issues.find((i) => i.key === "system:config.missing_token");
    expect(configIssue).toBeDefined();
    expect(configIssue!.classification).toBe("auto-fixable");
    expect(configIssue!.summary).toContain("Config issue:");
    expect(configIssue!.suggestedAction).toContain("openclaw.json");
  });

  it("classifies config warn status as warning", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [
          { name: "config.deprecated_field", status: "warn", detail: "field X is deprecated" },
        ],
        summary: { pass: 0, fail: 0, warn: 1, skip: 0 },
      },
    );

    const configIssue = issues.find((i) => i.key === "system:config.deprecated_field");
    expect(configIssue).toBeDefined();
    expect(configIssue!.classification).toBe("warning");
  });

  it("matches multiple config.* patterns", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [
          { name: "config.auth_mode", status: "fail", detail: "ambiguous auth mode" },
          { name: "config.gateway_mode", status: "warn", detail: "gateway mode unset" },
        ],
        summary: { pass: 0, fail: 1, warn: 1, skip: 0 },
      },
    );

    expect(issues.find((i) => i.key === "system:config.auth_mode")?.classification).toBe(
      "auto-fixable",
    );
    expect(issues.find((i) => i.key === "system:config.gateway_mode")?.classification).toBe(
      "warning",
    );
  });
});

describe("process.session_locks issue classification", () => {
  beforeEach(() => {
    resetRateLimitStateForTest();
  });

  it("classifies session lock issues as auto-fixable", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [{ name: "process.session_locks", status: "fail", detail: "3 stale lock files" }],
        summary: { pass: 0, fail: 1, warn: 0, skip: 0 },
      },
    );

    const lockIssue = issues.find((i) => i.key === "system:process.session_locks");
    expect(lockIssue).toBeDefined();
    expect(lockIssue!.classification).toBe("auto-fixable");
    expect(lockIssue!.summary).toContain("Stale session locks:");
    expect(lockIssue!.suggestedAction).toContain("stale lock files");
  });

  it("classifies warn-level session locks as auto-fixable too", () => {
    const issues = classifyHealthIssues(
      { channels: {} } as unknown as import("../commands/health.js").HealthSummary,
      {
        timestamp: new Date().toISOString(),
        healthy: false,
        checks: [{ name: "process.session_locks", status: "warn", detail: "1 stale lock file" }],
        summary: { pass: 0, fail: 0, warn: 1, skip: 0 },
      },
    );

    const lockIssue = issues.find((i) => i.key === "system:process.session_locks");
    expect(lockIssue).toBeDefined();
    expect(lockIssue!.classification).toBe("auto-fixable");
  });
});
