import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appendEntry,
  createEntry,
  readAllEntries,
  readActiveEntries,
  markEntry,
  pruneOldEntries,
  getJournalHistory,
  countPreviousAttempts,
  type RemediationEntry,
} from "./remediation-journal.js";

describe("remediation-journal", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rem-journal-test-"));
    journalPath = path.join(tmpDir, "remediation-journal.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSampleEntry(overrides?: Partial<RemediationEntry>): RemediationEntry {
    return {
      id: "test-id-1",
      timestamp: 1000,
      probe: "cron.consecutive_errors",
      action: "re-enable",
      target: { jobId: "job-1", jobName: "Test Job" },
      description: "Re-enabling test job after fixing root cause",
      previousState: { enabled: false },
      appliedPatch: { enabled: true },
      outcome: "applied",
      ttlMs: 30 * 60_000,
      expiresAt: 1000 + 30 * 60_000,
      attempt: 1,
      maxAttempts: 2,
      ...overrides,
    };
  }

  describe("appendEntry + readAllEntries", () => {
    it("round-trips a single entry", () => {
      const entry = makeSampleEntry();
      appendEntry(journalPath, entry);
      const entries = readAllEntries(journalPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it("appends multiple entries", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "a" }));
      appendEntry(journalPath, makeSampleEntry({ id: "b" }));
      appendEntry(journalPath, makeSampleEntry({ id: "c" }));
      expect(readAllEntries(journalPath)).toHaveLength(3);
    });

    it("returns empty array when file does not exist", () => {
      expect(readAllEntries("/nonexistent/path.jsonl")).toEqual([]);
    });

    it("skips malformed lines gracefully", () => {
      fs.mkdirSync(path.dirname(journalPath), { recursive: true });
      fs.writeFileSync(journalPath, "not-json\n" + JSON.stringify(makeSampleEntry()) + "\n");
      const entries = readAllEntries(journalPath);
      expect(entries).toHaveLength(1);
    });
  });

  describe("createEntry", () => {
    it("creates and appends an entry with generated ID and computed expiresAt", () => {
      const entry = createEntry({
        journalPath,
        probe: "agent.re-enable",
        action: "re-enable",
        target: { jobId: "job-1", jobName: "Test Job" },
        description: "Testing re-enable",
        previousState: { enabled: false },
        appliedPatch: { enabled: true },
        nowMs: 5000,
        ttlMs: 60_000,
      });

      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBe(5000);
      expect(entry.expiresAt).toBe(5000 + 60_000);
      expect(entry.outcome).toBe("applied");
      expect(entry.attempt).toBe(1);
      expect(entry.maxAttempts).toBe(2);

      const stored = readAllEntries(journalPath);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(entry.id);
    });
  });

  describe("readActiveEntries", () => {
    it("returns only applied entries that have not expired", () => {
      appendEntry(
        journalPath,
        makeSampleEntry({ id: "active", outcome: "applied", expiresAt: 2000 }),
      );
      appendEntry(
        journalPath,
        makeSampleEntry({ id: "confirmed", outcome: "confirmed", expiresAt: 2000 }),
      );
      appendEntry(
        journalPath,
        makeSampleEntry({ id: "expired", outcome: "applied", expiresAt: 500 }),
      );

      const active = readActiveEntries(journalPath, 1500);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("active");
    });
  });

  describe("markEntry", () => {
    it("updates outcome of an existing entry", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "to-mark" }));
      const result = markEntry(journalPath, "to-mark", "confirmed");
      expect(result).toBe(true);

      const entries = readAllEntries(journalPath);
      expect(entries[0].outcome).toBe("confirmed");
    });

    it("adds rollback reason when provided", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "to-rollback" }));
      markEntry(journalPath, "to-rollback", "rolled-back", "Job failed again");

      const entries = readAllEntries(journalPath);
      expect(entries[0].outcome).toBe("rolled-back");
      expect(entries[0].rollbackReason).toBe("Job failed again");
    });

    it("returns false for nonexistent entry", () => {
      appendEntry(journalPath, makeSampleEntry());
      expect(markEntry(journalPath, "nonexistent", "confirmed")).toBe(false);
    });
  });

  describe("pruneOldEntries", () => {
    it("removes entries older than retention period", () => {
      const now = Date.now();
      const oldTimestamp = now - 15 * 24 * 60 * 60_000; // 15 days ago
      const recentTimestamp = now - 5 * 24 * 60 * 60_000; // 5 days ago

      appendEntry(journalPath, makeSampleEntry({ id: "old", timestamp: oldTimestamp }));
      appendEntry(journalPath, makeSampleEntry({ id: "recent", timestamp: recentTimestamp }));

      const pruned = pruneOldEntries(journalPath, 14, now);
      expect(pruned).toBe(1);

      const remaining = readAllEntries(journalPath);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("recent");
    });

    it("deletes the file when all entries are pruned", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "old", timestamp: 0 }));
      pruneOldEntries(journalPath, 1, Date.now());
      expect(fs.existsSync(journalPath)).toBe(false);
    });

    it("handles empty journal gracefully", () => {
      expect(pruneOldEntries(journalPath, 14)).toBe(0);
    });
  });

  describe("getJournalHistory", () => {
    it("returns entries sorted most recent first", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "old", timestamp: 1000 }));
      appendEntry(journalPath, makeSampleEntry({ id: "new", timestamp: 3000 }));
      appendEntry(journalPath, makeSampleEntry({ id: "mid", timestamp: 2000 }));

      const history = getJournalHistory(journalPath);
      expect(history.map((e) => e.id)).toEqual(["new", "mid", "old"]);
    });

    it("filters by jobId", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "a", target: { jobId: "j1" } }));
      appendEntry(journalPath, makeSampleEntry({ id: "b", target: { jobId: "j2" } }));

      const history = getJournalHistory(journalPath, { jobId: "j1" });
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe("a");
    });

    it("respects limit", () => {
      appendEntry(journalPath, makeSampleEntry({ id: "a", timestamp: 1000 }));
      appendEntry(journalPath, makeSampleEntry({ id: "b", timestamp: 2000 }));
      appendEntry(journalPath, makeSampleEntry({ id: "c", timestamp: 3000 }));

      const history = getJournalHistory(journalPath, { limit: 2 });
      expect(history).toHaveLength(2);
    });
  });

  describe("countPreviousAttempts", () => {
    it("counts entries matching job + probe", () => {
      appendEntry(
        journalPath,
        makeSampleEntry({
          id: "a",
          target: { jobId: "j1" },
          probe: "agent.re-enable",
        }),
      );
      appendEntry(
        journalPath,
        makeSampleEntry({
          id: "b",
          target: { jobId: "j1" },
          probe: "agent.re-enable",
        }),
      );
      appendEntry(
        journalPath,
        makeSampleEntry({
          id: "c",
          target: { jobId: "j1" },
          probe: "agent.adjust-schedule",
        }),
      );
      appendEntry(
        journalPath,
        makeSampleEntry({
          id: "d",
          target: { jobId: "j2" },
          probe: "agent.re-enable",
        }),
      );

      expect(countPreviousAttempts(journalPath, "j1", "agent.re-enable")).toBe(2);
      expect(countPreviousAttempts(journalPath, "j1", "agent.adjust-schedule")).toBe(1);
      expect(countPreviousAttempts(journalPath, "j2", "agent.re-enable")).toBe(1);
    });
  });
});
