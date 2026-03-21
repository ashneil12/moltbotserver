import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAutoHealEntry } from "../../cron/auto-heal-journal.js";
import { appendError } from "../../logging/error-journal.js";
import { createAutoHealTool } from "./auto-heal-tool.js";

describe("auto-heal-tool", () => {
  let tmpDir: string;
  let tool: ReturnType<typeof createAutoHealTool>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-heal-tool-test-"));
    tool = createAutoHealTool({ baseDir: tmpDir, workspaceDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper to execute the tool
  async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await tool.execute("test-call-id", params);
    // The tool wraps results in jsonResult — parse the content
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content: Array<{ text: string }> }).content;
      if (content && content.length > 0 && content[0].text) {
        return JSON.parse(content[0].text) as Record<string, unknown>;
      }
    }
    return result as unknown as Record<string, unknown>;
  }

  // Helper to seed an error in the journal
  function seedError(overrides?: Partial<Parameters<typeof appendError>[0]>) {
    const journalPath = path.join(tmpDir, "error-journal.jsonl");
    return appendError({
      journalPath,
      sourceFile: "src/agents/tools/web-fetch.ts",
      errorMessage: "TypeError: Cannot read properties of undefined",
      toolContext: "web_fetch",
      nowMs: Date.now(),
      ...overrides,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tool metadata
  // ─────────────────────────────────────────────────────────────────────

  describe("tool metadata", () => {
    it("has correct name and label", () => {
      expect(tool.name).toBe("auto_heal");
      expect(tool.label).toBe("Auto Heal");
    });

    it("is owner-only", () => {
      expect(tool.ownerOnly).toBe(true);
    });

    it("has description mentioning safety rules", () => {
      expect(tool.description).toContain("SAFETY RULES");
      expect(tool.description).toContain("leaf nodes");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // diagnose action
  // ─────────────────────────────────────────────────────────────────────

  describe("diagnose", () => {
    it("returns healthy state when no errors exist", async () => {
      const result = await exec({ action: "diagnose" });
      expect(result.guidance).toContain("No pending errors");
      expect(result.actionableErrors).toEqual([]);
      expect(result.exhaustedErrors).toEqual([]);
    });

    it("returns actionable errors with scope info", async () => {
      const entry = seedError();

      const result = await exec({ action: "diagnose" });
      const actionable = result.actionableErrors as Array<Record<string, unknown>>;
      expect(actionable.length).toBe(1);
      expect(actionable[0].errorId).toBe(entry.id);
      expect(actionable[0].inScope).toBe(true);
      expect(actionable[0].previousAttempts).toBe(0);
      expect(actionable[0].remainingAttempts).toBe(3);
    });

    it("marks out-of-scope files in diagnose results", async () => {
      seedError({ sourceFile: "src/gateway/server.ts" });

      const result = await exec({ action: "diagnose" });
      const actionable = result.actionableErrors as Array<Record<string, unknown>>;
      expect(actionable.length).toBe(1);
      expect(actionable[0].inScope).toBe(false);
      expect(actionable[0].scopeReason).toBeTruthy();
    });

    it("separates exhausted errors from actionable ones", async () => {
      const entry = seedError();
      const journalPath = path.join(tmpDir, "auto-heal-journal.jsonl");

      // Record 3 failed attempts to exhaust
      for (let i = 1; i <= 3; i++) {
        createAutoHealEntry({
          journalPath,
          errorRef: entry.id,
          targetFile: "src/agents/tools/web-fetch.ts",
          approach: `Approach ${i}`,
          attemptNumber: i,
          backupPath: "web-fetch.ts.bak",
          testCommand: "npx vitest run test.ts",
          testResult: { status: "fail" },
          outcome: "rolled-back",
        });
      }

      const result = await exec({ action: "diagnose" });
      const actionable = result.actionableErrors as unknown[];
      const exhausted = result.exhaustedErrors as Array<Record<string, unknown>>;
      expect(actionable.length).toBe(0);
      expect(exhausted.length).toBe(1);
      expect(exhausted[0].status).toBe("max-attempts-reached");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // attempt-fix action
  // ─────────────────────────────────────────────────────────────────────

  describe("attempt-fix", () => {
    it("throws when mandatory parameters are missing", async () => {
      await expect(
        exec({
          action: "attempt-fix",
          errorRef: "some-ref",
          // missing targetFile, approach, testCommand
        }),
      ).rejects.toThrow(/targetFile required/i);
    });

    it("rejects trunk-node files", async () => {
      const entry = seedError();
      const result = await exec({
        action: "attempt-fix",
        errorRef: entry.id,
        targetFile: "src/security/auth.ts",
        approach: "Fix something",
        testCommand: "npx vitest run test.ts",
        testPassed: true,
      });
      expect(result.error).toBe("scope_violation");
      expect(result.allowed).toBe(false);
    });

    it("records a successful fix and marks error resolved", async () => {
      const entry = seedError();
      const result = await exec({
        action: "attempt-fix",
        errorRef: entry.id,
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Added null check",
        testCommand: "npx vitest run web-fetch.test.ts",
        testPassed: true,
        humanSummary: "Fixed null pointer in response parser",
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("applied");
      expect(result.attemptNumber).toBe(1);
      expect(result.notification).toBeTruthy();

      // Check BACKGROUND_FIXES.md was generated
      const bgFixesPath = path.join(tmpDir, "BACKGROUND_FIXES.md");
      expect(fs.existsSync(bgFixesPath)).toBe(true);
      const content = fs.readFileSync(bgFixesPath, "utf-8");
      expect(content).toContain("Background Fixes");
    });

    it("records a failed fix with remaining attempts count", async () => {
      const entry = seedError();
      const result = await exec({
        action: "attempt-fix",
        errorRef: entry.id,
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Tried wrapping in try/catch",
        testCommand: "npx vitest run web-fetch.test.ts",
        testPassed: false,
        testOutput: "Expected 2, received undefined",
      });

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("rolled-back");
      expect(result.remainingAttempts).toBe(2);
    });

    it("escalates after max attempts are exhausted", async () => {
      const entry = seedError();
      const journalPath = path.join(tmpDir, "auto-heal-journal.jsonl");

      // Exhaust 3 attempts
      for (let i = 1; i <= 3; i++) {
        createAutoHealEntry({
          journalPath,
          errorRef: entry.id,
          targetFile: "src/agents/tools/web-fetch.ts",
          approach: `Approach ${i}`,
          attemptNumber: i,
          backupPath: "web-fetch.ts.bak",
          testCommand: "npx vitest run test.ts",
          testResult: { status: "fail" },
          outcome: "rolled-back",
        });
      }

      // 4th attempt should trigger escalation
      const result = await exec({
        action: "attempt-fix",
        errorRef: entry.id,
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Fourth attempt",
        testCommand: "npx vitest run test.ts",
        testPassed: false,
      });

      expect(result.error).toBe("max_attempts_exceeded");
      expect(result.escalationMessage).toBeTruthy();
      expect(result.escalationOptions).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // rollback action
  // ─────────────────────────────────────────────────────────────────────

  describe("rollback", () => {
    it("throws when targetFile is missing", async () => {
      await expect(exec({ action: "rollback" })).rejects.toThrow(/targetFile required/i);
    });

    it("restores from backup file and removes it", async () => {
      const target = path.join(tmpDir, "target.ts");
      const backup = target + ".bak";

      fs.writeFileSync(target, "broken code", "utf-8");
      fs.writeFileSync(backup, "original code", "utf-8");

      const result = await exec({ action: "rollback", targetFile: target });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(target, "utf-8")).toBe("original code");
      expect(fs.existsSync(backup)).toBe(false);
    });

    it("returns error when no backup exists", async () => {
      const result = await exec({
        action: "rollback",
        targetFile: "/nonexistent/file.ts",
      });
      expect(result.error).toBe("no_backup");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // journal action
  // ─────────────────────────────────────────────────────────────────────

  describe("journal", () => {
    it("returns recent journal entries sorted by timestamp", async () => {
      const journalPath = path.join(tmpDir, "auto-heal-journal.jsonl");

      createAutoHealEntry({
        journalPath,
        errorRef: "e1",
        targetFile: "src/agents/tools/a.ts",
        approach: "Fix A",
        attemptNumber: 1,
        backupPath: "a.ts.bak",
        testCommand: "test",
        testResult: { status: "pass" },
        outcome: "applied",
        nowMs: 1000,
      });

      createAutoHealEntry({
        journalPath,
        errorRef: "e2",
        targetFile: "src/agents/tools/b.ts",
        approach: "Fix B",
        attemptNumber: 1,
        backupPath: "b.ts.bak",
        testCommand: "test",
        testResult: { status: "fail" },
        outcome: "rolled-back",
        nowMs: 2000,
      });

      const result = await exec({ action: "journal" });
      const entries = result.entries as Array<Record<string, unknown>>;
      expect(entries.length).toBe(2);
      // Newest first
      expect(entries[0].targetFile).toBe("b.ts");
      expect(entries[1].targetFile).toBe("a.ts");
    });

    it("respects limit parameter", async () => {
      const journalPath = path.join(tmpDir, "auto-heal-journal.jsonl");

      for (let i = 0; i < 5; i++) {
        createAutoHealEntry({
          journalPath,
          errorRef: `e${i}`,
          targetFile: `src/agents/tools/file${i}.ts`,
          approach: `Fix ${i}`,
          attemptNumber: 1,
          backupPath: `file${i}.ts.bak`,
          testCommand: "test",
          testResult: { status: "pass" },
          outcome: "applied",
          nowMs: 1000 + i * 100,
        });
      }

      const result = await exec({ action: "journal", limit: 2 });
      const entries = result.entries as unknown[];
      expect(entries.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // status action
  // ─────────────────────────────────────────────────────────────────────

  describe("status", () => {
    it("returns healthy state when no errors", async () => {
      const result = await exec({ action: "status" });
      expect(result.healthy).toBe(true);
      expect(result.successRate).toBe("100%");
      expect(result.message).toContain("No pending errors");
    });

    it("returns pending error counts", async () => {
      seedError();
      const result = await exec({ action: "status" });
      expect(result.healthy).toBe(false);
      const errorJournal = result.errorJournal as Record<string, number>;
      expect(errorJournal.pending).toBe(1);
      expect(result.message).toContain("pending auto-heal");
    });

    it("calculates success rate correctly", async () => {
      const journalPath = path.join(tmpDir, "auto-heal-journal.jsonl");

      // 2 applied, 1 rolled-back
      createAutoHealEntry({
        journalPath,
        errorRef: "e1",
        targetFile: "src/agents/tools/a.ts",
        approach: "Fix A",
        attemptNumber: 1,
        backupPath: "a.ts.bak",
        testCommand: "test",
        testResult: { status: "pass" },
        outcome: "applied",
      });
      createAutoHealEntry({
        journalPath,
        errorRef: "e2",
        targetFile: "src/agents/tools/b.ts",
        approach: "Fix B",
        attemptNumber: 1,
        backupPath: "b.ts.bak",
        testCommand: "test",
        testResult: { status: "pass" },
        outcome: "applied",
      });
      createAutoHealEntry({
        journalPath,
        errorRef: "e3",
        targetFile: "src/agents/tools/c.ts",
        approach: "Fix C",
        attemptNumber: 1,
        backupPath: "c.ts.bak",
        testCommand: "test",
        testResult: { status: "fail" },
        outcome: "rolled-back",
      });

      const result = await exec({ action: "status" });
      expect(result.successRate).toBe("67%");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // unknown action
  // ─────────────────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns error for unknown action", async () => {
      const result = await exec({ action: "nonexistent" });
      expect(result.error).toContain("Unknown action");
    });
  });
});
