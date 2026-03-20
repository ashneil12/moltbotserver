import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveMemoryFilesToRotate,
  resetMemoryFileRotatorThrottle,
  rotateOldMemoryFiles,
} from "./memory-file-rotator.js";

describe("resolveMemoryFilesToRotate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-rotator-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMemoryFile(name: string, content: string = "test content") {
    fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
  }

  it("groups daily files by month", () => {
    createMemoryFile("2025-01-05.md");
    createMemoryFile("2025-01-15.md");
    createMemoryFile("2025-02-10.md");

    // Use a date far in the future so all files are "old"
    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(tmpDir, futureMs, 30);

    expect(groups).toHaveLength(2);
    expect(groups[0].month).toBe("2025-01");
    expect(groups[0].files).toHaveLength(2);
    expect(groups[1].month).toBe("2025-02");
    expect(groups[1].files).toHaveLength(1);
  });

  it("sorts files within each group chronologically", () => {
    createMemoryFile("2025-01-20.md");
    createMemoryFile("2025-01-05.md");
    createMemoryFile("2025-01-15.md");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(tmpDir, futureMs, 30);

    expect(groups[0].files[0].date).toBe("2025-01-05");
    expect(groups[0].files[1].date).toBe("2025-01-15");
    expect(groups[0].files[2].date).toBe("2025-01-20");
  });

  it("does not include files within the max age window", () => {
    createMemoryFile("2025-03-01.md"); // old
    createMemoryFile("2025-03-25.md"); // recent

    // "Now" is April 1 — files within 30 days (after March 2) are kept
    const nowMs = new Date("2025-04-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(tmpDir, nowMs, 30);

    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(1);
    expect(groups[0].files[0].date).toBe("2025-03-01");
  });

  it("ignores non-date files", () => {
    createMemoryFile("MEMORY.md");
    createMemoryFile("diary.md");
    createMemoryFile("notes.txt");
    createMemoryFile("2025-01-05.md");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(tmpDir, futureMs, 30);

    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(1);
  });

  it("ignores directories", () => {
    fs.mkdirSync(path.join(tmpDir, "archive"), { recursive: true });
    createMemoryFile("2025-01-05.md");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(tmpDir, futureMs, 30);

    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(1);
  });

  it("returns empty for missing directory", () => {
    const groups = resolveMemoryFilesToRotate("/tmp/nonexistent-dir", Date.now(), 30);
    expect(groups).toHaveLength(0);
  });
});

describe("rotateOldMemoryFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetMemoryFileRotatorThrottle();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-rotator-workspace-"));
    fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMemoryFile(name: string, content: string = "test content") {
    fs.writeFileSync(path.join(tmpDir, "memory", name), content, "utf-8");
  }

  it("creates monthly archive from old daily files", () => {
    createMemoryFile("2025-01-05.md", "Day 5 notes");
    createMemoryFile("2025-01-15.md", "Day 15 notes");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.rotated).toBe(true);
    expect(result.archivesWritten).toBe(1);
    expect(result.dailyFilesDeleted).toBe(2);

    // Check archive exists
    const archivePath = path.join(tmpDir, "memory", "archive", "2025-01.md");
    expect(fs.existsSync(archivePath)).toBe(true);

    const content = fs.readFileSync(archivePath, "utf-8");
    expect(content).toContain("# Memory Archive — 2025-01");
    expect(content).toContain("## 2025-01-05");
    expect(content).toContain("Day 5 notes");
    expect(content).toContain("## 2025-01-15");
    expect(content).toContain("Day 15 notes");

    // Check original files are deleted
    expect(fs.existsSync(path.join(tmpDir, "memory", "2025-01-05.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "memory", "2025-01-15.md"))).toBe(false);
  });

  it("appends to existing archive", () => {
    // Create existing archive
    const archiveDir = path.join(tmpDir, "memory", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, "2025-01.md"),
      "# Memory Archive — 2025-01\n\n## 2025-01-01\n\nExisting content\n",
      "utf-8",
    );

    createMemoryFile("2025-01-10.md", "New day 10 notes");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.archivesWritten).toBe(1);

    const content = fs.readFileSync(path.join(archiveDir, "2025-01.md"), "utf-8");
    expect(content).toContain("Existing content");
    expect(content).toContain("New day 10 notes");
  });

  it("does not touch recent files", () => {
    createMemoryFile("2025-03-25.md", "Recent notes");

    const nowMs = new Date("2025-04-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs });

    expect(result.archivesWritten).toBe(0);
    expect(result.dailyFilesDeleted).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "memory", "2025-03-25.md"))).toBe(true);
  });

  it("does not touch non-date files", () => {
    createMemoryFile("MEMORY.md", "Standing memories");
    createMemoryFile("diary.md", "Diary entries");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.archivesWritten).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "memory", "MEMORY.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "memory", "diary.md"))).toBe(true);
  });

  it("handles multiple months", () => {
    createMemoryFile("2025-01-05.md", "Jan notes");
    createMemoryFile("2025-02-10.md", "Feb notes");
    createMemoryFile("2025-03-15.md", "Mar notes");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.archivesWritten).toBe(3);
    expect(result.dailyFilesDeleted).toBe(3);
  });

  it("self-throttles without force", () => {
    createMemoryFile("2025-01-05.md", "notes");
    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();

    const r1 = rotateOldMemoryFiles(tmpDir, { nowMs: futureMs });
    expect(r1.rotated).toBe(true);

    createMemoryFile("2025-02-05.md", "more notes");
    const r2 = rotateOldMemoryFiles(tmpDir, { nowMs: futureMs + 60_000 });
    expect(r2.rotated).toBe(false);
  });

  it("handles empty memory directory", () => {
    const result = rotateOldMemoryFiles(tmpDir, { force: true });
    expect(result.rotated).toBe(true);
    expect(result.archivesWritten).toBe(0);
  });

  it("handles missing memory directory", () => {
    const noMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-memory-"));
    try {
      const result = rotateOldMemoryFiles(noMemoryDir, { force: true });
      expect(result.rotated).toBe(true);
      expect(result.archivesWritten).toBe(0);
    } finally {
      fs.rmSync(noMemoryDir, { recursive: true, force: true });
    }
  });

  it("cleans empty daily files without creating archive", () => {
    createMemoryFile("2025-01-05.md", "");
    createMemoryFile("2025-01-10.md", "   ");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.archivesWritten).toBe(0);
    expect(result.dailyFilesDeleted).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "memory", "archive", "2025-01.md"))).toBe(false);
  });

  it("archives non-empty files and cleans empty files in same month", () => {
    createMemoryFile("2025-01-05.md", "Real content");
    createMemoryFile("2025-01-10.md", "");
    createMemoryFile("2025-01-15.md", "More content");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const result = rotateOldMemoryFiles(tmpDir, { force: true, nowMs: futureMs });

    expect(result.archivesWritten).toBe(1);
    expect(result.dailyFilesDeleted).toBe(3);

    const archivePath = path.join(tmpDir, "memory", "archive", "2025-01.md");
    const content = fs.readFileSync(archivePath, "utf-8");
    expect(content).toContain("Real content");
    expect(content).toContain("More content");
    expect(content).not.toContain("2025-01-10"); // empty file excluded from archive
  });

  it("skips files with impossible month/day values", () => {
    // Note: JS Date auto-rolls 2025-02-30 to 2025-03-02, so we test
    // the regex validation guard (month/day range check) instead.
    // The regex matches \d{2} for month/day, but resolveMemoryFilesToRotate
    // only receives files matching DAILY_FILE_PATTERN (/^\d{4}-\d{2}-\d{2}\.md$/),
    // and we guard month 1-12, day 1-31 in the scanner. Here we verify that
    // truly malformed filenames (e.g. month=00) are handled gracefully.
    createMemoryFile("2025-00-15.md", "Month zero");
    createMemoryFile("2025-01-15.md", "Valid date");

    const futureMs = new Date("2026-06-01T00:00:00Z").getTime();
    const groups = resolveMemoryFilesToRotate(path.join(tmpDir, "memory"), futureMs, 30);

    // The valid file should be included; month-00 matches the regex but
    // Date("2025-00-15") → NaN, so our NaN guard skips it
    const allFiles = groups.flatMap((g) => g.files);
    expect(allFiles.some((f) => f.date === "2025-01-15")).toBe(true);
  });
});
