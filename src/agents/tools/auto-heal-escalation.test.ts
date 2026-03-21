import { describe, it, expect } from "vitest";
import {
  buildEscalationMessage,
  buildSuccessNotification,
  type EscalationContext,
} from "./auto-heal-escalation.js";

describe("auto-heal-escalation", () => {
  describe("buildEscalationMessage", () => {
    const baseContext: EscalationContext = {
      errorMessage: "TypeError: Cannot read properties of undefined (reading 'split')",
      targetFile: "src/agents/tools/web-fetch.ts",
      subagentAttempts: 3,
      mainAgentAttempts: 0,
      approachesTried: [
        "Added null check before split()",
        "Wrapped in try/catch with fallback",
        "Refactored to use optional chaining",
      ],
      toolContext: "web_fetch",
      rolledBack: true,
      isRecurring: false,
    };

    it("generates plain-English body without code jargon", () => {
      const msg = buildEscalationMessage(baseContext);
      expect(msg.body).toContain("🔧");
      // Should not contain raw error text
      expect(msg.body).not.toContain("TypeError");
      expect(msg.body).not.toContain("undefined");
      // Should contain human-friendly description
      expect(msg.body).toContain("web_fetch");
      expect(msg.body).toContain("rolled back");
    });

    it("presents fix options BEFORE disable option", () => {
      const msg = buildEscalationMessage(baseContext);

      // Find the indices of each option type
      const fixOptionIdx = msg.options.findIndex((o) => o.actionId === "retry-research");
      const explainIdx = msg.options.findIndex((o) => o.actionId === "explain-simple");
      const techIdx = msg.options.findIndex((o) => o.actionId === "save-technical");
      const pauseIdx = msg.options.findIndex((o) => o.actionId === "pause-tool");

      // Fix options should come before pause
      expect(fixOptionIdx).toBeLessThan(pauseIdx);
      expect(explainIdx).toBeLessThan(pauseIdx);
      expect(techIdx).toBeLessThan(pauseIdx);

      // Pause should be the LAST option
      expect(pauseIdx).toBe(msg.options.length - 1);
    });

    it("always has pause-tool as the last option", () => {
      const msg = buildEscalationMessage(baseContext);
      const lastOption = msg.options[msg.options.length - 1];
      expect(lastOption.actionId).toBe("pause-tool");
      expect(lastOption.emoji).toBe("⏸️");
    });

    it("includes try-again-later for timeout errors", () => {
      const timeoutContext: EscalationContext = {
        ...baseContext,
        errorMessage: "ECONNREFUSED 127.0.0.1:3000 — connection timeout",
      };

      const msg = buildEscalationMessage(timeoutContext);
      const retryLater = msg.options.find((o) => o.actionId === "retry-later");
      expect(retryLater).toBeTruthy();
      // retry-later should still be before pause
      const retryIdx = msg.options.findIndex((o) => o.actionId === "retry-later");
      const pauseIdx = msg.options.findIndex((o) => o.actionId === "pause-tool");
      expect(retryIdx).toBeLessThan(pauseIdx);
    });

    it("does not include retry-later for non-transient errors", () => {
      const msg = buildEscalationMessage(baseContext);
      const retryLater = msg.options.find((o) => o.actionId === "retry-later");
      expect(retryLater).toBeUndefined();
    });

    it("mentions recurring error count when applicable", () => {
      const recurringContext: EscalationContext = {
        ...baseContext,
        isRecurring: true,
        occurrenceCount: 7,
      };

      const msg = buildEscalationMessage(recurringContext);
      expect(msg.body).toContain("7 times");
    });

    it("includes total attempt count in body", () => {
      const msg = buildEscalationMessage(baseContext);
      expect(msg.body).toContain("3 different approaches");
    });

    it("generates technical details payload", () => {
      const msg = buildEscalationMessage(baseContext);
      expect(msg.technicalDetails).toContain("Auto-Heal Technical Report");
      expect(msg.technicalDetails).toContain("web-fetch.ts");
      expect(msg.technicalDetails).toContain("Approaches Tried");
      expect(msg.technicalDetails).toContain("null check");
    });

    it("option numbers are sequential starting from 1", () => {
      const msg = buildEscalationMessage(baseContext);
      for (let i = 0; i < msg.options.length; i++) {
        expect(msg.options[i].number).toBe(i + 1);
      }
    });
  });

  describe("buildSuccessNotification", () => {
    it("generates a brief FYI message", () => {
      const msg = buildSuccessNotification({
        targetFile: "src/agents/tools/web-fetch.ts",
        approach: "Added null check before split()",
        humanSummary: "Fixed the web scraper's response parser",
      });

      expect(msg).toContain("✅");
      expect(msg).toContain("web-fetch.ts");
      expect(msg).toContain("Fixed the web scraper's response parser");
      expect(msg).toContain("BACKGROUND_FIXES.md");
    });

    it("uses approach as fallback when no humanSummary", () => {
      const msg = buildSuccessNotification({
        targetFile: "src/agents/tools/cron-tool.ts",
        approach: "Handle missing schedule field",
      });

      expect(msg).toContain("Handle missing schedule field");
    });
  });
});
