import { describe, expect, it } from "vitest";
import { applySourceBoostToResults, getSourceBoostMultiplier } from "./source-boost.js";

const BOOST = 1.15;

describe("source-boost", () => {
  describe("getSourceBoostMultiplier", () => {
    it.each([
      ["MEMORY.md", BOOST],
      ["some/nested/MEMORY.md", BOOST],
      ["memory/diary.md", BOOST],
      ["memory/diary/2026-03-15.md", BOOST],
      ["memory/projects.md", BOOST],
      ["memory/relationships.md", BOOST],
      ["memory/2026-02-10.md", BOOST],
      ["memory/knowledge/crypto-analysis.md", BOOST],
      ["agents/dan/memory/knowledge/trading-patterns.md", BOOST],
      ["IDENTITY.md", BOOST],
      ["some/path/IDENTITY.md", BOOST],
      ["identity-scratchpad.md", BOOST],
      ["nested/identity-scratchpad.md", BOOST],
      ["WORKING.md", BOOST],
      ["deep/nested/WORKING.md", BOOST],
    ])("boosts knowledge file '%s' → %s×", (path, expected) => {
      expect(getSourceBoostMultiplier(path)).toBeCloseTo(expected);
    });

    it.each([
      ["sessions/thread.jsonl", 1.0],
      ["README.md", 1.0],
      ["src/index.ts", 1.0],
      ["docs/guide.md", 1.0],
      ["not-memory/file.md", 1.0],
      ["MEMORY.txt", 1.0],
      ["memoryX/file.md", 1.0],
    ])("does not boost non-knowledge file '%s'", (path, expected) => {
      expect(getSourceBoostMultiplier(path)).toBeCloseTo(expected);
    });
  });

  describe("applySourceBoostToResults", () => {
    it("boosts knowledge file scores by multiplier", () => {
      const results = [
        { path: "MEMORY.md", score: 0.8, snippet: "a", source: "memory" },
        { path: "sessions/chat.jsonl", score: 0.9, snippet: "b", source: "sessions" },
        { path: "memory/diary.md", score: 0.7, snippet: "c", source: "memory" },
      ];

      const boosted = applySourceBoostToResults(results);

      expect(boosted[0]?.score).toBeCloseTo(0.8 * BOOST);
      expect(boosted[1]?.score).toBeCloseTo(0.9); // no boost
      expect(boosted[2]?.score).toBeCloseTo(0.7 * BOOST);
    });

    it("does not mutate original results", () => {
      const original = [{ path: "MEMORY.md", score: 0.5, snippet: "x", source: "memory" }];
      const boosted = applySourceBoostToResults(original);

      expect(original[0]?.score).toBe(0.5);
      expect(boosted[0]?.score).toBeCloseTo(0.5 * BOOST);
    });

    it("preserves all result properties", () => {
      const results = [
        {
          path: "memory/projects.md",
          score: 0.6,
          snippet: "projects",
          source: "memory",
          startLine: 10,
          endLine: 20,
        },
      ];

      const boosted = applySourceBoostToResults(results);

      expect(boosted[0]).toEqual(
        expect.objectContaining({
          path: "memory/projects.md",
          snippet: "projects",
          source: "memory",
          startLine: 10,
          endLine: 20,
        }),
      );
    });

    it("returns empty array for empty input", () => {
      expect(applySourceBoostToResults([])).toEqual([]);
    });
  });
});
