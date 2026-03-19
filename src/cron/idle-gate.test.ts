import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_GATE_CONFIG,
  DEFAULT_IDLE_THRESHOLD_MS,
  isInSleepWindow,
  isUserIdle,
  shouldRunIdleJob,
  type IdleGateConfig,
} from "./idle-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Date.now() value for a specific UTC hour. */
function msAtUtcHour(hour: number): number {
  const d = new Date("2026-03-19T00:00:00Z");
  d.setUTCHours(hour, 30, 0, 0); // :30 to avoid boundary edge
  return d.getTime();
}

const now = Date.now();

// ---------------------------------------------------------------------------
// isUserIdle
// ---------------------------------------------------------------------------

describe("isUserIdle", () => {
  const config = DEFAULT_IDLE_GATE_CONFIG;

  it("returns true when user has been idle longer than threshold", () => {
    const lastActivity = now - DEFAULT_IDLE_THRESHOLD_MS - 60_000; // 31 min ago
    expect(isUserIdle({ lastActivityAtMs: lastActivity, nowMs: now, config })).toBe(true);
  });

  it("returns false when user was recently active", () => {
    const lastActivity = now - 5 * 60_000; // 5 min ago
    expect(isUserIdle({ lastActivityAtMs: lastActivity, nowMs: now, config })).toBe(false);
  });

  it("returns false when user is exactly at threshold", () => {
    // Exactly at threshold should still return true (>= comparison)
    const lastActivity = now - DEFAULT_IDLE_THRESHOLD_MS;
    expect(isUserIdle({ lastActivityAtMs: lastActivity, nowMs: now, config })).toBe(true);
  });

  it("returns true when lastActivityAtMs is 0", () => {
    expect(isUserIdle({ lastActivityAtMs: 0, nowMs: now, config })).toBe(true);
  });

  it("returns true when lastActivityAtMs is undefined", () => {
    expect(isUserIdle({ lastActivityAtMs: undefined, nowMs: now, config })).toBe(true);
  });

  it("returns true when lastActivityAtMs is negative", () => {
    expect(isUserIdle({ lastActivityAtMs: -1, nowMs: now, config })).toBe(true);
  });

  it("respects custom threshold", () => {
    const customConfig: IdleGateConfig = { ...config, idleThresholdMs: 10 * 60_000 };
    // 15 min idle, 10 min threshold → idle
    expect(
      isUserIdle({ lastActivityAtMs: now - 15 * 60_000, nowMs: now, config: customConfig }),
    ).toBe(true);
    // 5 min idle, 10 min threshold → not idle
    expect(
      isUserIdle({ lastActivityAtMs: now - 5 * 60_000, nowMs: now, config: customConfig }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInSleepWindow
// ---------------------------------------------------------------------------

describe("isInSleepWindow", () => {
  const config = DEFAULT_IDLE_GATE_CONFIG; // 23:00-07:00 UTC

  it("returns true during night hours (wrap-around: 23-07)", () => {
    expect(isInSleepWindow({ nowMs: msAtUtcHour(23), config })).toBe(true);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(0), config })).toBe(true);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(3), config })).toBe(true);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(6), config })).toBe(true);
  });

  it("returns false during day hours", () => {
    expect(isInSleepWindow({ nowMs: msAtUtcHour(7), config })).toBe(false);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(12), config })).toBe(false);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(18), config })).toBe(false);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(22), config })).toBe(false);
  });

  it("handles non-wrapping window (e.g. 2-6)", () => {
    const dayConfig: IdleGateConfig = {
      ...config,
      sleepWindowStartHour: 2,
      sleepWindowEndHour: 6,
    };
    expect(isInSleepWindow({ nowMs: msAtUtcHour(3), config: dayConfig })).toBe(true);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(5), config: dayConfig })).toBe(true);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(1), config: dayConfig })).toBe(false);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(6), config: dayConfig })).toBe(false);
    expect(isInSleepWindow({ nowMs: msAtUtcHour(12), config: dayConfig })).toBe(false);
  });

  it("returns false when sleep window is not configured", () => {
    const noWindow: IdleGateConfig = {
      ...config,
      sleepWindowStartHour: undefined,
      sleepWindowEndHour: undefined,
    };
    expect(isInSleepWindow({ nowMs: msAtUtcHour(3), config: noWindow })).toBe(false);
  });

  it("returns false when only start is configured", () => {
    const partialConfig: IdleGateConfig = {
      ...config,
      sleepWindowStartHour: 23,
      sleepWindowEndHour: undefined,
    };
    expect(isInSleepWindow({ nowMs: msAtUtcHour(23), config: partialConfig })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldRunIdleJob
// ---------------------------------------------------------------------------

describe("shouldRunIdleJob", () => {
  it("allows job when user is idle (even outside sleep window)", () => {
    const lastActivity = now - DEFAULT_IDLE_THRESHOLD_MS - 60_000;
    expect(
      shouldRunIdleJob({
        lastActivityAtMs: lastActivity,
        nowMs: now,
        config: {
          ...DEFAULT_IDLE_GATE_CONFIG,
          sleepWindowStartHour: undefined,
          sleepWindowEndHour: undefined,
        },
      }),
    ).toBe(true);
  });

  it("allows job during sleep window even if user is active", () => {
    // User was active 2 min ago, but it's 3am (in sleep window)
    const sleepTimeMs = msAtUtcHour(3);
    const lastActivity = sleepTimeMs - 2 * 60_000;
    expect(
      shouldRunIdleJob({
        lastActivityAtMs: lastActivity,
        nowMs: sleepTimeMs,
        config: DEFAULT_IDLE_GATE_CONFIG,
      }),
    ).toBe(true);
  });

  it("blocks job when user is active and outside sleep window", () => {
    const dayTimeMs = msAtUtcHour(14); // 2pm
    const lastActivity = dayTimeMs - 5 * 60_000; // 5 min ago
    expect(
      shouldRunIdleJob({
        lastActivityAtMs: lastActivity,
        nowMs: dayTimeMs,
        config: DEFAULT_IDLE_GATE_CONFIG,
      }),
    ).toBe(false);
  });

  it("uses default config when none provided", () => {
    const dayTimeMs = msAtUtcHour(14);
    const lastActivity = dayTimeMs - 5 * 60_000;
    expect(
      shouldRunIdleJob({
        lastActivityAtMs: lastActivity,
        nowMs: dayTimeMs,
      }),
    ).toBe(false);
  });

  it("allows job with no activity data", () => {
    expect(
      shouldRunIdleJob({
        lastActivityAtMs: undefined,
        nowMs: msAtUtcHour(14),
        config: {
          ...DEFAULT_IDLE_GATE_CONFIG,
          sleepWindowStartHour: undefined,
          sleepWindowEndHour: undefined,
        },
      }),
    ).toBe(true);
  });
});
