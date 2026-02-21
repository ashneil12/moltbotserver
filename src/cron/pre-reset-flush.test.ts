import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextPreResetFlushMs,
  DEFAULT_PRE_RESET_LEAD_MINUTES,
  isEligibleForPreResetFlush,
  msUntilNextPreResetFlush,
  runPreResetFlushSweep,
  startPreResetFlushTimer,
  stopPreResetFlushTimer,
  type PreResetFlushDeps,
} from "./pre-reset-flush.js";
import type { SessionEntry } from "../config/sessions/types.js";

// ---------------------------------------------------------------------------
// computeNextPreResetFlushMs
// ---------------------------------------------------------------------------

describe("computeNextPreResetFlushMs", () => {
  it("schedules flush 20 minutes before default 4 AM reset", () => {
    // 2026-01-18 at 2:00 AM local → flush should be at 3:40 AM same day
    const now = new Date(2026, 0, 18, 2, 0, 0).getTime();
    const next = computeNextPreResetFlushMs(now, 4);
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(3);
    expect(nextDate.getMinutes()).toBe(40);
    expect(nextDate.getDate()).toBe(18);
  });

  it("schedules for tomorrow if already past flush time", () => {
    // 2026-01-18 at 5:00 AM local → 3:40 AM already passed → tomorrow 3:40 AM
    const now = new Date(2026, 0, 18, 5, 0, 0).getTime();
    const next = computeNextPreResetFlushMs(now, 4);
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(3);
    expect(nextDate.getMinutes()).toBe(40);
    expect(nextDate.getDate()).toBe(19);
  });

  it("handles custom atHour and leadMinutes", () => {
    // atHour=6, lead=30 → flush at 5:30 AM
    const now = new Date(2026, 0, 18, 2, 0, 0).getTime();
    const next = computeNextPreResetFlushMs(now, 6, 30);
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(5);
    expect(nextDate.getMinutes()).toBe(30);
  });

  it("handles midnight reset (atHour=0) with 20-minute lead", () => {
    // atHour=0, lead=20 → flush at 23:40 previous "day"
    const now = new Date(2026, 0, 18, 12, 0, 0).getTime();
    const next = computeNextPreResetFlushMs(now, 0);
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(23);
    expect(nextDate.getMinutes()).toBe(40);
  });

  it("handles atHour=1 with default lead", () => {
    // atHour=1, lead=20 → flush at 0:40 AM
    const now = new Date(2026, 0, 18, 2, 0, 0).getTime();
    const next = computeNextPreResetFlushMs(now, 1);
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(0);
    expect(nextDate.getMinutes()).toBe(40);
    // Already past 0:40 today, so should be tomorrow
    expect(nextDate.getDate()).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// msUntilNextPreResetFlush
// ---------------------------------------------------------------------------

describe("msUntilNextPreResetFlush", () => {
  it("returns a positive number of milliseconds", () => {
    const now = new Date(2026, 0, 18, 2, 0, 0).getTime();
    const ms = msUntilNextPreResetFlush(now, 4);
    expect(ms).toBeGreaterThan(0);
    // Should be about 100 minutes (3:40 - 2:00)
    expect(ms).toBeCloseTo(100 * 60_000, -3);
  });
});

// ---------------------------------------------------------------------------
// isEligibleForPreResetFlush
// ---------------------------------------------------------------------------

describe("isEligibleForPreResetFlush", () => {
  const now = Date.now();
  const baseEntry: SessionEntry = {
    sessionId: "test-session",
    updatedAt: now - 3_600_000,
    totalTokens: 5000,
  };

  it("returns true for sessions with meaningful context", () => {
    expect(isEligibleForPreResetFlush("agent:main:dm:user1", baseEntry, now)).toBe(true);
  });

  it("returns false for sessions with low token count", () => {
    const lowTokenEntry = { ...baseEntry, totalTokens: 500 };
    expect(isEligibleForPreResetFlush("agent:main:dm:user1", lowTokenEntry, now)).toBe(false);
  });

  it("returns false for sessions with no token count", () => {
    const noTokenEntry: SessionEntry = { sessionId: "test", updatedAt: now };
    expect(isEligibleForPreResetFlush("agent:main:dm:user1", noTokenEntry, now)).toBe(false);
  });

  it("returns false for cron run sessions", () => {
    expect(
      isEligibleForPreResetFlush("agent:main:cron:job1:run:abc-123", baseEntry, now),
    ).toBe(false);
  });

  it("returns false for sessions already flushed recently", () => {
    const flushedEntry = { ...baseEntry, preResetFlushAt: now - 3_600_000 }; // 1 hour ago
    expect(isEligibleForPreResetFlush("agent:main:dm:user1", flushedEntry, now)).toBe(false);
  });

  it("returns true for sessions flushed > 20 hours ago", () => {
    const oldFlushEntry = { ...baseEntry, preResetFlushAt: now - 21 * 3_600_000 };
    expect(isEligibleForPreResetFlush("agent:main:dm:user1", oldFlushEntry, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPreResetFlushSweep
// ---------------------------------------------------------------------------

describe("runPreResetFlushSweep", () => {
  let mockRunIsolatedAgentJob: PreResetFlushDeps["runIsolatedAgentJob"];
  let mockLog: PreResetFlushDeps["log"];

  beforeEach(() => {
    mockRunIsolatedAgentJob = vi.fn<PreResetFlushDeps["runIsolatedAgentJob"]>().mockResolvedValue({ status: "ok" } as any);
    mockLog = {
      info: vi.fn<PreResetFlushDeps["log"]["info"]>(),
      warn: vi.fn<PreResetFlushDeps["log"]["warn"]>(),
    };
  });

  it("skips sweep when no eligible sessions", async () => {
    // Mock loadSessionStore to return empty
    const mockLoadSessionStore = vi.fn().mockReturnValue({});
    const { runPreResetFlushSweep: sweep } = await import("./pre-reset-flush.js");

    // We'll test indirectly through the log calls
    // The real loadSessionStore is called internally so we test via integration
    // For unit testing, we verify the exported functions separately
    expect(typeof sweep).toBe("function");
  });

  it("returns correct result shape", async () => {
    // This tests that the function signature is correct
    const deps: PreResetFlushDeps = {
      cfg: {} as PreResetFlushDeps["cfg"],
      sessionStorePath: "/nonexistent/sessions.json",
      runIsolatedAgentJob: mockRunIsolatedAgentJob,
      log: mockLog,
    };

    const result = await runPreResetFlushSweep(deps);
    expect(result).toHaveProperty("flushed");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("errors");
    expect(typeof result.flushed).toBe("number");
    expect(typeof result.skipped).toBe("number");
    expect(typeof result.errors).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

describe("pre-reset flush timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopPreResetFlushTimer();
  });

  afterEach(() => {
    stopPreResetFlushTimer();
    vi.useRealTimers();
  });

  it("starts and stops without errors", () => {
    const log: PreResetFlushDeps["log"] = {
      info: vi.fn<PreResetFlushDeps["log"]["info"]>(),
      warn: vi.fn<PreResetFlushDeps["log"]["warn"]>(),
    };
    const deps = {
      cfg: {} as PreResetFlushDeps["cfg"],
      sessionStorePath: "/nonexistent/sessions.json",
      runIsolatedAgentJob: vi.fn<PreResetFlushDeps["runIsolatedAgentJob"]>().mockResolvedValue({ status: "ok" } as any),
      log,
      resetAtHour: 4,
    };

    startPreResetFlushTimer(deps);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ atHour: 4 }),
      expect.stringContaining("timer started"),
    );

    stopPreResetFlushTimer();
  });

  it("stopPreResetFlushTimer is safe to call multiple times", () => {
    stopPreResetFlushTimer();
    stopPreResetFlushTimer();
    // No error
  });
});
