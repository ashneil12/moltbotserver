import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEventLogger,
  getEventHistory,
  getRecentErrors,
  reviewLogs,
  rotateEventLogs,
  type EventLogger,
  type StoredEventEntry,
} from "./event-log.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let logger: EventLogger;

function createTestLogger() {
  return createEventLogger({ baseDir: tmpDir });
}

function readJsonlFile(filePath: string): StoredEventEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function logTestEvent(l: EventLogger, overrides?: Partial<Parameters<EventLogger["log"]>[0]>) {
  l.log({
    event: "test.event",
    level: "info",
    data: { key: "value" },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-log-test-"));
  logger = createTestLogger();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("event-log", () => {
  describe("createEventLogger", () => {
    it("creates the base directory if it does not exist", () => {
      const nested = path.join(tmpDir, "nested", "logs");
      const l = createEventLogger({ baseDir: nested });
      l.log({ event: "test", level: "info", data: {} });
      expect(fs.existsSync(nested)).toBe(true);
    });

    it("writes to per-event JSONL file", () => {
      logTestEvent(logger);
      const entries = readJsonlFile(path.join(tmpDir, "test.event.jsonl"));
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe("test.event");
      expect(entries[0].data.key).toBe("value");
    });

    it("writes to unified all.jsonl stream", () => {
      logTestEvent(logger);
      const entries = readJsonlFile(path.join(tmpDir, "all.jsonl"));
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe("test.event");
    });

    it("writes to both per-event and unified files", () => {
      logTestEvent(logger, { event: "email.received" });
      logTestEvent(logger, { event: "cron.failed" });

      const emailEntries = readJsonlFile(path.join(tmpDir, "email.received.jsonl"));
      const cronEntries = readJsonlFile(path.join(tmpDir, "cron.failed.jsonl"));
      const allEntries = readJsonlFile(path.join(tmpDir, "all.jsonl"));

      expect(emailEntries).toHaveLength(1);
      expect(cronEntries).toHaveLength(1);
      expect(allEntries).toHaveLength(2);
    });

    it("auto-generates ISO timestamp if not provided", () => {
      logTestEvent(logger);
      const entries = readJsonlFile(path.join(tmpDir, "all.jsonl"));
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("uses provided timestamp if given", () => {
      logger.log({
        event: "test",
        level: "info",
        data: {},
        timestamp: "2025-01-15T10:30:00Z",
      });
      const entries = readJsonlFile(path.join(tmpDir, "all.jsonl"));
      expect(entries[0].timestamp).toBe("2025-01-15T10:30:00Z");
    });

    it("includes subsystem if provided", () => {
      logger.log({
        event: "test",
        level: "info",
        data: {},
        subsystem: "email-pipeline",
      });
      const entries = readJsonlFile(path.join(tmpDir, "all.jsonl"));
      expect(entries[0].subsystem).toBe("email-pipeline");
    });

    it("redacts secrets by default", () => {
      logger.log({
        event: "test",
        level: "info",
        data: { token: "sk-1234567890abcdefghijklmn" },
      });
      const raw = fs.readFileSync(path.join(tmpDir, "all.jsonl"), "utf8");
      expect(raw).not.toContain("sk-1234567890abcdefghijklmn");
    });

    it("does not redact when redact=false", () => {
      const l = createEventLogger({ baseDir: tmpDir, redact: false });
      l.log({
        event: "test",
        level: "info",
        data: { token: "sk-1234567890abcdefghijklmn" },
      });
      const raw = fs.readFileSync(path.join(tmpDir, "all.jsonl"), "utf8");
      expect(raw).toContain("sk-1234567890abcdefghijklmn");
    });

    it("sanitizes event names for file paths", () => {
      logger.log({
        event: "email/../../etc/passwd",
        level: "info",
        data: {},
      });
      // Should not create files with path traversal sequences
      const files = fs.readdirSync(tmpDir);
      expect(files.some((f) => f.includes("../"))).toBe(false);
      expect(files.some((f) => f.includes("/"))).toBe(false);
      expect(files.some((f) => f.endsWith(".jsonl"))).toBe(true);
    });

    it("does not throw on write errors", () => {
      const failingWrite = () => {
        throw new Error("disk full");
      };
      const l = createEventLogger({ baseDir: tmpDir, writeFn: failingWrite });
      // Should not throw
      expect(() => l.log({ event: "test", level: "info", data: {} })).not.toThrow();
    });
  });

  describe("query", () => {
    it("returns all entries when no filters", () => {
      logTestEvent(logger);
      logTestEvent(logger, { event: "another.event" });
      const results = logger.query();
      expect(results).toHaveLength(2);
    });

    it("filters by exact event name", () => {
      logTestEvent(logger, { event: "email.received" });
      logTestEvent(logger, { event: "cron.failed" });
      const results = logger.query({ event: "email.received" });
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe("email.received");
    });

    it("filters by event prefix with trailing dot", () => {
      logTestEvent(logger, { event: "email.received" });
      logTestEvent(logger, { event: "email.sent" });
      logTestEvent(logger, { event: "cron.failed" });
      const results = logger.query({ event: "email." });
      expect(results).toHaveLength(2);
    });

    it("filters by minimum level", () => {
      logTestEvent(logger, { level: "debug" });
      logTestEvent(logger, { level: "info" });
      logTestEvent(logger, { level: "warn" });
      logTestEvent(logger, { level: "error" });
      const results = logger.query({ level: "warn" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.level === "warn" || r.level === "error")).toBe(true);
    });

    it("filters by time range", () => {
      logger.log({ event: "old", level: "info", data: {}, timestamp: "2025-01-01T00:00:00Z" });
      logger.log({ event: "new", level: "info", data: {}, timestamp: "2025-06-01T00:00:00Z" });
      const results = logger.query({ since: "2025-03-01T00:00:00Z" });
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe("new");
    });

    it("filters by search substring", () => {
      logTestEvent(logger, { data: { message: "Connection timeout to database" } });
      logTestEvent(logger, { data: { message: "Email sent successfully" } });
      const results = logger.query({ search: "timeout" });
      expect(results).toHaveLength(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        logTestEvent(logger);
      }
      const results = logger.query({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("returns empty array when no log file exists", () => {
      const l = createEventLogger({ baseDir: path.join(tmpDir, "empty") });
      const results = l.query();
      expect(results).toEqual([]);
    });
  });

  describe("getRecentErrors", () => {
    it("returns only error-level entries from recent window", () => {
      logTestEvent(logger, { level: "error", data: { message: "boom" } });
      logTestEvent(logger, { level: "info", data: { message: "ok" } });
      const errors = getRecentErrors(logger, 1);
      expect(errors).toHaveLength(1);
      expect(errors[0].level).toBe("error");
    });
  });

  describe("getEventHistory", () => {
    it("returns entries for a specific event", () => {
      logTestEvent(logger, { event: "cron.success" });
      logTestEvent(logger, { event: "cron.success" });
      logTestEvent(logger, { event: "email.received" });
      const history = getEventHistory(logger, "cron.success");
      expect(history).toHaveLength(2);
    });
  });

  describe("rotateEventLogs", () => {
    it("rotates files exceeding max size", () => {
      // Write enough data to exceed 100 bytes threshold
      const l = createEventLogger({ baseDir: tmpDir });
      for (let i = 0; i < 20; i++) {
        l.log({ event: "big", level: "info", data: { payload: "x".repeat(50) } });
      }
      const result = rotateEventLogs(tmpDir, { maxBytes: 100, keepCount: 2 });
      expect(result.rotated.length).toBeGreaterThan(0);
    });

    it("returns empty results for non-existent directory", () => {
      const result = rotateEventLogs("/tmp/nonexistent-dir-test-12345");
      expect(result.rotated).toEqual([]);
      expect(result.deleted).toEqual([]);
    });

    it("does not rotate small files", () => {
      logTestEvent(logger);
      const result = rotateEventLogs(tmpDir, { maxBytes: DEFAULT_MAX_BYTES });
      expect(result.rotated).toHaveLength(0);
    });
  });

  describe("reviewLogs", () => {
    it("produces a report with error counts", () => {
      logTestEvent(logger, { level: "error", data: { message: "fail 1" } });
      logTestEvent(logger, { level: "error", data: { message: "fail 2" } });
      logTestEvent(logger, { level: "info", data: { message: "ok" } });

      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.errorCount).toBe(2);
      expect(report.warnCount).toBe(0);
      expect(report.totalEntries).toBe(3);
    });

    it("groups errors by event", () => {
      logTestEvent(logger, { event: "cron.failed", level: "error", data: {} });
      logTestEvent(logger, { event: "cron.failed", level: "error", data: {} });
      logTestEvent(logger, { event: "email.error", level: "error", data: {} });

      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.errorsByEvent["cron.failed"]).toBe(2);
      expect(report.errorsByEvent["email.error"]).toBe(1);
    });

    it("finds top repeated errors", () => {
      for (let i = 0; i < 5; i++) {
        logTestEvent(logger, {
          event: "api.error",
          level: "error",
          data: { message: "Connection refused" },
        });
      }
      logTestEvent(logger, {
        event: "api.error",
        level: "error",
        data: { message: "Timeout" },
      });

      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.topErrors[0].message).toContain("Connection refused");
      expect(report.topErrors[0].count).toBe(5);
    });

    it("generates action items for recurring errors", () => {
      for (let i = 0; i < 6; i++) {
        logTestEvent(logger, {
          event: "cron.failed",
          level: "error",
          data: { message: "Job timeout" },
        });
      }

      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.actionItems.length).toBeGreaterThan(0);
      expect(report.actionItems.some((a) => a.includes("cron.failed"))).toBe(true);
    });

    it("reports healthy when no errors", () => {
      logTestEvent(logger, { level: "info", data: {} });
      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.errorCount).toBe(0);
      expect(report.actionItems).toContain("No errors found. All systems healthy.");
    });

    it("groups errors by subsystem", () => {
      logTestEvent(logger, {
        event: "error",
        level: "error",
        data: {},
        subsystem: "email-pipeline",
      });
      logTestEvent(logger, {
        event: "error",
        level: "error",
        data: {},
        subsystem: "cron-service",
      });

      const report = reviewLogs(logger, new Date(Date.now() - 3600_000));
      expect(report.errorsBySubsystem["email-pipeline"]).toBe(1);
      expect(report.errorsBySubsystem["cron-service"]).toBe(1);
    });
  });
});

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
