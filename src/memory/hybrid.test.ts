import { describe, expect, it } from "vitest";
import { bm25RankToScore, buildFtsQuery, mergeHybridResults } from "./hybrid.js";

describe("memory hybrid helpers", () => {
  it("buildFtsQuery tokenizes and AND-joins", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
    expect(buildFtsQuery("FOO_bar baz-1")).toBe('"FOO_bar" AND "baz" AND "1"');
    expect(buildFtsQuery("金银价格")).toBe('"金银价格"');
    expect(buildFtsQuery("価格 2026年")).toBe('"価格" AND "2026年"');
    expect(buildFtsQuery("   ")).toBeNull();
  });

  it("bm25RankToScore is monotonic and clamped", () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1);
    expect(bm25RankToScore(1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(10)).toBeLessThan(bm25RankToScore(1));
    expect(bm25RankToScore(-100)).toBeCloseTo(1, 1);
  });

  it("bm25RankToScore preserves FTS5 BM25 relevance ordering", () => {
    const strongest = bm25RankToScore(-4.2);
    const middle = bm25RankToScore(-2.1);
    const weakest = bm25RankToScore(-0.5);

    expect(strongest).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(weakest);
    expect(strongest).not.toBe(middle);
    expect(middle).not.toBe(weakest);
  });

  it("mergeHybridResults unions by id and combines weighted scores", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.7,
      textWeight: 0.3,
      gravityDampening: { enabled: false },
      hubDampening: { enabled: false },
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.9,
        },
      ],
      keyword: [
        {
          id: "b",
          path: "memory/b.md",
          startLine: 3,
          endLine: 4,
          source: "memory",
          snippet: "kw-b",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.path === "memory/a.md");
    const b = merged.find((r) => r.path === "memory/b.md");
    expect(a?.score).toBeCloseTo(0.7 * 0.9 * 1.15);
    expect(b?.score).toBeCloseTo(0.3 * 1.0 * 1.15);
  });

  it("mergeHybridResults prefers keyword snippet when ids overlap", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.5,
      textWeight: 0.5,
      gravityDampening: { enabled: false },
      hubDampening: { enabled: false },
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.2,
        },
      ],
      keyword: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "kw-a",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.snippet).toBe("kw-a");
    expect(merged[0]?.score).toBeCloseTo((0.5 * 0.2 + 0.5 * 1.0) * 1.15);
  });

  it("mergeHybridResults applies source-aware boost to knowledge files", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 1,
      textWeight: 0,
      temporalDecay: { enabled: false },
      gravityDampening: { enabled: false },
      hubDampening: { enabled: false },
      vector: [
        {
          id: "knowledge",
          path: "MEMORY.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "agent knowledge",
          vectorScore: 0.7,
        },
        {
          id: "generic",
          path: "docs/readme.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "generic doc",
          vectorScore: 0.75,
        },
      ],
      keyword: [],
    });

    expect(merged).toHaveLength(2);
    const knowledge = merged.find((r) => r.path === "MEMORY.md");
    const generic = merged.find((r) => r.path === "docs/readme.md");
    // MEMORY.md at 0.7 * 1.15 = 0.805 should outrank generic at 0.75 * 1.0
    expect(knowledge?.score).toBeCloseTo(0.7 * 1.15);
    expect(generic?.score).toBeCloseTo(0.75);
    expect(knowledge?.score ?? 0).toBeGreaterThan(generic?.score ?? 0);
    expect(merged[0]?.path).toBe("MEMORY.md");
  });

  it("mergeHybridResults applies Q-value boost to high-Q chunks", async () => {
    const qValueBoosts = new Map();
    qValueBoosts.set("high-q", { chunkId: "high-q", qValue: 1.5, retrievalCount: 10 });
    qValueBoosts.set("low-q", { chunkId: "low-q", qValue: 0.7, retrievalCount: 10 });

    const merged = await mergeHybridResults({
      vectorWeight: 1,
      textWeight: 0,
      temporalDecay: { enabled: false },
      gravityDampening: { enabled: false },
      hubDampening: { enabled: false },
      qValueBoosts,
      vector: [
        {
          id: "high-q",
          path: "docs/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "high quality",
          vectorScore: 0.7,
        },
        {
          id: "low-q",
          path: "docs/b.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "low quality",
          vectorScore: 0.8,
        },
      ],
      keyword: [],
    });

    expect(merged).toHaveLength(2);
    const highQ = merged.find((r) => r.path === "docs/a.md");
    const lowQ = merged.find((r) => r.path === "docs/b.md");
    // high-q: 0.7 × 1.5 = 1.05; low-q: 0.8 × 0.7 = 0.56
    expect(highQ?.score).toBeCloseTo(0.7 * 1.5);
    expect(lowQ?.score).toBeCloseTo(0.8 * 0.7);
    expect(highQ?.score ?? 0).toBeGreaterThan(lowQ?.score ?? 0);
    expect(merged[0]?.path).toBe("docs/a.md");
  });

  it("mergeHybridResults passes through unchanged without qValueBoosts", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 1,
      textWeight: 0,
      temporalDecay: { enabled: false },
      gravityDampening: { enabled: false },
      hubDampening: { enabled: false },
      // No qValueBoosts param
      vector: [
        {
          id: "a",
          path: "docs/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "test",
          vectorScore: 0.9,
        },
      ],
      keyword: [],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.score).toBeCloseTo(0.9);
  });
});
