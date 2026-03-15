import { describe, expect, it } from "vitest";
import {
  buildRecoveryHint,
  createHealthState,
  detectRepeatedPattern,
  isSessionDegraded,
  recordError,
  recordSuccess,
} from "./session-health.js";

describe("session-health", () => {
  describe("createHealthState", () => {
    it("creates a clean state with zero errors", () => {
      const state = createHealthState();
      expect(state.consecutiveErrors).toBe(0);
      expect(state.errorReasons).toEqual([]);
      expect(state.lastErrorAt).toBeUndefined();
    });
  });

  describe("recordSuccess", () => {
    it("resets consecutive errors to 0", () => {
      let state = createHealthState();
      state = recordError(state, "timeout", 1000);
      state = recordError(state, "timeout", 2000);
      expect(state.consecutiveErrors).toBe(2);

      state = recordSuccess(state);
      expect(state.consecutiveErrors).toBe(0);
      expect(state.errorReasons).toEqual([]);
    });

    it("is a no-op when already healthy", () => {
      const state = createHealthState();
      const result = recordSuccess(state);
      expect(result).toBe(state); // same reference — no allocation
    });
  });

  describe("recordError", () => {
    it("increments consecutive error count", () => {
      let state = createHealthState();
      state = recordError(state, "timeout", 1000);
      expect(state.consecutiveErrors).toBe(1);
      expect(state.errorReasons).toEqual(["timeout"]);
      expect(state.lastErrorAt).toBe(1000);

      state = recordError(state, "rate_limit", 2000);
      expect(state.consecutiveErrors).toBe(2);
      expect(state.errorReasons).toEqual(["timeout", "rate_limit"]);
      expect(state.lastErrorAt).toBe(2000);
    });

    it("trims error reasons to circular buffer limit (10)", () => {
      let state = createHealthState();
      for (let i = 0; i < 15; i++) {
        state = recordError(state, `error-${i}`, 1000 + i);
      }
      expect(state.errorReasons).toHaveLength(10);
      // Should retain the last 10
      expect(state.errorReasons[0]).toBe("error-5");
      expect(state.errorReasons[9]).toBe("error-14");
    });
  });

  describe("isSessionDegraded", () => {
    it("returns false when consecutive errors are below threshold", () => {
      let state = createHealthState();
      for (let i = 0; i < 4; i++) {
        state = recordError(state, "timeout", 1000 + i);
      }
      expect(isSessionDegraded(state, undefined, 2000)).toBe(false);
    });

    it("returns true when consecutive errors reach threshold", () => {
      let state = createHealthState();
      const now = 10_000;
      for (let i = 0; i < 5; i++) {
        state = recordError(state, "timeout", now - (5 - i) * 100);
      }
      expect(isSessionDegraded(state, undefined, now)).toBe(true);
    });

    it("returns false when errors are outside time window", () => {
      let state = createHealthState();
      // Errors from 10 minutes ago
      for (let i = 0; i < 5; i++) {
        state = recordError(state, "timeout", 1000 + i);
      }
      // Check 6 minutes later (beyond default 5min window)
      expect(isSessionDegraded(state, undefined, 1000 + 360_000)).toBe(false);
    });

    it("respects custom config thresholds", () => {
      let state = createHealthState();
      const now = 10_000;
      for (let i = 0; i < 3; i++) {
        state = recordError(state, "timeout", now - 100 + i);
      }
      // Below default threshold (5) but above custom (3)
      expect(isSessionDegraded(state, { maxConsecutiveErrors: 3 }, now)).toBe(true);
      expect(isSessionDegraded(state, { maxConsecutiveErrors: 5 }, now)).toBe(false);
    });

    it("resets degradation after a success", () => {
      let state = createHealthState();
      const now = 10_000;
      for (let i = 0; i < 5; i++) {
        state = recordError(state, "timeout", now - 100 + i);
      }
      expect(isSessionDegraded(state, undefined, now)).toBe(true);

      state = recordSuccess(state);
      expect(isSessionDegraded(state, undefined, now)).toBe(false);
    });
  });

  describe("detectRepeatedPattern", () => {
    it("returns null with fewer than 3 errors", () => {
      let state = createHealthState();
      state = recordError(state, "timeout", 1000);
      state = recordError(state, "timeout", 2000);
      expect(detectRepeatedPattern(state)).toBeNull();
    });

    it("returns the repeated reason when 3+ consecutive same errors", () => {
      let state = createHealthState();
      state = recordError(state, "timeout", 1000);
      state = recordError(state, "timeout", 2000);
      state = recordError(state, "timeout", 3000);
      expect(detectRepeatedPattern(state)).toBe("timeout");
    });

    it("returns null when errors are mixed", () => {
      let state = createHealthState();
      state = recordError(state, "timeout", 1000);
      state = recordError(state, "rate_limit", 2000);
      state = recordError(state, "format", 3000);
      expect(detectRepeatedPattern(state)).toBeNull();
    });

    it("only counts consecutive trailing errors, not all occurrences", () => {
      let state = createHealthState();
      // 3 total "timeout" errors, but only 2 are consecutive at the end
      state = recordError(state, "timeout", 1000);
      state = recordError(state, "rate_limit", 2000);
      state = recordError(state, "timeout", 3000);
      state = recordError(state, "timeout", 4000);
      expect(detectRepeatedPattern(state)).toBeNull();
    });
  });

  describe("buildRecoveryHint", () => {
    it("returns null when session is healthy", () => {
      const state = createHealthState();
      expect(buildRecoveryHint(state)).toBeNull();
    });

    it("returns a hint when session is degraded", () => {
      let state = createHealthState();
      const now = 10_000;
      for (let i = 0; i < 5; i++) {
        state = recordError(state, "timeout", now - 100 + i);
      }
      const hint = buildRecoveryHint(state, undefined, now);
      expect(hint).toBeTruthy();
      expect(hint).toContain("5 consecutive errors");
      expect(hint).toContain("Do NOT repeat");
    });

    it("includes repeated pattern info when detected", () => {
      let state = createHealthState();
      const now = 10_000;
      for (let i = 0; i < 5; i++) {
        state = recordError(state, "timeout", now - 100 + i);
      }
      const hint = buildRecoveryHint(state, undefined, now);
      expect(hint).toContain("timeout");
      expect(hint).toContain("not working");
    });

    it("gives generic advice when errors are mixed", () => {
      let state = createHealthState();
      const now = 10_000;
      const reasons = ["timeout", "rate_limit", "format", "unknown", "overloaded"];
      for (let i = 0; i < 5; i++) {
        state = recordError(state, reasons[i], now - 100 + i);
      }
      const hint = buildRecoveryHint(state, undefined, now);
      expect(hint).toContain("simplify");
    });
  });
});
