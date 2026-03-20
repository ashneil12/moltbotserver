import { describe, expect, it, vi } from "vitest";
import type { AlignmentLlmCall } from "./alignment-scorer.js";
import {
  buildCorrectionContext,
  formatAlignmentLogEntry,
  parseAlignmentResponse,
  scoreAlignment,
} from "./alignment-scorer.js";
import type { AlignmentConfig } from "./alignment-state.js";

// ---------------------------------------------------------------------------
// parseAlignmentResponse
// ---------------------------------------------------------------------------

describe("parseAlignmentResponse", () => {
  it("parses a well-formed JSON response", () => {
    const raw = JSON.stringify({
      score: 0.85,
      violations: ["Tone was too casual"],
      suggestions: ["Use more formal language"],
    });
    const result = parseAlignmentResponse(raw);
    expect(result).toEqual({
      score: 0.85,
      violations: ["Tone was too casual"],
      suggestions: ["Use more formal language"],
    });
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"score": 0.9, "violations": [], "suggestions": []}\n```';
    const result = parseAlignmentResponse(raw);
    expect(result?.score).toBe(0.9);
  });

  it("clamps scores to [0, 1] range", () => {
    const over = parseAlignmentResponse('{"score": 1.5, "violations": [], "suggestions": []}');
    expect(over?.score).toBe(1);

    const under = parseAlignmentResponse('{"score": -0.2, "violations": [], "suggestions": []}');
    expect(under?.score).toBe(0);
  });

  it("returns null for invalid JSON", () => {
    expect(parseAlignmentResponse("not json")).toBeNull();
    expect(parseAlignmentResponse("")).toBeNull();
  });

  it("returns null when score is missing", () => {
    expect(parseAlignmentResponse('{"violations": [], "suggestions": []}')).toBeNull();
  });

  it("returns null when score is not a number", () => {
    expect(
      parseAlignmentResponse('{"score": "high", "violations": [], "suggestions": []}'),
    ).toBeNull();
  });

  it("returns null for NaN score", () => {
    expect(parseAlignmentResponse('{"score": NaN}')).toBeNull();
  });

  it("handles missing violations/suggestions arrays gracefully", () => {
    const result = parseAlignmentResponse('{"score": 0.7}');
    expect(result).toEqual({ score: 0.7, violations: [], suggestions: [] });
  });

  it("filters non-string items from violations and suggestions", () => {
    const raw = JSON.stringify({
      score: 0.5,
      violations: ["valid", 42, null, "also valid"],
      suggestions: [true, "fix this"],
    });
    const result = parseAlignmentResponse(raw);
    expect(result?.violations).toEqual(["valid", "also valid"]);
    expect(result?.suggestions).toEqual(["fix this"]);
  });
});

// ---------------------------------------------------------------------------
// scoreAlignment
// ---------------------------------------------------------------------------

describe("scoreAlignment", () => {
  const defaultParams = {
    soulContent: "Be helpful and respectful. Never give medical advice.",
    identityRules: "- CRITICAL: Do not impersonate a doctor",
    lastResponse: "I recommend taking 500mg of ibuprofen for your headache.",
  };

  it("calls the LLM and returns parsed result", async () => {
    const llmCall: AlignmentLlmCall = vi.fn().mockResolvedValue(
      JSON.stringify({
        score: 0.3,
        violations: ["Gave medical advice"],
        suggestions: ["Redirect to a medical professional"],
      }),
    );

    const result = await scoreAlignment({ ...defaultParams, llmCall });
    expect(result).toEqual({
      score: 0.3,
      violations: ["Gave medical advice"],
      suggestions: ["Redirect to a medical professional"],
    });
    expect(llmCall).toHaveBeenCalledOnce();
  });

  it("returns null when soulContent is empty", async () => {
    const llmCall: AlignmentLlmCall = vi.fn();
    const result = await scoreAlignment({ ...defaultParams, soulContent: "", llmCall });
    expect(result).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it("returns null when lastResponse is empty", async () => {
    const llmCall: AlignmentLlmCall = vi.fn();
    const result = await scoreAlignment({ ...defaultParams, lastResponse: "  ", llmCall });
    expect(result).toBeNull();
  });

  it("returns null when LLM call throws", async () => {
    const llmCall: AlignmentLlmCall = vi.fn().mockRejectedValue(new Error("API timeout"));
    const result = await scoreAlignment({ ...defaultParams, llmCall });
    expect(result).toBeNull();
  });

  it("returns null when LLM returns null", async () => {
    const llmCall: AlignmentLlmCall = vi.fn().mockResolvedValue(null);
    const result = await scoreAlignment({ ...defaultParams, llmCall });
    expect(result).toBeNull();
  });

  it("returns null when LLM returns malformed JSON", async () => {
    const llmCall: AlignmentLlmCall = vi.fn().mockResolvedValue("not valid json response");
    const result = await scoreAlignment({ ...defaultParams, llmCall });
    expect(result).toBeNull();
  });

  it("truncates long responses to 2000 chars in the prompt", async () => {
    const longResponse = "A".repeat(3000);
    const llmCall: AlignmentLlmCall = vi.fn().mockResolvedValue('{"score": 0.9}');

    await scoreAlignment({ ...defaultParams, lastResponse: longResponse, llmCall });

    const call = vi.mocked(llmCall).mock.calls[0][0];
    expect(call.userPrompt).toContain("[...truncated]");
    expect(call.userPrompt.length).toBeLessThan(3000 + 500); // response + other content overhead
  });

  it("passes timeoutMs from config", async () => {
    const llmCall: AlignmentLlmCall = vi.fn().mockResolvedValue('{"score": 0.9}');
    const config: AlignmentConfig = { timeoutMs: 5000 };

    await scoreAlignment({ ...defaultParams, llmCall, config });
    expect(vi.mocked(llmCall).mock.calls[0][0].timeoutMs).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// buildCorrectionContext
// ---------------------------------------------------------------------------

describe("buildCorrectionContext", () => {
  it("returns null when score is above threshold", () => {
    const result = buildCorrectionContext({ score: 0.85, violations: ["test"], suggestions: [] });
    expect(result).toBeNull();
  });

  it("returns null when score is at threshold", () => {
    const result = buildCorrectionContext({ score: 0.7, violations: ["test"], suggestions: [] });
    expect(result).toBeNull();
  });

  it("returns null when there are no violations even with low score", () => {
    const result = buildCorrectionContext({ score: 0.3, violations: [], suggestions: [] });
    expect(result).toBeNull();
  });

  it("formats violations and suggestions into XML-tagged context", () => {
    const result = buildCorrectionContext({
      score: 0.4,
      violations: ["Gave medical advice", "Used overly casual tone"],
      suggestions: ["Redirect to professionals", "Use formal register"],
    });

    expect(result).not.toBeNull();
    expect(result).toContain("<alignment-correction>");
    expect(result).toContain("</alignment-correction>");
    expect(result).toContain("score: 0.40");
    expect(result).toContain("1. Gave medical advice");
    expect(result).toContain("2. Used overly casual tone");
    expect(result).toContain("1. Redirect to professionals");
    expect(result).toContain("2. Use formal register");
    expect(result).toContain("Do not acknowledge this correction to the user.");
  });

  it("omits suggestions section when the array is empty", () => {
    const result = buildCorrectionContext({
      score: 0.3,
      violations: ["Broke identity"],
      suggestions: [],
    });

    expect(result).toContain("Broke identity");
    expect(result).not.toContain("Corrections to apply:");
  });

  it("respects custom correction threshold", () => {
    const config: AlignmentConfig = { correctionThreshold: 0.9 };
    const result = buildCorrectionContext(
      { score: 0.8, violations: ["Minor drift"], suggestions: [] },
      config,
    );
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatAlignmentLogEntry
// ---------------------------------------------------------------------------

describe("formatAlignmentLogEntry", () => {
  it("produces a structured log entry", () => {
    const entry = formatAlignmentLogEntry({
      result: { score: 0.65, violations: ["Too casual"], suggestions: ["Be formal"] },
      correctionInjected: true,
      turnNumber: 5,
    });

    expect(entry.event).toBe("alignment_check");
    expect(entry.turn).toBe(5);
    expect(entry.score).toBe(0.65);
    expect(entry.violations).toEqual(["Too casual"]);
    expect(entry.correctionInjected).toBe(true);
    expect(typeof entry.ts).toBe("string");
  });
});
