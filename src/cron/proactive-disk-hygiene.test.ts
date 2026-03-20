import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveOpenclawDirFromStorePath,
  resolveProactiveIntervalMs,
  resetProactiveDiskHygieneThrottle,
  sweepProactiveDiskHygiene,
} from "./proactive-disk-hygiene.js";
import type { Logger } from "./service/state.js";

function createTestLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("resolveProactiveIntervalMs", () => {
  it("returns 6h default when no config", () => {
    expect(resolveProactiveIntervalMs()).toBe(6 * 60 * 60_000);
  });

  it("returns 6h default when config is empty", () => {
    expect(resolveProactiveIntervalMs({})).toBe(6 * 60 * 60_000);
  });

  it("respects custom interval", () => {
    const config = { diskHygieneIntervalMs: 2 * 60 * 60_000 } as never;
    expect(resolveProactiveIntervalMs(config)).toBe(2 * 60 * 60_000);
  });

  it("enforces minimum of 30 minutes", () => {
    const config = { diskHygieneIntervalMs: 1000 } as never;
    expect(resolveProactiveIntervalMs(config)).toBe(30 * 60_000);
  });
});

describe("deriveOpenclawDirFromStorePath", () => {
  it("derives from standard path", () => {
    const storePath = "/home/user/.openclaw/agents/main/sessions/sessions.json";
    expect(deriveOpenclawDirFromStorePath(storePath)).toBe("/home/user/.openclaw");
  });

  it("returns undefined for non-standard path", () => {
    expect(deriveOpenclawDirFromStorePath("/tmp/random/sessions.json")).toBeUndefined();
  });

  it("returns undefined for empty path", () => {
    expect(deriveOpenclawDirFromStorePath("")).toBeUndefined();
  });
});

describe("sweepProactiveDiskHygiene", () => {
  let tmpDir: string;
  const log = createTestLogger();

  beforeEach(() => {
    resetProactiveDiskHygieneThrottle();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proactive-hygiene-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupOpenclawDir(): { openclawDir: string; storePath: string } {
    const agentsDir = path.join(tmpDir, "agents");
    const sessionsDir = path.join(agentsDir, "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const storePath = path.join(sessionsDir, "sessions.json");
    fs.writeFileSync(storePath, "{}");
    return { openclawDir: tmpDir, storePath };
  }

  function createOldFile(filePath: string, content: string, ageMs: number) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    const pastTime = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, pastTime, pastTime);
  }

  it("runs cleanup on first call with force", async () => {
    const { storePath } = setupOpenclawDir();

    const result = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      log,
      force: true,
    });

    expect(result.swept).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("deletes old session files", async () => {
    const { openclawDir, storePath } = setupOpenclawDir();
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");
    const oldFile = path.join(sessionsDir, "old-cron.jsonl");
    createOldFile(oldFile, "old-content", 31 * 24 * 60 * 60_000);

    const result = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      log,
      force: true,
    });

    expect(result.swept).toBe(true);
    expect(result.result?.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(oldFile)).toBe(false);
  });

  it("preserves recent session files", async () => {
    const { openclawDir, storePath } = setupOpenclawDir();
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");
    const newFile = path.join(sessionsDir, "new-cron.jsonl");
    fs.writeFileSync(newFile, "new-content");

    await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      log,
      force: true,
    });

    expect(fs.existsSync(newFile)).toBe(true);
  });

  it("self-throttles without force", async () => {
    const { storePath } = setupOpenclawDir();
    const now = Date.now();

    const r1 = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      nowMs: now,
      log,
    });
    expect(r1.swept).toBe(true);

    // 1 minute later — should be throttled
    const r2 = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      nowMs: now + 60_000,
      log,
    });
    expect(r2.swept).toBe(false);
  });

  it("runs again after interval expires", async () => {
    const { storePath } = setupOpenclawDir();
    const now = Date.now();

    const r1 = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      nowMs: now,
      log,
    });
    expect(r1.swept).toBe(true);

    // 7 hours later — should run again
    const r2 = await sweepProactiveDiskHygiene({
      sessionStorePaths: [storePath],
      nowMs: now + 7 * 60 * 60_000,
      log,
    });
    expect(r2.swept).toBe(true);
  });

  it("returns swept:false for non-standard store paths", async () => {
    const result = await sweepProactiveDiskHygiene({
      sessionStorePaths: ["/tmp/random/sessions.json"],
      log,
      force: true,
    });

    expect(result.swept).toBe(false);
  });

  it("handles empty store paths array", async () => {
    const result = await sweepProactiveDiskHygiene({
      sessionStorePaths: [],
      log,
      force: true,
    });

    expect(result.swept).toBe(false);
  });
});
