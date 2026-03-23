import { describe, expect, it } from "vitest";
import { onRunError, onRunSuccess, readHealthState, writeHealthState } from "./session-health-integration.js";
import type { SessionEntry } from "../../config/sessions/types.js";

function makeEntry(overrides?: Partial<SessionEntry>): SessionEntry {
  return { sessionId: "test-session", updatedAt: Date.now(), ...overrides };
}

describe("session-health-integration", () => {
  describe("readHealthState", () => {
    it("returns a default healthy state when entry has no healthState", () => {
      const state = readHealthState(makeEntry());
      expect(state.consecutiveErrors).toBe(0);
      expect(state.errorReasons).toEqual([]);
    });

    it("returns a default healthy state for null/undefined entry", () => {
      expect(readHealthState(null).consecutiveErrors).toBe(0);
      expect(readHealthState(undefined).consecutiveErrors).toBe(0);
    });

    it("returns existing healthState when present", () => {
      const entry = makeEntry({
        healthState: { consecutiveErrors: 3, errorReasons: ["timeout"] },
      });
      const state = readHealthState(entry);
      expect(state.consecutiveErrors).toBe(3);
      expect(state.errorReasons).toEqual(["timeout"]);
    });
  });

  describe("writeHealthState", () => {
    it("writes health state to the entry in place", () => {
      const entry = makeEntry();
      const state = { consecutiveErrors: 2, errorReasons: ["error-1", "error-2"] };
      const result = writeHealthState(entry, state);
      expect(entry.healthState).toBe(state);
      expect(result).toBe(entry);
    });
  });

  describe("onRunSuccess", () => {
    it("does nothing for null/undefined entry", () => {
      expect(() => onRunSuccess(null)).not.toThrow();
      expect(() => onRunSuccess(undefined)).not.toThrow();
    });

    it("resets error counter after a successful run", () => {
      const entry = makeEntry({
        healthState: { consecutiveErrors: 3, errorReasons: ["err1", "err2", "err3"] },
      });
      onRunSuccess(entry);
      expect(entry.healthState?.consecutiveErrors).toBe(0);
    });

    it("does not mutate entry if already healthy", () => {
      const entry = makeEntry();
      const originalHealth = entry.healthState;
      onRunSuccess(entry);
      // If no healthState existed, it should not be written (no mutation)
      expect(entry.healthState).toBe(originalHealth);
    });
  });

  describe("onRunError", () => {
    it("returns null for null/undefined entry", () => {
      expect(onRunError(null, "some error")).toBeNull();
      expect(onRunError(undefined, "some error")).toBeNull();
    });

    it("records the error and returns null when below threshold", () => {
      const entry = makeEntry();
      const hint = onRunError(entry, "rate limit");
      // Default threshold is 3, so first error should not produce a hint
      expect(hint).toBeNull();
      expect(entry.healthState?.consecutiveErrors).toBe(1);
      expect(entry.healthState?.errorReasons).toContain("rate limit");
    });

    it("returns a recovery hint when threshold is reached", () => {
      const entry = makeEntry({
        healthState: { consecutiveErrors: 2, errorReasons: ["err1", "err2"] },
      });
      const hint = onRunError(entry, "err3");
      // After 3 consecutive errors, should produce a hint
      expect(hint).not.toBeNull();
      expect(typeof hint).toBe("string");
      expect(entry.healthState?.consecutiveErrors).toBe(3);
    });
  });
});
