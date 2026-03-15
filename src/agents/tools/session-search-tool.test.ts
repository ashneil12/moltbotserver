import { describe, expect, it } from "vitest";
import type { SessionSearchResult } from "../../auto-reply/reply/session-search.js";
import { expandQuery, mergeSearchResults, truncateAroundMatches } from "./session-search-tool.js";

// ---------------------------------------------------------------------------
// truncateAroundMatches
// ---------------------------------------------------------------------------

describe("truncateAroundMatches", () => {
  it("returns full text when under maxChars", () => {
    const text = "Short message about Docker";
    expect(truncateAroundMatches(text, "Docker", 1000)).toBe(text);
  });

  it("centers window around first query match", () => {
    // Build a long string with a distinctive keyword in the middle
    const prefix = "A".repeat(500);
    const keyword = "UNIQUE_KEYWORD_HERE";
    const suffix = "B".repeat(500);
    const fullText = prefix + keyword + suffix;

    const result = truncateAroundMatches(fullText, "UNIQUE_KEYWORD_HERE", 200);
    expect(result).toContain("UNIQUE_KEYWORD_HERE");
    expect(result.length).toBeLessThan(fullText.length);
  });

  it("adds truncation markers when content is trimmed", () => {
    const fullText = "A".repeat(100) + "KEYWORD" + "B".repeat(100);
    const result = truncateAroundMatches(fullText, "KEYWORD", 50);

    // Should have at least one truncation marker
    expect(result).toMatch(/\.\.\.\[.*truncated\]\.\.\./);
  });

  it("falls back to start when no query term matches", () => {
    const fullText = "X".repeat(200);
    const result = truncateAroundMatches(fullText, "nonexistent", 50);

    // Should start from the beginning (no earlier-truncated marker)
    expect(result).not.toContain("[earlier conversation truncated]");
    // Should have the later-truncated marker
    expect(result).toContain("[later conversation truncated]");
  });
});

// ---------------------------------------------------------------------------
// expandQuery
// ---------------------------------------------------------------------------

describe("expandQuery", () => {
  it("returns empty array for empty query", () => {
    expect(expandQuery("")).toEqual([]);
    expect(expandQuery("   ")).toEqual([]);
  });

  it("returns original for single short word", () => {
    const result = expandQuery("hi");
    expect(result).toContain("hi");
    // Only the original since the word is too short for OR expansion
    expect(result).toHaveLength(1);
  });

  it("returns original + OR-expanded for multi-word queries", () => {
    const result = expandQuery("docker build configuration");
    expect(result.length).toBeGreaterThan(1);
    // First variant is always the original
    expect(result[0]).toBe("docker build configuration");
    // Second should be OR-expanded
    expect(result[1]).toContain("OR");
  });

  it("passes through quoted phrases intact", () => {
    const result = expandQuery('"exact phrase"');
    expect(result).toContain('"exact phrase"');
  });

  it("passes through queries with existing boolean operators", () => {
    const result = expandQuery("docker OR kubernetes");
    // Should not double-wrap with OR
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("docker OR kubernetes");
  });
});

// ---------------------------------------------------------------------------
// mergeSearchResults
// ---------------------------------------------------------------------------

describe("mergeSearchResults", () => {
  const makeResult = (sessionId: string, content: string, rank: number): SessionSearchResult => ({
    sessionId,
    agentId: "agent-1",
    role: "user",
    content,
    timestamp: Date.now(),
    rank,
  });

  it("returns empty for empty input", () => {
    expect(mergeSearchResults([])).toEqual([]);
    expect(mergeSearchResults([[]])).toEqual([]);
  });

  it("returns single set unchanged", () => {
    const results = [makeResult("s1", "hello", 1)];
    expect(mergeSearchResults([results])).toEqual(results);
  });

  it("deduplicates by sessionId+content", () => {
    const r1 = makeResult("s1", "hello", 1);
    const r2 = makeResult("s1", "hello", 2); // duplicate

    const merged = mergeSearchResults([[r1], [r2]]);
    expect(merged).toHaveLength(1);
  });

  it("keeps best rank when deduplicating", () => {
    const r1 = makeResult("s1", "hello", 5);
    const r2 = makeResult("s1", "hello", 2); // better rank

    const merged = mergeSearchResults([[r1], [r2]]);
    expect(merged[0].rank).toBe(2);
  });

  it("preserves distinct results from multiple sets", () => {
    const r1 = makeResult("s1", "hello", 1);
    const r2 = makeResult("s2", "world", 2);

    const merged = mergeSearchResults([[r1], [r2]]);
    expect(merged).toHaveLength(2);
  });
});
