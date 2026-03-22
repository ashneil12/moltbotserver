import { describe, expect, it } from "vitest";
import {
  adjustTemporalDecayHalfLife,
  blendIntentWeights,
  classifyIntent,
} from "./intent-classifier.js";

describe("intent-classifier", () => {
  describe("classifyIntent", () => {
    it.each([
      ["when did we deploy the server", "episodic"],
      ["last time we discussed pricing", "episodic"],
      ["what happened with the migration", "episodic"],
      ["remember when we fixed the auth bug", "episodic"],
      ["recently updated files", "episodic"],
    ] as const)("classifies '%s' as %s", (query, expected) => {
      expect(classifyIntent(query).intent).toBe(expected);
    });

    it.each([
      ["how to set up the database", "procedural"],
      ["steps for deploying to production", "procedural"],
      ["workflow for onboarding", "procedural"],
      ["guide for setting up CI", "procedural"],
      ["how can I configure the webhook", "procedural"],
    ] as const)("classifies '%s' as %s", (query, expected) => {
      expect(classifyIntent(query).intent).toBe(expected);
    });

    it.each([
      ["why did we decide to use Postgres", "decision"],
      ["what did we decide about the API design", "decision"],
      ["rationale for choosing TypeScript", "decision"],
      ["should we use Redis or Memcached", "decision"],
      ["pros and cons of serverless", "decision"],
    ] as const)("classifies '%s' as %s", (query, expected) => {
      expect(classifyIntent(query).intent).toBe(expected);
    });

    it.each([
      ["Stripe webhook configuration", "semantic"],
      ["database schema", "semantic"],
      ["authentication module", "semantic"],
      ["error handling patterns", "semantic"],
    ] as const)("classifies '%s' as semantic (default)", (query, expected) => {
      expect(classifyIntent(query).intent).toBe(expected);
    });

    it("returns semantic for empty or whitespace queries", () => {
      expect(classifyIntent("").intent).toBe("semantic");
      expect(classifyIntent("  ").intent).toBe("semantic");
      expect(classifyIntent("   \n\t  ").intent).toBe("semantic");
    });

    it("returns higher confidence for multi-pattern matches", () => {
      const singleMatch = classifyIntent("recently something");
      const multiMatch = classifyIntent("when did we last time recently");
      expect(multiMatch.confidence).toBeGreaterThanOrEqual(singleMatch.confidence);
    });

    it("returns confidence 0.5 for semantic (no pattern match)", () => {
      const result = classifyIntent("database schema");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("blendIntentWeights", () => {
    it("returns normalized weights", () => {
      const classified = classifyIntent("when did we deploy");
      const blended = blendIntentWeights(classified, 0.7, 0.3);
      expect(blended.vectorWeight + blended.textWeight).toBeCloseTo(1);
    });

    it("shifts vector weight down for episodic queries", () => {
      const classified = classifyIntent("when did we deploy");
      const blended = blendIntentWeights(classified, 0.7, 0.3);
      // Episodic shifts toward 0.5/0.5, so vectorWeight should decrease
      expect(blended.vectorWeight).toBeLessThan(0.7);
      expect(blended.textWeight).toBeGreaterThan(0.3);
    });

    it("keeps weights close to config for semantic intent (low confidence)", () => {
      const classified = classifyIntent("database schema");
      const blended = blendIntentWeights(classified, 0.7, 0.3);
      // Semantic profile is 0.7/0.3 — same as config, so should be ~unchanged
      expect(blended.vectorWeight).toBeCloseTo(0.7, 1);
      expect(blended.textWeight).toBeCloseTo(0.3, 1);
    });

    it("handles edge case of zero weights", () => {
      const classified = classifyIntent("how to deploy");
      const blended = blendIntentWeights(classified, 0, 0);
      // When config weights are both 0, the blend is dominated by the intent
      // profile. For procedural: 0.6/0.4 → normalized sum = 1.0.
      expect(blended.vectorWeight + blended.textWeight).toBeCloseTo(1);
      expect(blended.vectorWeight).toBeGreaterThan(0);
      expect(blended.textWeight).toBeGreaterThan(0);
    });
  });

  describe("adjustTemporalDecayHalfLife", () => {
    it("shortens half-life for episodic queries", () => {
      const classified = classifyIntent("when did we deploy the server");
      const adjusted = adjustTemporalDecayHalfLife(classified, 14);
      expect(adjusted).toBeLessThan(14);
      expect(adjusted).toBeGreaterThanOrEqual(1);
    });

    it("keeps half-life unchanged for procedural queries", () => {
      const classified = classifyIntent("how to set up the database");
      const adjusted = adjustTemporalDecayHalfLife(classified, 14);
      expect(adjusted).toBe(14);
    });

    it("keeps half-life unchanged for semantic queries", () => {
      const classified = classifyIntent("database schema");
      const adjusted = adjustTemporalDecayHalfLife(classified, 14);
      expect(adjusted).toBe(14);
    });

    it("shortens half-life for decision queries", () => {
      const classified = classifyIntent("why did we decide to use Postgres");
      const adjusted = adjustTemporalDecayHalfLife(classified, 14);
      expect(adjusted).toBeLessThan(14);
    });

    it("never returns below 1", () => {
      const classified = classifyIntent("when did we deploy");
      const adjusted = adjustTemporalDecayHalfLife(classified, 1);
      expect(adjusted).toBeGreaterThanOrEqual(1);
    });
  });
});
