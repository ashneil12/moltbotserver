import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runHealthCheck,
  queryCronHistory,
  detectPersistentFailures,
  detectStaleJobs,
  getModelStatus,
  getUsageDashboard,
} from "./diagnostics-toolkit.js";
import { createEventLogger, type EventLogger } from "./event-log.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let logger: EventLogger;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-test-"));
  logger = createEventLogger({ baseDir: tmpDir });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

describe("runHealthCheck", () => {
  it("returns healthy when no errors and no port configured", async () => {
    const report = await runHealthCheck({ logsDir: tmpDir, eventLogger: logger });
    expect(report.healthy).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.summary.fail).toBe(0);
  });

  it("includes error rate check", async () => {
    for (let i = 0; i < 60; i++) {
      logger.log({ event: "api.error", level: "error", data: { message: "fail" } });
    }
    const report = await runHealthCheck({
      logsDir: tmpDir,
      eventLogger: logger,
      errorThreshold: 50,
    });
    const errorCheck = report.checks.find((c) => c.name === "logs.error_rate");
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.status).toBe("fail");
  });

  it("warns when errors approach threshold", async () => {
    for (let i = 0; i < 30; i++) {
      logger.log({ event: "api.error", level: "error", data: { message: "fail" } });
    }
    const report = await runHealthCheck({
      logsDir: tmpDir,
      eventLogger: logger,
      errorThreshold: 50,
    });
    const errorCheck = report.checks.find((c) => c.name === "logs.error_rate");
    expect(errorCheck!.status).toBe("warn");
  });

  it("includes disk space check", async () => {
    const report = await runHealthCheck({ logsDir: tmpDir, eventLogger: logger });
    const diskCheck = report.checks.find((c) => c.name === "disk.log_directory");
    expect(diskCheck).toBeDefined();
    expect(diskCheck!.status).toBe("pass");
  });

  it("skips PID check when no pidFile configured", async () => {
    const report = await runHealthCheck({ logsDir: tmpDir, eventLogger: logger });
    expect(report.checks.some((c) => c.name === "process.pid_file")).toBe(false);
  });

  it("handles PID file for current process", async () => {
    const pidFile = path.join(tmpDir, "test.pid");
    fs.writeFileSync(pidFile, String(process.pid));
    const report = await runHealthCheck({
      logsDir: tmpDir,
      eventLogger: logger,
      pidFile,
    });
    const pidCheck = report.checks.find((c) => c.name === "process.pid_file");
    expect(pidCheck).toBeDefined();
    expect(pidCheck!.status).toBe("pass");
  });

  it("fails PID check for non-existent process", async () => {
    const pidFile = path.join(tmpDir, "test.pid");
    fs.writeFileSync(pidFile, "999999999"); // unlikely PID
    const report = await runHealthCheck({
      logsDir: tmpDir,
      eventLogger: logger,
      pidFile,
    });
    const pidCheck = report.checks.find((c) => c.name === "process.pid_file");
    expect(pidCheck).toBeDefined();
    expect(pidCheck!.status).toBe("fail");
  });

  it("includes ISO timestamp", async () => {
    const report = await runHealthCheck({ logsDir: tmpDir, eventLogger: logger });
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// Cron Debugger
// ---------------------------------------------------------------------------

describe("queryCronHistory", () => {
  it("returns cron events from the log", () => {
    logger.log({ event: "cron.run", level: "info", data: { jobId: "daily-sync", status: "success" } });
    logger.log({ event: "cron.run", level: "error", data: { jobId: "nightly-report", status: "failed", error: "timeout" } });
    logger.log({ event: "email.received", level: "info", data: {} }); // non-cron

    const history = queryCronHistory(logger);
    expect(history).toHaveLength(2);
    expect(history[0].jobId).toBe("daily-sync");
    expect(history[1].jobId).toBe("nightly-report");
  });

  it("filters by job ID", () => {
    logger.log({ event: "cron.run", level: "info", data: { jobId: "job-a", status: "success" } });
    logger.log({ event: "cron.run", level: "info", data: { jobId: "job-b", status: "success" } });

    const history = queryCronHistory(logger, { jobId: "job-a" });
    expect(history).toHaveLength(1);
    expect(history[0].jobId).toBe("job-a");
  });

  it("filters by status", () => {
    logger.log({ event: "cron.run", level: "info", data: { jobId: "j1", status: "success" } });
    logger.log({ event: "cron.failed", level: "error", data: { jobId: "j2", status: "failed" } });

    const history = queryCronHistory(logger, { status: "failed" });
    expect(history).toHaveLength(1);
    expect(history[0].jobId).toBe("j2");
  });

  it("returns empty array when no cron events exist", () => {
    logger.log({ event: "email.received", level: "info", data: {} });
    const history = queryCronHistory(logger);
    expect(history).toHaveLength(0);
  });
});

describe("detectPersistentFailures", () => {
  it("detects jobs failing 3+ times in window", () => {
    for (let i = 0; i < 4; i++) {
      logger.log({
        event: "cron.failed",
        level: "error",
        data: { jobId: "flaky-job", error: `attempt ${i}` },
      });
    }
    logger.log({
      event: "cron.failed",
      level: "error",
      data: { jobId: "one-off", error: "oops" },
    });

    const failures = detectPersistentFailures(logger, 6, 3);
    expect(failures).toHaveLength(1);
    expect(failures[0].jobId).toBe("flaky-job");
    expect(failures[0].failureCount).toBe(4);
    expect(failures[0].recentErrors.length).toBeGreaterThan(0);
  });

  it("does not flag jobs with fewer failures than threshold", () => {
    logger.log({
      event: "cron.failed",
      level: "error",
      data: { jobId: "ok-job", error: "once" },
    });
    const failures = detectPersistentFailures(logger, 6, 3);
    expect(failures).toHaveLength(0);
  });
});

describe("detectStaleJobs", () => {
  it("detects jobs stuck in running state", () => {
    const oldTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    logger.log({
      event: "cron.started",
      level: "info",
      data: { jobId: "stuck-job", status: "running" },
      timestamp: oldTimestamp,
    });

    const stale = detectStaleJobs(logger, 2 * 60 * 60 * 1000);
    expect(stale).toHaveLength(1);
    expect(stale[0].jobId).toBe("stuck-job");
    expect(stale[0].ageMs).toBeGreaterThan(2 * 60 * 60 * 1000);
  });

  it("does not flag recently started jobs", () => {
    logger.log({
      event: "cron.started",
      level: "info",
      data: { jobId: "new-job", status: "running" },
    });

    const stale = detectStaleJobs(logger, 2 * 60 * 60 * 1000);
    expect(stale).toHaveLength(0);
  });

  it("does not flag completed jobs", () => {
    logger.log({
      event: "cron.completed",
      level: "info",
      data: { jobId: "done-job", status: "success" },
    });
    const stale = detectStaleJobs(logger);
    expect(stale).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Model Diagnostics
// ---------------------------------------------------------------------------

describe("getModelStatus", () => {
  it("identifies the most-used model as active", () => {
    for (let i = 0; i < 5; i++) {
      logger.log({ event: "llm.call", level: "info", data: { model: "claude-opus-4-0520" } });
    }
    for (let i = 0; i < 2; i++) {
      logger.log({ event: "llm.call", level: "info", data: { model: "gpt-4o" } });
    }

    const status = getModelStatus(logger);
    expect(status.activeModel).toBe("claude-opus-4-0520");
    expect(status.fallbackChain).toContain("gpt-4o");
    expect(status.providerStatus).toBe("connected");
  });

  it("returns unknown when no LLM events exist", () => {
    const status = getModelStatus(logger);
    expect(status.activeModel).toBeNull();
    expect(status.providerStatus).toBe("unknown");
  });
});

describe("getUsageDashboard", () => {
  it("aggregates LLM usage by model", () => {
    logger.log({
      event: "llm.call",
      level: "info",
      data: { model: "claude-opus-4-0520", inputTokens: 1000, outputTokens: 500 },
    });
    logger.log({
      event: "llm.call",
      level: "info",
      data: { model: "claude-opus-4-0520", inputTokens: 2000, outputTokens: 800 },
    });
    logger.log({
      event: "llm.call",
      level: "error",
      data: { model: "gpt-4o", error: "rate limit" },
    });

    const dashboard = getUsageDashboard(logger);
    expect(dashboard.totalCalls).toBe(3);
    expect(dashboard.totalErrors).toBe(1);

    const claudeEntry = dashboard.entries.find((e) => e.model === "claude-opus-4-0520");
    expect(claudeEntry).toBeDefined();
    expect(claudeEntry!.callCount).toBe(2);
    expect(claudeEntry!.totalInputTokens).toBe(3000);
    expect(claudeEntry!.totalOutputTokens).toBe(1300);

    const gptEntry = dashboard.entries.find((e) => e.model === "gpt-4o");
    expect(gptEntry).toBeDefined();
    expect(gptEntry!.errorCount).toBe(1);
  });

  it("returns empty dashboard when no LLM events", () => {
    const dashboard = getUsageDashboard(logger);
    expect(dashboard.totalCalls).toBe(0);
    expect(dashboard.entries).toHaveLength(0);
  });
});
