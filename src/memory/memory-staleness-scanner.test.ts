import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatStalenessSummary, scanMemoryForStaleness } from "./memory-staleness-scanner.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "staleness-scanner-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMemory(content: string): string {
  const filePath = path.join(tmpDir, "MEMORY.md");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("scanMemoryForStaleness", () => {
  it("detects [YYYY-MM] format dates", () => {
    const memPath = writeMemory(`
# Memory

## Preferences
- Prefers dark mode [2024-06]
- Uses VS Code [2025-09]
    `);

    // "Now" is 2025-11-01 — entries > 90 days old are stale
    const nowMs = new Date("2025-11-01T00:00:00Z").getTime();
    const result = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });

    expect(result.fileFound).toBe(true);
    expect(result.staleCount).toBe(1);
    expect(result.entries[0].date).toBe("2024-06");
    expect(result.entries[0].snippet).toContain("dark mode");
  });

  it("detects [YYYY-MM-DD] format dates", () => {
    const memPath = writeMemory(`
# Memory

- Set up SSH keys [2024-03-15]
- Updated Node to v20 [2025-09-01]
    `);

    const nowMs = new Date("2025-11-01T00:00:00Z").getTime();
    const result = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });

    expect(result.staleCount).toBe(1);
    expect(result.entries[0].date).toBe("2024-03-15");
  });

  it("detects (YYYY-MM) format dates with parentheses", () => {
    const memPath = writeMemory(`
- Old preference (2024-01)
    `);

    const nowMs = new Date("2025-11-01T00:00:00Z").getTime();
    const result = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });

    expect(result.staleCount).toBe(1);
    expect(result.entries[0].date).toBe("2024-01");
  });

  it("returns empty for undated entries", () => {
    const memPath = writeMemory(`
# Memory

- Prefers dark mode
- Uses VS Code
- Likes coffee
    `);

    const result = scanMemoryForStaleness(memPath);

    expect(result.staleCount).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it("respects staleness threshold", () => {
    const memPath = writeMemory(`
- Recent update [2025-10-01]
    `);

    // With a 30-day threshold and "now" at 2025-11-15, this entry is 45 days old
    const nowMs = new Date("2025-11-15T00:00:00Z").getTime();

    const r1 = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 30 });
    expect(r1.staleCount).toBe(1);

    const r2 = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });
    expect(r2.staleCount).toBe(0);
  });

  it("handles missing MEMORY.md gracefully", () => {
    const result = scanMemoryForStaleness(path.join(tmpDir, "nonexistent.md"));

    expect(result.fileFound).toBe(false);
    expect(result.staleCount).toBe(0);
  });

  it("deduplicates same date appearing on multiple lines", () => {
    const memPath = writeMemory(`
- First thing [2024-06]
- Second thing [2024-06]
- Third thing [2024-06]
    `);

    const nowMs = new Date("2025-11-01T00:00:00Z").getTime();
    const result = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });

    // Should only report the first occurrence
    expect(result.staleCount).toBe(1);
  });

  it("includes line numbers and snippets", () => {
    const memPath = writeMemory(`# Memory

- Old entry here [2024-01-15]
`);

    const nowMs = new Date("2025-11-01T00:00:00Z").getTime();
    const result = scanMemoryForStaleness(memPath, { nowMs, thresholdDays: 90 });

    expect(result.entries[0].line).toBe(3);
    expect(result.entries[0].snippet).toContain("Old entry here");
  });
});

describe("formatStalenessSummary", () => {
  it("returns null when no stale entries", () => {
    const summary = formatStalenessSummary({
      staleCount: 0,
      entries: [],
      fileFound: true,
    });
    expect(summary).toBeNull();
  });

  it("formats single stale entry", () => {
    const summary = formatStalenessSummary({
      staleCount: 1,
      entries: [{ date: "2024-06", line: 5, snippet: "Prefers dark mode" }],
      fileFound: true,
    });

    expect(summary).toContain("1 potentially stale memory entry");
    expect(summary).toContain("Line 5 [2024-06]");
    expect(summary).toContain("Prefers dark mode");
  });

  it("formats multiple stale entries", () => {
    const summary = formatStalenessSummary({
      staleCount: 2,
      entries: [
        { date: "2024-01", line: 3, snippet: "Entry 1" },
        { date: "2024-03", line: 7, snippet: "Entry 2" },
      ],
      fileFound: true,
    });

    expect(summary).toContain("2 potentially stale memory entries");
    expect(summary).toContain("Entry 1");
    expect(summary).toContain("Entry 2");
  });

  it("caps at 10 entries with overflow indicator", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      date: `2024-01`,
      line: i + 1,
      snippet: `Entry ${i}`,
    }));

    const summary = formatStalenessSummary({
      staleCount: 15,
      entries,
      fileFound: true,
    });

    expect(summary).toContain("...and 5 more");
  });
});
