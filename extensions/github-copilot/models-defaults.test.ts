import { describe, expect, it } from "vitest";
import { buildCopilotModelDefinition, getDefaultCopilotModelIds } from "./models-defaults.js";

describe("github-copilot model defaults", () => {
  describe("getDefaultCopilotModelIds", () => {
    it("includes claude-sonnet-4.6", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-sonnet-4.6");
    });

    it("includes claude-sonnet-4.5", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-sonnet-4.5");
    });

    it("includes claude-haiku-4-5", () => {
      // Regression: agent was failing with "Unknown model: github-copilot/claude-haiku-4-5"
      // because this model was in the dashboard's static list but missing from the server registry.
      expect(getDefaultCopilotModelIds()).toContain("claude-haiku-4-5");
    });

    it("includes claude-opus-4-5 and claude-opus-4-6", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-opus-4-5");
      expect(getDefaultCopilotModelIds()).toContain("claude-opus-4-6");
    });

    it("returns a mutable copy", () => {
      const a = getDefaultCopilotModelIds();
      const b = getDefaultCopilotModelIds();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("buildCopilotModelDefinition", () => {
    it("builds a valid definition for claude-sonnet-4.6", () => {
      const def = buildCopilotModelDefinition("claude-sonnet-4.6");
      expect(def.id).toBe("claude-sonnet-4.6");
      expect(def.api).toBe("openai-responses");
    });

    it("trims whitespace from model id", () => {
      const def = buildCopilotModelDefinition("  gpt-4o  ");
      expect(def.id).toBe("gpt-4o");
    });

    it("throws on empty model id", () => {
      expect(() => buildCopilotModelDefinition("")).toThrow("Model id required");
      expect(() => buildCopilotModelDefinition("  ")).toThrow("Model id required");
    });
  });
});
