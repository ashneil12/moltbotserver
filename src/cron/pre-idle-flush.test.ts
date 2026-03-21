import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import type { RunCronAgentTurnResult } from "./isolated-agent.js";
import {
  isHumanSession,
  isEligibleForPreIdleFlush,
  runPreIdleFlushSweep,
  startPreIdleFlushTimer,
  stopPreIdleFlushTimer,
  IDLE_FLUSH_THRESHOLD,
  type PreIdleFlushDeps,
} from "./pre-idle-flush.js";

// ---------------------------------------------------------------------------
// isHumanSession
// ---------------------------------------------------------------------------

describe("isHumanSession", () => {
  const baseEntry: SessionEntry = {
    sessionId: "test-session",
    updatedAt: Date.now() - 3_600_000,
    totalTokens: 5000,
    chatType: "direct",
  };

  it("returns true for direct chat sessions", () => {
    expect(isHumanSession("agent:main:dm:user1", baseEntry)).toBe(true);
  });

  it("returns true for group chat sessions", () => {
    const groupEntry = { ...baseEntry, chatType: "group" as const };
    expect(isHumanSession("agent:main:group:chat1", groupEntry)).toBe(true);
  });

  it("returns true for channel chat sessions", () => {
    const channelEntry = { ...baseEntry, chatType: "channel" as const };
    expect(isHumanSession("agent:main:channel:ch1", channelEntry)).toBe(true);
  });

  it("returns true for thread sessions identified by key marker", () => {
    // Thread sessions may have chatType "group" or undefined, but key has :thread:
    const threadEntry: SessionEntry = {
      sessionId: "thread-1",
      updatedAt: Date.now(),
      totalTokens: 5000,
    };
    expect(isHumanSession("agent:main:thread:topic1", threadEntry)).toBe(true);
  });

  it("returns true for topic sessions identified by key marker", () => {
    const topicEntry: SessionEntry = {
      sessionId: "topic-1",
      updatedAt: Date.now(),
      totalTokens: 5000,
    };
    expect(isHumanSession("agent:main:topic:topic1", topicEntry)).toBe(true);
  });

  it("returns false for session keys containing :cron:", () => {
    expect(isHumanSession("agent:main:cron:job1", baseEntry)).toBe(false);
  });

  it("returns false for session keys containing :run:", () => {
    expect(isHumanSession("agent:main:cron:job1:run:abc-123", baseEntry)).toBe(false);
  });

  it("returns false for session keys starting with __pre-reset-flush:", () => {
    expect(isHumanSession("__pre-reset-flush:agent:main:dm:user1", baseEntry)).toBe(false);
  });

  it("returns false for session keys starting with __pre-idle-flush:", () => {
    expect(isHumanSession("__pre-idle-flush:agent:main:dm:user1", baseEntry)).toBe(false);
  });

  it("returns false for session keys containing :hook:", () => {
    expect(isHumanSession("agent:main:hook:webhook1", baseEntry)).toBe(false);
  });

  it("returns false for session keys containing heartbeat", () => {
    expect(isHumanSession("agent:main:heartbeat", baseEntry)).toBe(false);
  });

  it("returns false for sessions with no chatType and no thread key marker", () => {
    const noChatType: SessionEntry = {
      sessionId: "orphan",
      updatedAt: Date.now(),
      totalTokens: 5000,
    };
    expect(isHumanSession("agent:main:something", noChatType)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEligibleForPreIdleFlush
// ---------------------------------------------------------------------------

describe("isEligibleForPreIdleFlush", () => {
  const now = Date.now();
  const idleMinutes = 60; // 1 hour idle timeout
  const thresholdMs = idleMinutes * 60_000 * IDLE_FLUSH_THRESHOLD; // 48 minutes

  const baseEntry: SessionEntry = {
    sessionId: "test-session",
    // Idle for 50 minutes — past the 80% threshold (48 min) but not expired (60 min)
    updatedAt: now - 50 * 60_000,
    totalTokens: 5000,
    chatType: "direct",
  };

  it("returns true for human idle-mode sessions approaching timeout", () => {
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: baseEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(true);
  });

  it("returns false for sessions not in idle mode (no idleMinutes)", () => {
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: baseEntry,
        nowMs: now,
        idleMinutes: undefined,
      }),
    ).toBe(false);
  });

  it("returns false for sessions with low token count", () => {
    const lowTokenEntry = { ...baseEntry, totalTokens: 500 };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: lowTokenEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("returns false for sessions recently active (not yet near timeout)", () => {
    const recentEntry = { ...baseEntry, updatedAt: now - 10 * 60_000 }; // 10 min ago
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: recentEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("returns false for sessions already past idle expiry", () => {
    const expiredEntry = { ...baseEntry, updatedAt: now - 90 * 60_000 }; // 90 min ago
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: expiredEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("returns false for sessions already flushed since last activity", () => {
    const flushedEntry = {
      ...baseEntry,
      preResetFlushAt: baseEntry.updatedAt + 1000, // flushed after last activity
    };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: flushedEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("returns true for sessions flushed before last activity (new content since flush)", () => {
    const reflushedEntry = {
      ...baseEntry,
      preResetFlushAt: baseEntry.updatedAt - 10_000, // flushed before last activity
    };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: reflushedEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(true);
  });

  it("returns false for cron sessions", () => {
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:cron:job1",
        entry: baseEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("returns false for sessions without chatType or thread marker", () => {
    const noChatType: SessionEntry = {
      ...baseEntry,
      chatType: undefined,
    };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:something",
        entry: noChatType,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(false);
  });

  it("handles exact threshold boundary (at exactly 80% idle)", () => {
    const boundaryEntry = {
      ...baseEntry,
      updatedAt: now - thresholdMs, // exactly at the threshold
    };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: boundaryEntry,
        nowMs: now,
        idleMinutes,
      }),
    ).toBe(true);
  });

  it("handles very large idle windows (4 days like Brad's config)", () => {
    const fourDayIdle = 5760; // minutes
    const justPastThreshold = {
      ...baseEntry,
      // 4 days * 0.8 = 3.2 days, plus 1 minute
      updatedAt: now - (fourDayIdle * 60_000 * IDLE_FLUSH_THRESHOLD + 60_000),
    };
    expect(
      isEligibleForPreIdleFlush({
        sessionKey: "agent:main:dm:user1",
        entry: justPastThreshold,
        nowMs: now,
        idleMinutes: fourDayIdle,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPreIdleFlushSweep
// ---------------------------------------------------------------------------

describe("runPreIdleFlushSweep", () => {
  let mockRunIsolatedAgentJob: PreIdleFlushDeps["runIsolatedAgentJob"];
  let mockLog: PreIdleFlushDeps["log"];

  beforeEach(() => {
    mockRunIsolatedAgentJob = vi
      .fn<PreIdleFlushDeps["runIsolatedAgentJob"]>()
      .mockResolvedValue({ status: "ok" } as unknown as RunCronAgentTurnResult);
    mockLog = {
      info: vi.fn<PreIdleFlushDeps["log"]["info"]>(),
      warn: vi.fn<PreIdleFlushDeps["log"]["warn"]>(),
    };
  });

  it("returns correct result shape", async () => {
    const deps: PreIdleFlushDeps = {
      cfg: {} as PreIdleFlushDeps["cfg"],
      resolveSessionStorePath: () => "/nonexistent/sessions.json",
      runIsolatedAgentJob: mockRunIsolatedAgentJob,
      log: mockLog,
    };

    const result = await runPreIdleFlushSweep(deps);
    expect(result).toHaveProperty("flushed");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("scanned");
    expect(typeof result.flushed).toBe("number");
    expect(typeof result.skipped).toBe("number");
    expect(typeof result.errors).toBe("number");
    expect(typeof result.scanned).toBe("number");
  });

  it("reports zero flushed when no eligible sessions", async () => {
    const deps: PreIdleFlushDeps = {
      cfg: {} as PreIdleFlushDeps["cfg"],
      resolveSessionStorePath: () => "/nonexistent/sessions.json",
      runIsolatedAgentJob: mockRunIsolatedAgentJob,
      log: mockLog,
    };

    const result = await runPreIdleFlushSweep(deps);
    expect(result.flushed).toBe(0);
    expect(result.errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

describe("pre-idle flush timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopPreIdleFlushTimer();
  });

  afterEach(() => {
    stopPreIdleFlushTimer();
    vi.useRealTimers();
  });

  it("starts and stops without errors", () => {
    const log: PreIdleFlushDeps["log"] = {
      info: vi.fn<PreIdleFlushDeps["log"]["info"]>(),
      warn: vi.fn<PreIdleFlushDeps["log"]["warn"]>(),
    };
    const deps = {
      cfg: {} as PreIdleFlushDeps["cfg"],
      resolveSessionStorePath: () => "/nonexistent/sessions.json",
      runIsolatedAgentJob: vi
        .fn<PreIdleFlushDeps["runIsolatedAgentJob"]>()
        .mockResolvedValue({ status: "ok" } as unknown as RunCronAgentTurnResult),
      log,
      sweepIntervalMs: 60_000,
    };

    startPreIdleFlushTimer(deps);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMs: 60_000 }),
      expect.stringContaining("timer started"),
    );

    stopPreIdleFlushTimer();
  });

  it("stopPreIdleFlushTimer is safe to call multiple times", () => {
    stopPreIdleFlushTimer();
    stopPreIdleFlushTimer();
    // No error
  });

  it("replaces existing timer on repeated start", () => {
    const log: PreIdleFlushDeps["log"] = {
      info: vi.fn<PreIdleFlushDeps["log"]["info"]>(),
      warn: vi.fn<PreIdleFlushDeps["log"]["warn"]>(),
    };
    const deps = {
      cfg: {} as PreIdleFlushDeps["cfg"],
      resolveSessionStorePath: () => "/nonexistent/sessions.json",
      runIsolatedAgentJob: vi
        .fn<PreIdleFlushDeps["runIsolatedAgentJob"]>()
        .mockResolvedValue({ status: "ok" } as unknown as RunCronAgentTurnResult),
      log,
      sweepIntervalMs: 60_000,
    };

    startPreIdleFlushTimer(deps);
    startPreIdleFlushTimer(deps); // Should not error or create double timers

    expect(log.info).toHaveBeenCalledTimes(2); // Two "timer started" messages
    stopPreIdleFlushTimer();
  });
});
