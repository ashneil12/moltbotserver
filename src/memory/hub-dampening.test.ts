import { describe, expect, it } from "vitest";
import { applyHubDampening } from "./hub-dampening.js";

function makeResult(path: string, score: number) {
  return {
    path,
    score,
    snippet: `content from ${path}`,
    startLine: 1,
    endLine: 5,
    source: "memory",
  };
}

describe("hub-dampening", () => {
  it("penalizes the dominant file when above concentration threshold", () => {
    const results = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.85),
      makeResult("MEMORY.md", 0.8),
      makeResult("memory/diary.md", 0.7),
      makeResult("docs/guide.md", 0.6),
    ];

    // MEMORY.md is 3/5 = 60%, above default 40% threshold
    const dampened = applyHubDampening(results);

    const memoryResults = dampened.filter((r) => r.path === "MEMORY.md");
    const otherResults = dampened.filter((r) => r.path !== "MEMORY.md");

    // MEMORY.md results should be dampened
    for (const r of memoryResults) {
      expect(r.score).toBeLessThan(
        results.find((o) => o.path === r.path && o.score >= r.score)!.score,
      );
    }

    // Other results should not be dampened
    expect(otherResults[0]?.score).toBeCloseTo(0.7);
    expect(otherResults[1]?.score).toBeCloseTo(0.6);
  });

  it("does not penalize when no file exceeds threshold", () => {
    const results = [
      makeResult("memory/a.md", 0.9),
      makeResult("memory/b.md", 0.85),
      makeResult("memory/c.md", 0.8),
      makeResult("memory/d.md", 0.7),
      makeResult("memory/e.md", 0.6),
    ];

    // Each file is 1/5 = 20%, well below 40% threshold
    const dampened = applyHubDampening(results);

    for (let i = 0; i < results.length; i++) {
      expect(dampened[i]?.score).toBeCloseTo(results[i].score);
    }
  });

  it("applies stronger penalty at higher concentrations", () => {
    // 80% concentration
    const highConcentration = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("MEMORY.md", 0.7),
      makeResult("MEMORY.md", 0.6),
      makeResult("other.md", 0.5),
    ];

    // 60% concentration
    const medConcentration = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("MEMORY.md", 0.7),
      makeResult("other.md", 0.6),
      makeResult("another.md", 0.5),
    ];

    const highDampened = applyHubDampening(highConcentration);
    const medDampened = applyHubDampening(medConcentration);

    // Higher concentration should get stronger penalty
    const highRatio = highDampened[0].score / highConcentration[0].score;
    const medRatio = medDampened[0].score / medConcentration[0].score;

    expect(highRatio).toBeLessThan(medRatio);
  });

  it("respects custom configuration", () => {
    const results = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("other.md", 0.7),
    ];

    // 67% concentration, threshold 0.7 → not a hub
    const notDampened = applyHubDampening(results, { concentrationThreshold: 0.7 });
    expect(notDampened[0]?.score).toBeCloseTo(0.9);

    // 67% concentration, threshold 0.3 → is a hub
    const dampened = applyHubDampening(results, { concentrationThreshold: 0.3 });
    expect(dampened[0]?.score).toBeLessThan(0.9);
  });

  it("handles single result without dampening", () => {
    const results = [makeResult("MEMORY.md", 0.9)];
    const dampened = applyHubDampening(results);
    expect(dampened[0]?.score).toBeCloseTo(0.9);
  });

  it("handles empty results", () => {
    expect(applyHubDampening([])).toEqual([]);
  });

  it("does not mutate original results", () => {
    const original = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("MEMORY.md", 0.7),
      makeResult("other.md", 0.6),
      makeResult("another.md", 0.5),
    ];
    const originalScores = original.map((r) => r.score);
    applyHubDampening(original);

    for (let i = 0; i < original.length; i++) {
      expect(original[i].score).toBe(originalScores[i]);
    }
  });

  it("disabled config returns original scores", () => {
    const results = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("MEMORY.md", 0.7),
      makeResult("other.md", 0.6),
    ];
    const dampened = applyHubDampening(results, { enabled: false });
    for (let i = 0; i < results.length; i++) {
      expect(dampened[i]?.score).toBeCloseTo(results[i].score);
    }
  });

  it("all results from same file triggers dampening", () => {
    const results = [
      makeResult("MEMORY.md", 0.9),
      makeResult("MEMORY.md", 0.8),
      makeResult("MEMORY.md", 0.7),
    ];
    const dampened = applyHubDampening(results);

    // 100% concentration, strongest penalty
    for (let i = 0; i < results.length; i++) {
      expect(dampened[i].score).toBeLessThan(results[i].score);
    }
  });
});
