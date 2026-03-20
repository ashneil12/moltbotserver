import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractEntries,
  pruneMemoryFileIfNeeded,
  countMissPatterns,
  extractExistingCriticalRules,
  promoteMissPatterns,
  parseEvidenceCounters,
  correlateHitMissWithRules,
  updateEvidenceCounters,
  flagProblematicRules,
} from "./diary-archive.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "diary-archive-test-"));
  // Create memory/archive structure
  await fs.mkdir(path.join(tmpDir, "memory", "archive"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Generate a diary-style entry (### YYYY-MM-DD HH:MM UTC — Title). */
function diaryEntry(day: number, content = "Some reflection text."): string {
  const dd = day.toString().padStart(2, "0");
  return `### 2026-03-${dd} 12:00 UTC — Consciousness pass\n\n${content}\n\n---\n`;
}

/** Generate a self-review-style entry ([YYYY-MM-DD]). */
function selfReviewEntry(day: number, content = "TAG: [depth] HIT: Good. KEEP: this."): string {
  const dd = day.toString().padStart(2, "0");
  return `[2026-03-${dd}]\n\n${content}\n`;
}

/** Generate a scratchpad-style entry (### YYYY-MM-DD HH:MM UTC — Review). */
function scratchpadEntry(day: number, content = "No changes to IDENTITY.md."): string {
  const dd = day.toString().padStart(2, "0");
  return `### 2026-03-${dd} 06:00 UTC — Identity review (no-change)\n\n- **What changed:** ${content}\n`;
}

const DIARY_HEADER = `# Diary

> Your reflective journal.
> Archived automatically when the file grows large.

---

## Entries

`;

const SELF_REVIEW_HEADER = `# Self-Review Log

> Read on boot. Log mistakes (MISS) and successes (HIT).
> If same MISS appears 3x, promote to CRITICAL rule.

---

## Log

`;

const SCRATCHPAD_HEADER = `# Identity Scratchpad

> WHY you added things to IDENTITY.md.
> Read during identity reviews to evaluate whether entries still make sense.

---

## Notes

`;

// ---------------------------------------------------------------------------
// extractEntries tests
// ---------------------------------------------------------------------------

describe("extractEntries", () => {
  it("parses diary entries (h3Date format)", () => {
    const content = DIARY_HEADER + diaryEntry(1) + diaryEntry(2) + diaryEntry(3);
    const { header, entries } = extractEntries(content, "h3Date");

    expect(header).toBe(DIARY_HEADER.slice(0, -1)); // trailing \n is in the join
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain("2026-03-01");
    expect(entries[2]).toContain("2026-03-03");
  });

  it("parses self-review entries (bracketDate format)", () => {
    const content = SELF_REVIEW_HEADER + selfReviewEntry(5) + selfReviewEntry(6);
    const { header, entries } = extractEntries(content, "bracketDate");

    expect(header).toBe(SELF_REVIEW_HEADER.slice(0, -1));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("[2026-03-05]");
    expect(entries[1]).toContain("[2026-03-06]");
  });

  it("parses scratchpad entries (h3Date format)", () => {
    const content = SCRATCHPAD_HEADER + scratchpadEntry(1) + scratchpadEntry(2);
    const { entries } = extractEntries(content, "h3Date");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("2026-03-01");
  });

  it("returns no entries for header-only content", () => {
    const { header, entries } = extractEntries(DIARY_HEADER, "h3Date");

    expect(header).toBe(DIARY_HEADER);
    expect(entries).toHaveLength(0);
  });

  it("returns entire content as header when no entries match format", () => {
    const content = "Just some random text\nWith no date headers";
    const { header, entries } = extractEntries(content, "h3Date");

    expect(header).toBe(content);
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pruneMemoryFileIfNeeded tests
// ---------------------------------------------------------------------------

describe("pruneMemoryFileIfNeeded", () => {
  it("skips files under the size threshold", async () => {
    const filePath = path.join(tmpDir, "memory", "diary.md");
    await fs.writeFile(filePath, DIARY_HEADER + diaryEntry(1));

    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md", 100_000, 5);

    expect(result.pruned).toBe(false);
    expect(result.entriesMoved).toBe(0);
  });

  it("skips non-existent files", async () => {
    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md");

    expect(result.pruned).toBe(false);
  });

  it("prunes diary.md when over threshold", async () => {
    // Generate 20 entries, each ~500 bytes, with a low threshold
    const entries = Array.from({ length: 20 }, (_, i) => diaryEntry(i + 1, "A".repeat(400)));
    const content = DIARY_HEADER + entries.join("");
    const filePath = path.join(tmpDir, "memory", "diary.md");
    await fs.writeFile(filePath, content);

    // Set threshold very low so pruning triggers, keep last 5
    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md", 1, 5);

    expect(result.pruned).toBe(true);
    expect(result.entriesMoved).toBe(15);
    expect(result.overflowPath).toBeTruthy();

    // Verify hot file has header + 5 entries
    const hotContent = await fs.readFile(filePath, "utf-8");
    const { header, entries: hotEntries } = extractEntries(hotContent, "h3Date");
    expect(header).toContain("# Diary");
    expect(hotEntries).toHaveLength(5);
    // Should be the last 5 (days 16-20)
    expect(hotEntries[0]).toContain("2026-03-16");
    expect(hotEntries[4]).toContain("2026-03-20");

    // Verify overflow file has 15 entries
    const overflowContent = await fs.readFile(result.overflowPath!, "utf-8");
    const { entries: overflowEntries } = extractEntries(overflowContent, "h3Date");
    expect(overflowEntries).toHaveLength(15);
    expect(overflowEntries[0]).toContain("2026-03-01");
  });

  it("prunes self-review.md with bracketDate format", async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      selfReviewEntry(i + 1, "TAG: [scope] MISS: " + "B".repeat(300)),
    );
    const content = SELF_REVIEW_HEADER + entries.join("");
    const filePath = path.join(tmpDir, "memory", "self-review.md");
    await fs.writeFile(filePath, content);

    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/self-review.md", 1, 3);

    expect(result.pruned).toBe(true);
    expect(result.entriesMoved).toBe(7);

    // Hot file should have header + 3 entries
    const hotContent = await fs.readFile(filePath, "utf-8");
    const { entries: hotEntries } = extractEntries(hotContent, "bracketDate");
    expect(hotEntries).toHaveLength(3);
    expect(hotEntries[0]).toContain("[2026-03-08]");
  });

  it("prunes identity-scratchpad.md", async () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      scratchpadEntry(i + 1, "No change. " + "C".repeat(300)),
    );
    const content = SCRATCHPAD_HEADER + entries.join("");
    const filePath = path.join(tmpDir, "memory", "identity-scratchpad.md");
    await fs.writeFile(filePath, content);

    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/identity-scratchpad.md", 1, 4);

    expect(result.pruned).toBe(true);
    expect(result.entriesMoved).toBe(8);
  });

  it("preserves header after pruning", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => diaryEntry(i + 1, "X".repeat(200)));
    const content = DIARY_HEADER + entries.join("");
    const filePath = path.join(tmpDir, "memory", "diary.md");
    await fs.writeFile(filePath, content);

    await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md", 1, 3);

    const hotContent = await fs.readFile(filePath, "utf-8");
    expect(hotContent).toContain("# Diary");
    expect(hotContent).toContain("reflective journal");
    expect(hotContent).toContain("## Entries");
  });

  it("does not prune when entry count is below threshold", async () => {
    // File is large (over maxBytes) but has few entries
    const content = DIARY_HEADER + diaryEntry(1, "Z".repeat(5000));
    const filePath = path.join(tmpDir, "memory", "diary.md");
    await fs.writeFile(filePath, content);

    const result = await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md", 1, 5);

    expect(result.pruned).toBe(false);
    expect(result.entriesMoved).toBe(0);
  });

  it("appends to existing overflow file on same day", async () => {
    // Create an existing overflow file
    const now = new Date();
    const archiveSubdir = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
    const dateSuffix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
    const overflowDir = path.join(tmpDir, "memory", "archive", archiveSubdir);
    await fs.mkdir(overflowDir, { recursive: true });
    const overflowPath = path.join(overflowDir, `diary-overflow-${dateSuffix}.md`);
    await fs.writeFile(overflowPath, "### 2026-02-28 — Old overflow entry\n\nPrevious overflow.\n");

    // Create a file that needs pruning
    const entries = Array.from({ length: 10 }, (_, i) => diaryEntry(i + 1, "D".repeat(200)));
    const filePath = path.join(tmpDir, "memory", "diary.md");
    await fs.writeFile(filePath, DIARY_HEADER + entries.join(""));

    await pruneMemoryFileIfNeeded(tmpDir, "memory/diary.md", 1, 3);

    // Overflow should contain previous content + new cold entries
    const overflowContent = await fs.readFile(overflowPath, "utf-8");
    expect(overflowContent).toContain("Old overflow entry");
    expect(overflowContent).toContain("2026-03-01");
  });
});

// ---------------------------------------------------------------------------
// countMissPatterns tests
// ---------------------------------------------------------------------------

describe("countMissPatterns", () => {
  it("counts unique MISS FIX patterns", () => {
    const content = `
[2026-03-01] MISS: Didn't check API status — FIX: Always verify API health before calling
[2026-03-02] MISS: Same issue again — FIX: Always verify API health before calling
[2026-03-03] MISS: Third time — FIX: Always verify API health before calling
[2026-03-04] MISS: Different issue — FIX: Check file existence before reading
`;
    const counts = countMissPatterns(content);
    expect(counts.get("always verify api health before calling")).toBe(3);
    expect(counts.get("check file existence before reading")).toBe(1);
  });

  it("ignores trivially short FIX texts", () => {
    const content = "MISS: thing — FIX: do it";
    const counts = countMissPatterns(content);
    expect(counts.size).toBe(0);
  });

  it("normalizes whitespace and case", () => {
    const content = `
MISS: a — FIX: Always  CHECK  the  Status  First
MISS: b — FIX: always check the status first
`;
    const counts = countMissPatterns(content);
    expect(counts.get("always check the status first")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractExistingCriticalRules tests
// ---------------------------------------------------------------------------

describe("extractExistingCriticalRules", () => {
  it("extracts existing CRITICAL rules", () => {
    const content = `
## CRITICAL Rules

- **CRITICAL:** Always verify API health before calling
- **CRITICAL:** Never deploy without tests
`;
    const rules = extractExistingCriticalRules(content);
    expect(rules.has("always verify api health before calling")).toBe(true);
    expect(rules.has("never deploy without tests")).toBe(true);
  });

  it("returns empty set for no CRITICAL rules", () => {
    const content = "# IDENTITY.md\n\nJust normal content";
    const rules = extractExistingCriticalRules(content);
    expect(rules.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// promoteMissPatterns tests
// ---------------------------------------------------------------------------

describe("promoteMissPatterns", () => {
  it("promotes MISS patterns that hit threshold", async () => {
    // Create self-review with 3x same MISS
    const selfReview = `
[2026-03-01] MISS: Failed to check — FIX: Always verify API health before operations
[2026-03-02] MISS: Same thing — FIX: Always verify API health before operations
[2026-03-03] MISS: Again — FIX: Always verify API health before operations
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);

    // Create identity without CRITICAL section
    const identity = `# IDENTITY.md\n\n## How You Work\n\n- Does stuff\n`;
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), identity);

    const result = await promoteMissPatterns(tmpDir, 3);

    expect(result.promoted).toBe(1);
    expect(result.promotedFixes).toHaveLength(1);
    expect(result.promotedFixes[0]).toContain("verify api health");

    // Verify IDENTITY.md was updated
    const updatedIdentity = await fs.readFile(path.join(tmpDir, "IDENTITY.md"), "utf-8");
    expect(updatedIdentity).toContain("CRITICAL Rules");
    expect(updatedIdentity).toContain("CRITICAL [0H/0M]:");
    expect(updatedIdentity).toContain("verify api health");
  });

  it("skips patterns below threshold", async () => {
    const selfReview = `
[2026-03-01] MISS: Failed — FIX: Always verify API health before operations
[2026-03-02] MISS: Again — FIX: Always verify API health before operations
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), "# IDENTITY\n");

    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(0);
  });

  it("skips patterns already in IDENTITY.md", async () => {
    const selfReview = `
[2026-03-01] MISS: x — FIX: Always verify API health before operations
[2026-03-02] MISS: x — FIX: Always verify API health before operations
[2026-03-03] MISS: x — FIX: Always verify API health before operations
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);

    const identity = `# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL:** Always verify API health before operations\n`;
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), identity);

    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(0);
  });

  it("appends to existing CRITICAL Rules section", async () => {
    const selfReview = `
MISS: x — FIX: Check file existence before reading it
MISS: x — FIX: Check file existence before reading it
MISS: x — FIX: Check file existence before reading it
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);

    const identity = `# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL:** Existing rule about something\n\n## How You Work\n`;
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), identity);

    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(1);

    const updatedIdentity = await fs.readFile(path.join(tmpDir, "IDENTITY.md"), "utf-8");
    expect(updatedIdentity).toContain("Existing rule about something");
    expect(updatedIdentity).toContain("file existence");
    expect(updatedIdentity).toContain("[0H/0M]");
  });

  it("no-ops when self-review.md is missing", async () => {
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), "# IDENTITY\n");
    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(0);
  });

  it("no-ops when IDENTITY.md is missing", async () => {
    await fs.writeFile(
      path.join(tmpDir, "memory", "self-review.md"),
      "MISS: x — FIX: do something important here\nMISS: x — FIX: do something important here\nMISS: x — FIX: do something important here\n",
    );
    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(0);
  });

  it("skips substantially similar existing rules", async () => {
    const selfReview = `
MISS: x — FIX: Always verify the API health status before calling
MISS: x — FIX: Always verify the API health status before calling
MISS: x — FIX: Always verify the API health status before calling
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);

    // Existing rule is similar but not identical
    const identity = `# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL:** Always verify API health before calling endpoints\n`;
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), identity);

    const result = await promoteMissPatterns(tmpDir, 3);
    // Should detect similarity and skip
    expect(result.promoted).toBe(0);
  });

  it("also skips substantially similar existing rules with evidence counters", async () => {
    const selfReview = `
MISS: x — FIX: Always verify the API health status before calling
MISS: x — FIX: Always verify the API health status before calling
MISS: x — FIX: Always verify the API health status before calling
`;
    await fs.writeFile(path.join(tmpDir, "memory", "self-review.md"), selfReview);

    // Existing rule has evidence counters
    const identity = `# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL [3H/1M]:** Always verify API health before calling endpoints\n`;
    await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), identity);

    const result = await promoteMissPatterns(tmpDir, 3);
    expect(result.promoted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Evidence counter tests
// ---------------------------------------------------------------------------

describe("parseEvidenceCounters", () => {
  it("parses valid counters", () => {
    const result = parseEvidenceCounters("- **CRITICAL [5H/2M]:** Some rule");
    expect(result).toEqual({ hits: 5, misses: 2 });
  });

  it("parses zero counters", () => {
    const result = parseEvidenceCounters("- **CRITICAL [0H/0M]:** Some rule");
    expect(result).toEqual({ hits: 0, misses: 0 });
  });

  it("returns null for rules without counters", () => {
    const result = parseEvidenceCounters("- **CRITICAL:** Some rule");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseEvidenceCounters("");
    expect(result).toBeNull();
  });
});

describe("correlateHitMissWithRules", () => {
  it("matches HIT entries to CRITICAL rules by word overlap", () => {
    const selfReview = `
[2026-03-10] HIT: Verified API health before making the call. KEEP: good practice.
`;
    const rules = new Set(["always verify api health before calling"]);
    const deltas = correlateHitMissWithRules(selfReview, rules);

    expect(deltas.get("always verify api health before calling")).toEqual({
      hits: 1,
      misses: 0,
    });
  });

  it("matches MISS entries to CRITICAL rules", () => {
    const selfReview = `
[2026-03-10] MISS: Forgot to verify API health before calling. FIX: Check next time.
`;
    const rules = new Set(["always verify api health before calling"]);
    const deltas = correlateHitMissWithRules(selfReview, rules);

    expect(deltas.get("always verify api health before calling")).toEqual({
      hits: 0,
      misses: 1,
    });
  });

  it("accumulates multiple hits and misses", () => {
    const selfReview = `
HIT: Verified API health. KEEP: always do this.
MISS: Forgot API health verification. FIX: Check first.
HIT: API health check passed. KEEP: great.
`;
    const rules = new Set(["always verify api health before calling"]);
    const deltas = correlateHitMissWithRules(selfReview, rules);

    const delta = deltas.get("always verify api health before calling");
    expect(delta).toBeDefined();
    expect(delta!.hits).toBe(2);
    expect(delta!.misses).toBe(1);
  });

  it("returns empty map when no rules match", () => {
    const selfReview = "HIT: Good formatting in responses. KEEP: yes.";
    const rules = new Set(["always verify api health before calling"]);
    const deltas = correlateHitMissWithRules(selfReview, rules);
    expect(deltas.size).toBe(0);
  });

  it("returns empty map for empty rules set", () => {
    const selfReview = "HIT: Something good.";
    const deltas = correlateHitMissWithRules(selfReview, new Set());
    expect(deltas.size).toBe(0);
  });
});

describe("updateEvidenceCounters", () => {
  it("increments counters on matching rules", () => {
    const identity = `## CRITICAL Rules\n\n- **CRITICAL [2H/1M]:** Always verify API health before calling\n`;
    const deltas = new Map([["always verify api health before calling", { hits: 1, misses: 0 }]]);

    const updated = updateEvidenceCounters(identity, deltas);
    expect(updated).toContain("[3H/1M]");
  });

  it("increments miss counter", () => {
    const identity = `- **CRITICAL [2H/1M]:** Always verify API health before calling\n`;
    const deltas = new Map([["always verify api health before calling", { hits: 0, misses: 2 }]]);

    const updated = updateEvidenceCounters(identity, deltas);
    expect(updated).toContain("[2H/3M]");
  });

  it("leaves rules without counters unchanged", () => {
    const identity = `- **CRITICAL:** Some old rule without counters\n`;
    const deltas = new Map([["some old rule without counters", { hits: 1, misses: 0 }]]);

    const updated = updateEvidenceCounters(identity, deltas);
    expect(updated).toBe(identity);
  });

  it("returns original when no deltas provided", () => {
    const identity = `- **CRITICAL [0H/0M]:** Some rule\n`;
    const updated = updateEvidenceCounters(identity, new Map());
    expect(updated).toBe(identity);
  });
});

describe("flagProblematicRules", () => {
  it("flags rules where misses >= hits with 3+ observations", () => {
    const identity = `
## CRITICAL Rules

- **CRITICAL [1H/3M]:** Always verify API health before calling
- **CRITICAL [5H/1M]:** Check file existence before reading
`;
    const flagged = flagProblematicRules(identity);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].text).toContain("verify API health");
    expect(flagged[0].hits).toBe(1);
    expect(flagged[0].misses).toBe(3);
  });

  it("skips rules with fewer than minObservations", () => {
    const identity = `- **CRITICAL [0H/2M]:** Something with only 2 observations\n`;
    const flagged = flagProblematicRules(identity, 3);
    expect(flagged).toHaveLength(0);
  });

  it("flags rules where hits equal misses", () => {
    const identity = `- **CRITICAL [2H/2M]:** Borderline rule\n`;
    const flagged = flagProblematicRules(identity, 3);
    expect(flagged).toHaveLength(1);
  });

  it("returns empty for rules without counters", () => {
    const identity = `- **CRITICAL:** Old rule without counters\n`;
    const flagged = flagProblematicRules(identity);
    expect(flagged).toHaveLength(0);
  });

  it("returns empty for healthy rules", () => {
    const identity = `- **CRITICAL [5H/1M]:** Well-performing rule\n`;
    const flagged = flagProblematicRules(identity);
    expect(flagged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pruneWorkingMd tests
// ---------------------------------------------------------------------------

import {
  pruneWorkingMd,
  pruneOldDailyMemoryLogs,
  WORKING_STALE_LOOP_MAX_AGE_MS,
  DAILY_MEMORY_LOG_MAX_AGE_MS,
} from "./diary-archive.js";

describe("pruneWorkingMd", () => {
  it("no-ops when WORKING.md does not exist", async () => {
    const result = await pruneWorkingMd(tmpDir);
    expect(result.staleLoopsRemoved).toBe(0);
    expect(result.completedTasksArchived).toBe(0);
  });

  it("no-ops on pure template file (contains placeholder brackets)", async () => {
    const template = `# WORKING.md\n\n## Current Task\n\n[What you're actively working on]\n\n## Open Loops\n\n- [ ] [Example: Check if deploy succeeded — added DATE]\n`;
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), template, "utf-8");
    const result = await pruneWorkingMd(tmpDir);
    expect(result.staleLoopsRemoved).toBe(0);
    expect(result.completedTasksArchived).toBe(0);
  });

  it("removes stale open loops older than staleAgeMs", async () => {
    // Use a very small staleAgeMs so the date in the past is considered stale
    const content = [
      "# WORKING.md",
      "",
      "## Open Loops",
      "",
      "- [ ] Check deploy outcome — added 2020-01-01",
      "- [ ] Follow up with client — added 2020-02-15",
      "- [ ] Still fresh task — added 2099-12-31",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), content, "utf-8");

    const result = await pruneWorkingMd(tmpDir, Date.now(), 1); // 1ms stale threshold
    expect(result.staleLoopsRemoved).toBe(2);

    const updated = await fs.readFile(path.join(tmpDir, "WORKING.md"), "utf-8");
    expect(updated).not.toContain("Check deploy outcome");
    expect(updated).not.toContain("Follow up with client");
    expect(updated).toContain("Still fresh task");
  });

  it("archives completed [x] tasks to today's daily memory log", async () => {
    const nowMs = Date.now();
    const dateStr = new Date(nowMs).toISOString().slice(0, 10);

    const content = [
      "# WORKING.md",
      "",
      "## Tasks",
      "",
      "- [x] Ship the new feature",
      "- [x] Write the tests",
      "- [ ] Deploy to production — added 2099-01-01",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), content, "utf-8");

    const result = await pruneWorkingMd(tmpDir, nowMs);
    expect(result.completedTasksArchived).toBe(2);

    // Completed tasks should no longer be in WORKING.md
    const updated = await fs.readFile(path.join(tmpDir, "WORKING.md"), "utf-8");
    expect(updated).not.toContain("Ship the new feature");
    expect(updated).not.toContain("Write the tests");
    expect(updated).toContain("Deploy to production");

    // Completed tasks should appear in today's daily log
    const dailyLog = await fs.readFile(path.join(tmpDir, "memory", `${dateStr}.md`), "utf-8");
    expect(dailyLog).toContain("Ship the new feature");
    expect(dailyLog).toContain("Write the tests");
    expect(dailyLog).toContain("Completed tasks archived from WORKING.md");
  });

  it("does not modify file when nothing to prune", async () => {
    const content = [
      "# WORKING.md",
      "",
      "## Current Task",
      "",
      "Working on the dashboard redesign.",
      "",
      "## Open Loops",
      "",
      "- [ ] Check Stripe webhook — added 2099-01-01",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), content, "utf-8");

    const result = await pruneWorkingMd(tmpDir, Date.now(), WORKING_STALE_LOOP_MAX_AGE_MS);
    expect(result.staleLoopsRemoved).toBe(0);
    expect(result.completedTasksArchived).toBe(0);

    // File should be unchanged
    const updated = await fs.readFile(path.join(tmpDir, "WORKING.md"), "utf-8");
    expect(updated).toBe(content);
  });

  it("does not remove loops whose task description contains a hyphen (regression)", async () => {
    // Previously the bare-hyphen regex matched any hyphenated word in the task text.
    // e.g. "- [ ] fix broken-deploy stuff" was incorrectly treated as having
    // an "added" date of "deploy" and getting evicted.
    const content = [
      "# WORKING.md",
      "",
      "- [ ] fix broken-deploy integration — no date here",
      "- [ ] check self-review file — no date here",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), content, "utf-8");

    const result = await pruneWorkingMd(tmpDir, Date.now(), 1); // aggressive threshold
    // Neither line has a date annotation in the expected format → nothing removed
    expect(result.staleLoopsRemoved).toBe(0);
    const updated = await fs.readFile(path.join(tmpDir, "WORKING.md"), "utf-8");
    expect(updated).toContain("fix broken-deploy integration");
    expect(updated).toContain("check self-review file");
  });

  it("writes completed tasks with [x] prefix directly (no double-dash) in daily log", async () => {
    const nowMs = Date.now();
    const dateStr = new Date(nowMs).toISOString().slice(0, 10);

    const content = ["# WORKING.md", "- [x] Refactor the noise filter"].join("\n");
    await fs.writeFile(path.join(tmpDir, "WORKING.md"), content, "utf-8");

    await pruneWorkingMd(tmpDir, nowMs);

    const dailyLog = await fs.readFile(path.join(tmpDir, "memory", `${dateStr}.md`), "utf-8");
    // Should be "- [x] Refactor..." not "- - [x] Refactor..."
    expect(dailyLog).toContain("- [x] Refactor the noise filter");
    expect(dailyLog).not.toContain("- - [x]");
  });
});

// ---------------------------------------------------------------------------
// pruneOldDailyMemoryLogs tests
// ---------------------------------------------------------------------------

describe("pruneOldDailyMemoryLogs", () => {
  it("returns 0 when memory/ directory does not exist", async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-ws-"));
    try {
      const deleted = await pruneOldDailyMemoryLogs(freshDir);
      expect(deleted).toBe(0);
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it("deletes daily log files older than maxAgeMs", async () => {
    const memDir = path.join(tmpDir, "memory");

    // Write three dated files in the past
    await fs.writeFile(path.join(memDir, "2020-01-01.md"), "old log 1", "utf-8");
    await fs.writeFile(path.join(memDir, "2020-06-15.md"), "old log 2", "utf-8");
    // Write a recent file (far future date — never gets deleted)
    await fs.writeFile(path.join(memDir, "2099-12-31.md"), "recent log", "utf-8");
    // Write a non-dated file that must be preserved
    await fs.writeFile(path.join(memDir, "session-context.md"), "context", "utf-8");

    const deleted = await pruneOldDailyMemoryLogs(tmpDir, DAILY_MEMORY_LOG_MAX_AGE_MS, Date.now());
    expect(deleted).toBe(2);

    // Old files gone
    await expect(fs.access(path.join(memDir, "2020-01-01.md"))).rejects.toThrow();
    await expect(fs.access(path.join(memDir, "2020-06-15.md"))).rejects.toThrow();

    // Recent and non-dated files survive
    await expect(fs.access(path.join(memDir, "2099-12-31.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(memDir, "session-context.md"))).resolves.toBeUndefined();
  });

  it("does not delete files inside memory/archive/ subdirectory", async () => {
    const memDir = path.join(tmpDir, "memory");
    const archiveDir = path.join(memDir, "archive", "2020-01");
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, "2020-01-01.md"), "archived content", "utf-8");

    // Only files in memory/ root are matched — subdirectories are skipped
    const deleted = await pruneOldDailyMemoryLogs(tmpDir, DAILY_MEMORY_LOG_MAX_AGE_MS, Date.now());
    expect(deleted).toBe(0);

    // Archive file untouched
    await expect(fs.access(path.join(archiveDir, "2020-01-01.md"))).resolves.toBeUndefined();
  });

  it("preserves recent daily logs within the retention window", async () => {
    const memDir = path.join(tmpDir, "memory");
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const recentStr = recentDate.toISOString().slice(0, 10);
    await fs.writeFile(path.join(memDir, `${recentStr}.md`), "recent content", "utf-8");

    const deleted = await pruneOldDailyMemoryLogs(tmpDir, DAILY_MEMORY_LOG_MAX_AGE_MS, Date.now());
    expect(deleted).toBe(0);

    await expect(fs.access(path.join(memDir, `${recentStr}.md`))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildNewDiary tests
// ---------------------------------------------------------------------------

import { buildNewDiary, extractTailExcerpt, CONTINUITY_PENDING_FILENAME } from "./diary-archive.js";

describe("buildNewDiary", () => {
  const template = "# Diary\n\n> Your reflective journal.\n";

  it("includes PREVIOUS_ARCHIVE marker with archive reference", () => {
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", "");
    expect(result).toContain(
      "<!-- PREVIOUS_ARCHIVE: memory/archive/2026-03/diary-2026-03-20.md -->",
    );
  });

  it("includes blockquoted archive path reference", () => {
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", "");
    expect(result).toContain("> Archived to: `memory/archive/2026-03/diary-2026-03-20.md`");
  });

  it("includes Previous Period section", () => {
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", "");
    expect(result).toContain("## Previous Period");
  });

  it("blockquotes excerpt lines when excerpt is non-empty", () => {
    const excerpt = "### 2026-03-19 — Reflection\n\nSome deep thoughts here.";
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", excerpt);
    expect(result).toContain("> ### 2026-03-19 — Reflection");
    expect(result).toContain("> Some deep thoughts here.");
  });

  it("shows '_(no entries)_' for empty excerpt", () => {
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", "");
    expect(result).toContain("> _(no entries)_");
  });

  it("preserves template content at the start", () => {
    const result = buildNewDiary(template, "memory/archive/2026-03/diary-2026-03-20.md", "");
    expect(result.startsWith("# Diary")).toBe(true);
    expect(result).toContain("> Your reflective journal.");
  });
});

describe("extractTailExcerpt", () => {
  it("extracts the last N lines from content", () => {
    const content = "line1\nline2\nline3\nline4\nline5\n";
    const excerpt = extractTailExcerpt(content, 3);
    expect(excerpt).toBe("line3\nline4\nline5");
  });

  it("returns full content when fewer lines than requested", () => {
    const content = "line1\nline2\n";
    const excerpt = extractTailExcerpt(content, 10);
    expect(excerpt).toBe("line1\nline2");
  });

  it("skips trailing blank lines", () => {
    const content = "line1\nline2\n\n\n";
    const excerpt = extractTailExcerpt(content, 5);
    expect(excerpt).toBe("line1\nline2");
  });
});

// ---------------------------------------------------------------------------
// CONTINUITY_PENDING_FILENAME constant test
// ---------------------------------------------------------------------------

describe("CONTINUITY_PENDING_FILENAME", () => {
  it("is exported and has the expected value", () => {
    expect(CONTINUITY_PENDING_FILENAME).toBe(".diary-continuity-pending");
  });
});
