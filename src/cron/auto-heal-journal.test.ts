import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveAutoHealJournalPath,
  resolveBackgroundFixesPath,
  checkFileScope,
  createAutoHealEntry,
  countAttempts,
  isMaxAttemptsReached,
  getMaxAttempts,
  readAllEntries,
  pruneOldEntries,
  generateBackgroundFixesMd,
} from "./auto-heal-journal.js";

describe("auto-heal-journal", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-heal-journal-test-"));
    journalPath = resolveAutoHealJournalPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveAutoHealJournalPath", () => {
    it("uses baseDir when provided", () => {
      expect(resolveAutoHealJournalPath("/custom")).toBe("/custom/auto-heal-journal.jsonl");
    });

    it("falls back to default path", () => {
      const result = resolveAutoHealJournalPath();
      expect(result).toContain("auto-heal-journal.jsonl");
    });
  });

  describe("resolveBackgroundFixesPath", () => {
    it("places BACKGROUND_FIXES.md in workspace root", () => {
      expect(resolveBackgroundFixesPath("/workspace")).toBe("/workspace/BACKGROUND_FIXES.md");
    });
  });

  describe("checkFileScope", () => {
    it("allows files in src/agents/tools/", () => {
      const result = checkFileScope("src/agents/tools/web-fetch.ts");
      expect(result.allowed).toBe(true);
    });

    it("allows files in skills/", () => {
      const result = checkFileScope("skills/auto-heal/SKILL.md");
      expect(result.allowed).toBe(true);
    });

    it("allows files in src/utils/", () => {
      const result = checkFileScope("src/utils/helper.ts");
      expect(result.allowed).toBe(true);
    });

    it("allows files in src/cron/", () => {
      const result = checkFileScope("src/cron/remediation-journal.ts");
      expect(result.allowed).toBe(true);
    });

    it("rejects system-prompt.ts (trunk node)", () => {
      const result = checkFileScope("src/agents/system-prompt.ts");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("trunk-node");
    });

    it("rejects security files (trunk node)", () => {
      const result = checkFileScope("src/security/auth.ts");
      expect(result.allowed).toBe(false);
    });

    it("rejects package.json (trunk node)", () => {
      const result = checkFileScope("package.json");
      expect(result.allowed).toBe(false);
    });

    it("rejects Dockerfile (trunk node)", () => {
      const result = checkFileScope("Dockerfile");
      expect(result.allowed).toBe(false);
    });

    it("rejects pi-embedded-runner (trunk node)", () => {
      const result = checkFileScope("src/agents/pi-embedded-runner.ts");
      expect(result.allowed).toBe(false);
    });

    it("rejects files not in any leaf scope", () => {
      const result = checkFileScope("src/gateway/call.ts");
      expect(result.allowed).toBe(false);
    });
  });

  describe("createAutoHealEntry", () => {
    it("creates entry with correct fields", () => {
      const entry = createAutoHealEntry({
        journalPath,
        errorRef: "error-123",
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Fix null check on response.split()",
        attemptNumber: 1,
        backupPath: "src/agents/tools/web-fetch.ts.bak",
        testCommand: "npx vitest run src/agents/tools/web-fetch.test.ts",
        testResult: { status: "pass", durationMs: 1500 },
        outcome: "applied",
        humanSummary: "Fixed a null check in the web scraper",
        nowMs: 5000,
      });

      expect(entry.id).toBeTruthy();
      expect(entry.errorRef).toBe("error-123");
      expect(entry.targetFile).toBe("src/agents/tools/web-fetch.ts");
      expect(entry.attemptNumber).toBe(1);
      expect(entry.outcome).toBe("applied");
      expect(entry.actor).toBe("auto-heal-subagent");
    });

    it("persists to journal file", () => {
      createAutoHealEntry({
        journalPath,
        errorRef: "error-123",
        targetFile: "src/agents/tools/test.ts",
        approach: "Fix thing",
        attemptNumber: 1,
        backupPath: "src/agents/tools/test.ts.bak",
        testCommand: "npx vitest run test.ts",
        testResult: { status: "pass" },
        outcome: "applied",
      });

      const entries = readAllEntries(journalPath);
      expect(entries.length).toBe(1);
    });
  });

  describe("countAttempts / isMaxAttemptsReached", () => {
    it("counts attempts for an error reference", () => {
      for (let i = 1; i <= 3; i++) {
        createAutoHealEntry({
          journalPath,
          errorRef: "error-abc",
          targetFile: "src/agents/tools/test.ts",
          approach: `Approach ${i}`,
          attemptNumber: i,
          backupPath: "test.ts.bak",
          testCommand: "npx vitest run test.ts",
          testResult: { status: "fail" },
          outcome: "rolled-back",
        });
      }

      expect(countAttempts(journalPath, "error-abc")).toBe(3);
      expect(isMaxAttemptsReached(journalPath, "error-abc")).toBe(true);
    });

    it("returns 0 for unknown error ref", () => {
      expect(countAttempts(journalPath, "nonexistent")).toBe(0);
      expect(isMaxAttemptsReached(journalPath, "nonexistent")).toBe(false);
    });

    it("getMaxAttempts returns 3", () => {
      expect(getMaxAttempts()).toBe(3);
    });
  });

  describe("pruneOldEntries", () => {
    it("prunes entries older than retention period", () => {
      const nowMs = Date.now();
      const oldMs = nowMs - 40 * 24 * 60 * 60_000;

      createAutoHealEntry({
        journalPath,
        errorRef: "old",
        targetFile: "old.ts",
        approach: "old fix",
        attemptNumber: 1,
        backupPath: "old.ts.bak",
        testCommand: "test",
        testResult: { status: "pass" },
        outcome: "applied",
        nowMs: oldMs,
      });

      createAutoHealEntry({
        journalPath,
        errorRef: "new",
        targetFile: "new.ts",
        approach: "new fix",
        attemptNumber: 1,
        backupPath: "new.ts.bak",
        testCommand: "test",
        testResult: { status: "pass" },
        outcome: "applied",
        nowMs,
      });

      const pruned = pruneOldEntries(journalPath, 30, nowMs);
      expect(pruned).toBe(1);
      expect(readAllEntries(journalPath).length).toBe(1);
    });
  });

  describe("generateBackgroundFixesMd", () => {
    it("generates BACKGROUND_FIXES.md with entries", () => {
      const outputPath = path.join(tmpDir, "BACKGROUND_FIXES.md");
      const nowMs = Date.now();

      createAutoHealEntry({
        journalPath,
        errorRef: "e1",
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Fix null check on response.split()",
        attemptNumber: 1,
        backupPath: "web-fetch.ts.bak",
        testCommand: "npx vitest run web-fetch.test.ts",
        testResult: { status: "pass", durationMs: 1500 },
        outcome: "applied",
        humanSummary: "Fixed a null check in the web scraper",
        nowMs,
      });

      createAutoHealEntry({
        journalPath,
        errorRef: "e2",
        targetFile: "src/agents/tools/cron-tool.ts",
        approach: "Handle missing schedule field",
        attemptNumber: 1,
        backupPath: "cron-tool.ts.bak",
        testCommand: "npx vitest run cron-tool.test.ts",
        testResult: { status: "fail", output: "Expected object" },
        outcome: "rolled-back",
        rollbackReason: "Test verification failed",
        nowMs,
      });

      generateBackgroundFixesMd({ journalPath, outputPath, nowMs });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("# Background Fixes");
      expect(content).toContain("web-fetch.ts");
      expect(content).toContain("cron-tool.ts");
      expect(content).toContain("Fixes Applied");
      expect(content).toContain("Rolled Back");
      expect(content).toContain("Fixed a null check in the web scraper");
    });

    it("generates empty state message when no entries", () => {
      const outputPath = path.join(tmpDir, "BACKGROUND_FIXES.md");
      generateBackgroundFixesMd({ journalPath, outputPath });

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("No background fixes");
    });
  });
});
