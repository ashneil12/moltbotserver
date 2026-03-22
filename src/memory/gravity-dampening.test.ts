import { describe, expect, it } from "vitest";
import { applyGravityDampening, extractKeyTerms } from "./gravity-dampening.js";

function makeResult(snippet: string, score: number) {
  return { path: "memory/test.md", startLine: 1, endLine: 5, snippet, score, source: "memory" };
}

describe("gravity-dampening", () => {
  describe("extractKeyTerms", () => {
    it("extracts non-stopword terms", () => {
      const terms = extractKeyTerms("Stripe webhook configuration");
      expect(terms.has("stripe")).toBe(true);
      expect(terms.has("webhook")).toBe(true);
      expect(terms.has("configuration")).toBe(true);
    });

    it("filters out stopwords", () => {
      const terms = extractKeyTerms("the quick brown fox is running");
      expect(terms.has("the")).toBe(false);
      expect(terms.has("is")).toBe(false);
      expect(terms.has("quick")).toBe(true);
      expect(terms.has("brown")).toBe(true);
      expect(terms.has("fox")).toBe(true);
      expect(terms.has("running")).toBe(true);
    });

    it("filters single-character tokens", () => {
      const terms = extractKeyTerms("a b c hello");
      expect(terms.has("a")).toBe(false);
      expect(terms.has("b")).toBe(false);
      expect(terms.has("hello")).toBe(true);
    });

    it("normalizes to lowercase", () => {
      const terms = extractKeyTerms("STRIPE Webhook");
      expect(terms.has("stripe")).toBe(true);
      expect(terms.has("webhook")).toBe(true);
    });

    it("returns empty set for all-stopwords query", () => {
      const terms = extractKeyTerms("the is a of in");
      expect(terms.size).toBe(0);
    });
  });

  describe("applyGravityDampening", () => {
    it("penalizes high-scoring results with no term overlap", () => {
      const results = [makeResult("Twilio SMS integration and API calls", 0.8)];
      const dampened = applyGravityDampening(results, "Stripe webhook secret");

      expect(dampened[0]?.score).toBeCloseTo(0.8 * 0.5);
    });

    it("does not penalize results with term overlap", () => {
      const results = [makeResult("Stripe webhook secret configuration", 0.8)];
      const dampened = applyGravityDampening(results, "Stripe webhook secret");

      expect(dampened[0]?.score).toBeCloseTo(0.8);
    });

    it("does not penalize results below score threshold", () => {
      const results = [makeResult("Twilio SMS integration", 0.15)];
      const dampened = applyGravityDampening(results, "Stripe webhook", {
        scoreThreshold: 0.2,
      });

      expect(dampened[0]?.score).toBeCloseTo(0.15);
    });

    it("skips dampening for all-stopword queries", () => {
      const results = [makeResult("Twilio SMS integration", 0.8)];
      const dampened = applyGravityDampening(results, "the is a");

      expect(dampened[0]?.score).toBeCloseTo(0.8);
    });

    it("skips dampening when disabled", () => {
      const results = [makeResult("Twilio SMS integration", 0.8)];
      const dampened = applyGravityDampening(results, "Stripe webhook", {
        enabled: false,
      });

      expect(dampened[0]?.score).toBeCloseTo(0.8);
    });

    it("uses custom penalty factor", () => {
      const results = [makeResult("totally unrelated content here", 0.9)];
      const dampened = applyGravityDampening(results, "Stripe webhook", {
        penalty: 0.3,
      });

      expect(dampened[0]?.score).toBeCloseTo(0.9 * 0.3);
    });

    it("does not mutate original results", () => {
      const original = [makeResult("Twilio SMS integration", 0.8)];
      const originalScore = original[0].score;
      applyGravityDampening(original, "Stripe webhook");

      expect(original[0].score).toBe(originalScore);
    });

    it("returns empty array for empty input", () => {
      expect(applyGravityDampening([], "test query")).toEqual([]);
    });

    it("handles mixed results correctly", () => {
      const results = [
        makeResult("Stripe webhook handling and retry logic", 0.9),
        makeResult("Twilio SMS delivery reports", 0.85),
        makeResult("webhook endpoint authentication", 0.7),
      ];
      const dampened = applyGravityDampening(results, "Stripe webhook");

      // First result: has "stripe" and "webhook" overlap → not dampened
      expect(dampened[0]?.score).toBeCloseTo(0.9);
      // Second result: no overlap → dampened
      expect(dampened[1]?.score).toBeCloseTo(0.85 * 0.5);
      // Third result: has "webhook" overlap → not dampened
      expect(dampened[2]?.score).toBeCloseTo(0.7);
    });
  });
});
