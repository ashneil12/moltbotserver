import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveErrorJournalPath,
  appendError,
  readAllEntries,
  readPendingErrors,
  markError,
  pruneOldErrors,
  getErrorJournalSummary,
  classifyErrorSeverity,
  errorDeduplicationKey,
} from "./error-journal.js";

describe("error-journal", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "error-journal-test-"));
    journalPath = resolveErrorJournalPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveErrorJournalPath", () => {
    it("uses baseDir when provided", () => {
      const result = resolveErrorJournalPath("/custom/dir");
      expect(result).toBe("/custom/dir/error-journal.jsonl");
    });

    it("falls back to ~/.openclaw/auto-heal/ when no baseDir", () => {
      const result = resolveErrorJournalPath();
      expect(result).toContain("auto-heal");
      expect(result).toContain("error-journal.jsonl");
    });
  });

  describe("appendError", () => {
    it("creates a new entry with correct fields", () => {
      const entry = appendError({
        journalPath,
        sourceFile: "src/agents/tools/web-fetch.ts",
        errorMessage: "TypeError: Cannot read properties of undefined",
        stackTrace: "at line 42",
        toolContext: "web_fetch",
        nowMs: 1000,
      });

      expect(entry.id).toBeTruthy();
      expect(entry.sourceFile).toBe("src/agents/tools/web-fetch.ts");
      expect(entry.errorMessage).toBe("TypeError: Cannot read properties of undefined");
      expect(entry.stackTrace).toBe("at line 42");
      expect(entry.toolContext).toBe("web_fetch");
      expect(entry.status).toBe("pending");
      expect(entry.occurrenceCount).toBe(1);
      expect(entry.severity).toBe("medium"); // tool error → medium
    });

    it("deduplicates matching errors by bumping occurrence count", () => {
      const entry1 = appendError({
        journalPath,
        sourceFile: "src/agents/tools/web-fetch.ts",
        errorMessage: "TypeError: Cannot read properties of undefined",
        nowMs: 1000,
      });

      const entry2 = appendError({
        journalPath,
        sourceFile: "src/agents/tools/web-fetch.ts",
        errorMessage: "TypeError: Cannot read properties of undefined",
        nowMs: 2000,
      });

      expect(entry2.id).toBe(entry1.id);
      expect(entry2.occurrenceCount).toBe(2);
      expect(entry2.lastSeenAt).toBe(2000);

      // Only one entry in the journal
      const all = readAllEntries(journalPath);
      expect(all.length).toBe(1);
    });

    it("does not deduplicate different errors", () => {
      appendError({
        journalPath,
        sourceFile: "src/agents/tools/web-fetch.ts",
        errorMessage: "TypeError: Cannot read properties of undefined",
        nowMs: 1000,
      });

      appendError({
        journalPath,
        sourceFile: "src/agents/tools/cron-tool.ts",
        errorMessage: "ECONNREFUSED 127.0.0.1:3000",
        nowMs: 2000,
      });

      const all = readAllEntries(journalPath);
      expect(all.length).toBe(2);
    });

    it("auto-escalates severity for recurring errors", () => {
      // Append same error 5 times to trigger severity escalation
      let entry;
      for (let i = 0; i < 5; i++) {
        entry = appendError({
          journalPath,
          sourceFile: "src/utils/helper.ts",
          errorMessage: "Minor parsing issue",
          nowMs: 1000 + i * 100,
        });
      }

      expect(entry.occurrenceCount).toBe(5);
      // Low → Medium at 3, Medium → High at 5
      expect(entry.severity).toBe("high");
    });
  });

  describe("classifyErrorSeverity", () => {
    it("classifies security errors as critical", () => {
      expect(
        classifyErrorSeverity({
          errorMessage: "Unauthorized access attempt",
          sourceFile: "src/security/auth.ts",
        }),
      ).toBe("critical");
    });

    it("classifies tool errors as medium", () => {
      expect(
        classifyErrorSeverity({
          errorMessage: "Connection timeout",
          sourceFile: "src/agents/tools/web-fetch.ts",
        }),
      ).toBe("medium");
    });

    it("classifies recurring errors as high", () => {
      expect(
        classifyErrorSeverity({
          errorMessage: "Some error",
          sourceFile: "src/utils/helper.ts",
          occurrenceCount: 3,
        }),
      ).toBe("high");
    });

    it("defaults to low for generic errors", () => {
      expect(
        classifyErrorSeverity({
          errorMessage: "Something went wrong",
          sourceFile: "src/random/file.ts",
        }),
      ).toBe("low");
    });
  });

  describe("errorDeduplicationKey", () => {
    it("normalizes dynamic content for dedup", () => {
      const key1 = errorDeduplicationKey(
        "Error at line 42 col 10: timeout after 30000ms",
        "src/tools/fetch.ts",
      );
      const key2 = errorDeduplicationKey(
        "Error at line 99 col 5: timeout after 60000ms",
        "src/tools/fetch.ts",
      );
      expect(key1).toBe(key2);
    });

    it("differentiates truly different errors", () => {
      const key1 = errorDeduplicationKey("TypeError: undefined", "src/tools/fetch.ts");
      const key2 = errorDeduplicationKey("RangeError: overflow", "src/tools/fetch.ts");
      expect(key1).not.toBe(key2);
    });
  });

  describe("markError", () => {
    it("updates error status", () => {
      const entry = appendError({
        journalPath,
        sourceFile: "src/tools/test.ts",
        errorMessage: "Test error",
        nowMs: 1000,
      });

      const success = markError(journalPath, entry.id, "resolved", {
        resolvedByRef: "heal-123",
        resolutionSummary: "Fixed the parser",
      });

      expect(success).toBe(true);

      const all = readAllEntries(journalPath);
      expect(all[0].status).toBe("resolved");
      expect(all[0].resolvedByRef).toBe("heal-123");
      expect(all[0].resolutionSummary).toBe("Fixed the parser");
    });

    it("returns false for unknown entry ID", () => {
      const success = markError(journalPath, "nonexistent", "resolved");
      expect(success).toBe(false);
    });
  });

  describe("readPendingErrors", () => {
    it("returns only pending errors", () => {
      const e1 = appendError({
        journalPath,
        sourceFile: "src/tools/a.ts",
        errorMessage: "Error A",
        nowMs: 1000,
      });
      appendError({
        journalPath,
        sourceFile: "src/tools/b.ts",
        errorMessage: "Error B",
        nowMs: 2000,
      });

      markError(journalPath, e1.id, "resolved");

      const pending = readPendingErrors(journalPath);
      expect(pending.length).toBe(1);
      expect(pending[0].errorMessage).toBe("Error B");
    });
  });

  describe("pruneOldErrors", () => {
    it("prunes entries older than retention period", () => {
      const nowMs = Date.now();
      const oldMs = nowMs - 40 * 24 * 60 * 60_000; // 40 days ago

      appendError({
        journalPath,
        sourceFile: "src/tools/old.ts",
        errorMessage: "Old error",
        nowMs: oldMs,
      });
      appendError({
        journalPath,
        sourceFile: "src/tools/new.ts",
        errorMessage: "New error",
        nowMs,
      });

      const pruned = pruneOldErrors(journalPath, 30, nowMs);
      expect(pruned).toBe(1);

      const remaining = readAllEntries(journalPath);
      expect(remaining.length).toBe(1);
      expect(remaining[0].errorMessage).toBe("New error");
    });
  });

  describe("getErrorJournalSummary", () => {
    it("returns correct counts", () => {
      const e1 = appendError({
        journalPath,
        sourceFile: "src/tools/a.ts",
        errorMessage: "Error A",
        nowMs: 1000,
      });
      appendError({
        journalPath,
        sourceFile: "src/tools/b.ts",
        errorMessage: "Error B",
        nowMs: 2000,
      });

      markError(journalPath, e1.id, "resolved");

      const summary = getErrorJournalSummary(journalPath);
      expect(summary.total).toBe(2);
      expect(summary.pending).toBe(1);
      expect(summary.resolved).toBe(1);
    });
  });
});
