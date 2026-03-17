/**
 * enforce-config-models.test.mjs — Tests for model ID normalization.
 *
 * Tests the normalizeModelId function and CANONICAL_MODEL_IDS map
 * from enforce-config-models.mjs.
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { describe, expect, it } from "vitest";
import { normalizeModelId, CANONICAL_MODEL_IDS } from "./enforce-config-models.mjs";

describe("normalizeModelId", () => {
  it("corrects lowercase MiniMax-M2.5", () => {
    expect(normalizeModelId("minimax/minimax-m2.5")).toBe("minimax/MiniMax-M2.5");
  });

  it("corrects lowercase MiniMax-M2.5-Lightning", () => {
    expect(normalizeModelId("minimax/minimax-m2.5-lightning")).toBe(
      "minimax/MiniMax-M2.5-Lightning",
    );
  });

  it("corrects lowercase MiniMax-M1", () => {
    expect(normalizeModelId("some-provider/minimax-m1")).toBe("some-provider/MiniMax-M1");
  });

  it("passes through already-canonical model IDs", () => {
    expect(normalizeModelId("minimax/MiniMax-M2.5")).toBe("minimax/MiniMax-M2.5");
  });

  it("passes through unknown model IDs", () => {
    expect(normalizeModelId("openai/gpt-4")).toBe("openai/gpt-4");
  });

  it("passes through model refs without a slash", () => {
    expect(normalizeModelId("gpt-4")).toBe("gpt-4");
  });

  it("returns null for null input", () => {
    expect(normalizeModelId(null)).toBe(null);
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeModelId(undefined)).toBe(undefined);
  });

  it("returns empty string for empty input", () => {
    expect(normalizeModelId("")).toBe("");
  });

  it("preserves the provider prefix", () => {
    expect(normalizeModelId("bailian/minimax-m2.5")).toBe("bailian/MiniMax-M2.5");
  });
});

describe("CANONICAL_MODEL_IDS", () => {
  it("contains expected entries", () => {
    expect(CANONICAL_MODEL_IDS["minimax-m2.5"]).toBe("MiniMax-M2.5");
    expect(CANONICAL_MODEL_IDS["minimax-m2.5-lightning"]).toBe("MiniMax-M2.5-Lightning");
    expect(CANONICAL_MODEL_IDS["minimax-m1"]).toBe("MiniMax-M1");
  });

  it("does not contain entries where casing matches", () => {
    // All entries should have lowercase keys that differ from canonical values
    for (const [key, value] of Object.entries(CANONICAL_MODEL_IDS)) {
      expect(key).not.toBe(value);
      expect(key.toLowerCase()).toBe(key);
    }
  });
});
