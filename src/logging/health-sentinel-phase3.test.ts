/**
 * Health Sentinel — Phase 3 tests.
 *
 * Tests for: incident file writing, inbox summaries, TTL cleanup,
 * weekly probe gating, and history pruning.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRecentReports } from "./health-sentinel-history.js";
import {
  writeIncidentFiles,
  writeInboxSummary,
  cleanupOldFiles,
  cleanupOldHistory,
} from "./health-sentinel-incidents.js";
import type { SentinelReport, ClassifiedIssue, SentinelDeps } from "./health-sentinel-types.js";
import { runSentinelCheck, resetRateLimitStateForTest } from "./health-sentinel.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-p3-test-"));
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

function makeIssue(overrides?: Partial<ClassifiedIssue>): ClassifiedIssue {
  return {
    key: "system:gateway.port",
    classification: "needs-agent",
    summary: "Gateway port unreachable",
    suggestedAction: "Check if the gateway process is running.",
    source: { name: "gateway.port", status: "fail" as const, detail: "Port unreachable" },
    ...overrides,
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
// Incident file tests
// ═══════════════════════════════════════════════════════════════════════════

describe("writeIncidentFiles", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("writes no files when not escalated", () => {
    const report = makeReport({ escalatedToAgent: false });
    const files = writeIncidentFiles(report, tmpDir);
    expect(files).toEqual([]);
  });

  it("writes markdown incident files for escalated issues", () => {
    const report = makeReport({
      escalatedToAgent: true,
      issues: [
        makeIssue({ key: "system:gateway.port" }),
        makeIssue({ key: "channel:telegram:default", classification: "auto-fixable" }),
      ],
    });
    const files = writeIncidentFiles(report, tmpDir);
    expect(files).toHaveLength(2);

    // Check files exist and contain expected content
    for (const f of files) {
      expect(fs.existsSync(f)).toBe(true);
      const content = fs.readFileSync(f, "utf8");
      expect(content).toContain("# Incident:");
      expect(content).toContain("## Evidence");
      expect(content).toContain("## Repair Attempted");
      expect(content).toContain("## Current Status");
    }
  });

  it("includes remediation details in incident file", () => {
    const report = makeReport({
      escalatedToAgent: true,
      issues: [makeIssue()],
      remediations: [
        {
          issueKey: "system:gateway.port",
          playbook: "channel-restart",
          status: "failed",
          error: "connection refused",
          durationMs: 1500,
        },
      ],
    });
    const files = writeIncidentFiles(report, tmpDir);
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(files[0], "utf8");
    expect(content).toContain("channel-restart");
    expect(content).toContain("connection refused");
    expect(content).toContain("1500ms");
  });

  it("sanitizes issue keys in filenames", () => {
    const report = makeReport({
      escalatedToAgent: true,
      issues: [makeIssue({ key: "channel:telegram:user/special" })],
    });
    const files = writeIncidentFiles(report, tmpDir);
    expect(files).toHaveLength(1);
    const basename = path.basename(files[0]);
    expect(basename).not.toContain("/");
    expect(basename).not.toContain(":");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inbox summary tests
// ═══════════════════════════════════════════════════════════════════════════

describe("writeInboxSummary", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("writes healthy inbox summary", () => {
    const report = makeReport({ healthy: true });
    const filePath = writeInboxSummary(report, null, tmpDir);
    expect(filePath).not.toBeNull();
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain("# Sentinel Inbox");
    expect(content).toContain("✅ Healthy");
  });

  it("includes repaired items", () => {
    const report = makeReport({
      healthy: true,
      remediations: [
        {
          issueKey: "system:disk.log_directory",
          playbook: "disk-cleanup",
          status: "success",
          verified: true,
          durationMs: 200,
        },
      ],
    });
    const filePath = writeInboxSummary(report, null, tmpDir);
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain("🔧 Repaired");
    expect(content).toContain("disk-cleanup");
  });

  it("includes incidents", () => {
    const report = makeReport({
      healthy: false,
      issues: [makeIssue({ classification: "needs-agent" })],
      escalatedToAgent: true,
    });
    const filePath = writeInboxSummary(report, null, tmpDir);
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain("🚨 Incidents");
  });

  it("includes trend context", () => {
    const report = makeReport();
    const trends = {
      persistent: ["channel:tg"],
      flapping: [],
      improving: ["system:disk"],
    };
    const filePath = writeInboxSummary(report, trends, tmpDir);
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain("📊 Trends");
    expect(content).toContain("Persistent: channel:tg");
    expect(content).toContain("Improving: system:disk");
  });

  it("includes rate limiting info", () => {
    const report = makeReport({ suppressedByRateLimit: 3 });
    const filePath = writeInboxSummary(report, null, tmpDir);
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain("🕐 Rate Limited");
    expect(content).toContain("3 remediation(s) suppressed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TTL cleanup tests
// ═══════════════════════════════════════════════════════════════════════════

describe("cleanupOldFiles", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("deletes files older than maxAgeDays", () => {
    const dir = path.join(tmpDir, "incidents");
    fs.mkdirSync(dir, { recursive: true });

    // Create a file and backdate it
    const oldFile = path.join(dir, "old.md");
    fs.writeFileSync(oldFile, "old incident");
    // Set mtime to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    // Create a recent file
    const newFile = path.join(dir, "new.md");
    fs.writeFileSync(newFile, "new incident");

    const deleted = cleanupOldFiles(dir, 7);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain("old.md");
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it("returns empty array for non-existent directory", () => {
    const deleted = cleanupOldFiles(path.join(tmpDir, "nonexistent"), 7);
    expect(deleted).toEqual([]);
  });
});

describe("cleanupOldHistory", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("prunes old entries from JSONL", () => {
    // Append some entries with old timestamps
    const filePath = path.join(tmpDir, "sentinel-history.jsonl");
    const oldEntry = JSON.stringify({
      timestamp: new Date(Date.now() - 20 * 24 * 60 * 60_000).toISOString(),
      healthy: true,
      issueKeys: [],
      remediationCount: 0,
      escalated: false,
    });
    const newEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      healthy: true,
      issueKeys: [],
      remediationCount: 0,
      escalated: false,
    });
    fs.writeFileSync(filePath, `${oldEntry}\n${newEntry}\n`);

    const pruned = cleanupOldHistory(tmpDir, 14);
    expect(pruned).toBe(1);

    // Verify only the new entry remains
    const remaining = getRecentReports(tmpDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].healthy).toBe(true);
  });

  it("returns 0 for non-existent file", () => {
    const pruned = cleanupOldHistory(tmpDir, 14);
    expect(pruned).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Weekly probe gating tests
// ═══════════════════════════════════════════════════════════════════════════

describe("weekly probe gating", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
    resetRateLimitStateForTest();
  });

  it("runs weekly probes on first sentinel check", async () => {
    let backupProbeCalled = false;
    await runSentinelCheck(
      makeDeps({
        stateDir: tmpDir,
        weeklyProbes: {
          checkBackupFreshness: () => {
            backupProbeCalled = true;
            return {
              name: "weekly.backup_freshness",
              status: "pass" as const,
              detail: "Config backup is 2 days old",
            };
          },
        },
      }),
    );

    expect(backupProbeCalled).toBe(true);
  });

  it("does NOT re-run weekly probes within the same week", async () => {
    let callCount = 0;
    const deps = makeDeps({
      stateDir: tmpDir,
      weeklyProbes: {
        checkBackupFreshness: () => {
          callCount++;
          return {
            name: "weekly.backup_freshness",
            status: "pass" as const,
            detail: "ok",
          };
        },
      },
    });

    await runSentinelCheck(deps);
    await runSentinelCheck(deps);
    await runSentinelCheck(deps);

    // Should only have been called once
    expect(callCount).toBe(1);
  });

  it("includes weekly probe issues in classification", async () => {
    const report = await runSentinelCheck(
      makeDeps({
        stateDir: tmpDir,
        weeklyProbes: {
          checkBackupFreshness: () => ({
            name: "weekly.backup_freshness",
            status: "warn" as const,
            detail: "Config backup is 15 days old",
          }),
        },
      }),
    );

    const backupIssue = report.issues.find((i) => i.key === "system:weekly.backup_freshness");
    expect(backupIssue).toBeDefined();
    expect(backupIssue!.classification).toBe("warning");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: inbox written after sentinel run
// ═══════════════════════════════════════════════════════════════════════════

describe("sentinel integration — inbox + cleanup", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetRateLimitStateForTest();
  });
  afterEach(() => {
    cleanTmpDir(tmpDir);
    resetRateLimitStateForTest();
  });

  it("writes inbox summary after healthy run", async () => {
    await runSentinelCheck(makeDeps({ stateDir: tmpDir }));

    const inboxDir = path.join(tmpDir, "inbox");
    expect(fs.existsSync(inboxDir)).toBe(true);
    const files = fs.readdirSync(inboxDir);
    expect(files.length).toBeGreaterThanOrEqual(1);

    const content = fs.readFileSync(path.join(inboxDir, files[0]), "utf8");
    expect(content).toContain("Sentinel Inbox");
  });

  it("writes inbox + incident files on escalation", async () => {
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

    // Inbox should exist
    const inboxDir = path.join(tmpDir, "inbox");
    expect(fs.existsSync(inboxDir)).toBe(true);

    // Incidents should exist
    const incidentsDir = path.join(tmpDir, "incidents");
    expect(fs.existsSync(incidentsDir)).toBe(true);
    const incidentFiles = fs.readdirSync(incidentsDir);
    expect(incidentFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("runs TTL cleanup on each cycle", async () => {
    // Pre-create an old incident file
    const incidentsDir = path.join(tmpDir, "incidents");
    fs.mkdirSync(incidentsDir, { recursive: true });
    const oldFile = path.join(incidentsDir, "old-incident.md");
    fs.writeFileSync(oldFile, "old");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    // Run sentinel — should clean up the old file
    await runSentinelCheck(makeDeps({ stateDir: tmpDir }));

    expect(fs.existsSync(oldFile)).toBe(false);
  });
});
