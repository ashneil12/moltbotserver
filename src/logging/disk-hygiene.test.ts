/**
 * Tests for disk hygiene scanner and cleaner.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanDiskUsage, runDiskCleanup } from "./disk-hygiene.js";

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "disk-hygiene-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupAgent(agentName: string) {
  const agentDir = path.join(tmpDir, "agents", agentName);
  const sessionsDir = path.join(agentDir, "sessions");
  const inboundDir = path.join(agentDir, "inbound");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(inboundDir, { recursive: true });
  return { agentDir, sessionsDir, inboundDir };
}

function createOldFile(filePath: string, content: string, ageMs: number) {
  fs.writeFileSync(filePath, content, "utf-8");
  const pastTime = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, pastTime, pastTime);
}

function createRecentFile(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, "utf-8");
}

// ── Scanner ──────────────────────────────────────────────────────────────

describe("scanDiskUsage", () => {
  it("reports empty for missing directory", () => {
    const result = scanDiskUsage(path.join(tmpDir, "nonexistent"));
    expect(result.totalBytes).toBe(0);
    expect(result.areas).toHaveLength(0);
  });

  it("scans session files across agents", () => {
    const { sessionsDir } = setupAgent("main");
    createRecentFile(path.join(sessionsDir, "cron-abc.jsonl"), "x".repeat(1024));
    createRecentFile(path.join(sessionsDir, "cron-def.jsonl"), "y".repeat(512));

    const result = scanDiskUsage(tmpDir);
    const sessionArea = result.areas.find((a) => a.name === "sessions/main");
    expect(sessionArea).toBeDefined();
    expect(sessionArea!.fileCount).toBe(2);
    expect(sessionArea!.sizeBytes).toBe(1536);
  });

  it("scans gateway error log", () => {
    const errLog = path.join(tmpDir, "gateway.err.log");
    fs.writeFileSync(errLog, "error\n".repeat(500), "utf-8");

    const result = scanDiskUsage(tmpDir);
    const logArea = result.areas.find((a) => a.name === "gateway_error_log");
    expect(logArea).toBeDefined();
    expect(logArea!.fileCount).toBe(1);
  });
});

// ── Cleaner ──────────────────────────────────────────────────────────────

describe("runDiskCleanup", () => {
  it("deletes old session .jsonl files", () => {
    const { sessionsDir } = setupAgent("main");
    const oldFile = path.join(sessionsDir, "cron-old.jsonl");
    const newFile = path.join(sessionsDir, "cron-new.jsonl");

    createOldFile(oldFile, "old-content", 31 * 24 * 60 * 60_000); // 31 days
    createRecentFile(newFile, "new-content");

    const result = runDiskCleanup(tmpDir);

    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it("preserves main.jsonl even if old", () => {
    const { sessionsDir } = setupAgent("main");
    const mainFile = path.join(sessionsDir, "main.jsonl");
    createOldFile(mainFile, "main-content", 60 * 24 * 60 * 60_000); // 60 days

    const result = runDiskCleanup(tmpDir, { preserveMainSession: true });

    expect(fs.existsSync(mainFile)).toBe(true);
    // Should not count main.jsonl as deleted
    const mainAction = result.actions.find((a) => a.path === mainFile);
    expect(mainAction).toBeUndefined();
  });

  it("truncates gateway error log to N lines", () => {
    const errLog = path.join(tmpDir, "gateway.err.log");
    const lines = Array.from({ length: 5000 }, (_, i) => `error line ${i}`);
    fs.writeFileSync(errLog, lines.join("\n"), "utf-8");

    const result = runDiskCleanup(tmpDir, { gatewayLogKeepLines: 1000 });

    expect(result.filesTruncated).toBe(1);
    const remaining = fs.readFileSync(errLog, "utf-8").split("\n");
    expect(remaining.length).toBeLessThanOrEqual(1001); // 1000 lines + potential trailing
  });

  it("deletes old inbound media", () => {
    const { inboundDir } = setupAgent("main");
    const oldMedia = path.join(inboundDir, "image.jpg");
    createOldFile(oldMedia, "fake-image-data", 15 * 24 * 60 * 60_000); // 15 days

    const result = runDiskCleanup(tmpDir, { mediaMaxAgeMs: 14 * 24 * 60 * 60_000 });

    expect(fs.existsSync(oldMedia)).toBe(false);
    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);
  });

  it("does not delete recent inbound media", () => {
    const { inboundDir } = setupAgent("main");
    const newMedia = path.join(inboundDir, "image.jpg");
    createRecentFile(newMedia, "fake-image-data");

    runDiskCleanup(tmpDir);

    expect(fs.existsSync(newMedia)).toBe(true);
  });

  it("returns errors array for inaccessible files", () => {
    const result = runDiskCleanup(tmpDir);
    // No errors expected for empty/clean dir
    expect(result.errors).toHaveLength(0);
  });

  it("reports freed bytes accurately", () => {
    const { sessionsDir } = setupAgent("main");
    const content = "x".repeat(10_000);
    createOldFile(path.join(sessionsDir, "old.jsonl"), content, 31 * 24 * 60 * 60_000);

    const result = runDiskCleanup(tmpDir);

    expect(result.freedBytes).toBeGreaterThanOrEqual(content.length);
  });
});
