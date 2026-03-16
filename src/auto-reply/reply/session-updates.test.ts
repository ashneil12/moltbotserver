/**
 * Session updates tests.
 *
 * Tests the custom session management additions:
 *   1. drainFormattedSystemEvents — system event formatting, filtering, timezone handling
 *   2. incrementCompactionCount — compaction counter, token tracking
 *
 * The ensureSkillSnapshot function is heavily integration-dependent (filesystem, watchers)
 * and is tested indirectly through session-freshness.test.ts and the skills test suite.
 * These tests focus on the pure/testable functions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../agents/date-time.js", () => ({
  resolveUserTimezone: vi.fn(() => "America/New_York"),
}));

vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: vi.fn(() => ({ version: 1, skills: [] })),
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  ensureSkillsWatcher: vi.fn(),
  getSkillsSnapshotVersion: vi.fn(() => 0),
}));

const sessionStoreMocks = vi.hoisted(() => ({
  updateSessionStore: vi.fn(
    async (_path: string, updater: (store: Record<string, unknown>) => void) => {
      const store: Record<string, unknown> = {};
      updater(store);
    },
  ),
}));
vi.mock("../../config/sessions.js", () => sessionStoreMocks);

const channelSummaryMocks = vi.hoisted(() => ({
  buildChannelSummary: vi.fn(async (): Promise<string[]> => []),
}));
vi.mock("../../infra/channel-summary.js", () => channelSummaryMocks);

vi.mock("../../infra/format-time/format-datetime.ts", () => ({
  resolveTimezone: vi.fn((tz: string) => tz),
  formatUtcTimestamp: vi.fn((date: Date) =>
    date.toISOString().replace("T", " ").replace("Z", " UTC"),
  ),
  formatZonedTimestamp: vi.fn(
    (date: Date, opts?: { timeZone?: string; displaySeconds?: boolean }) => {
      if (opts?.timeZone) {
        return `${date.toISOString()} [${opts.timeZone}]`;
      }
      return date.toISOString().replace("T", " ").replace("Z", " local");
    },
  ),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: vi.fn(() => ({ eligible: false })),
}));

const systemEventsMocks = vi.hoisted(() => ({
  drainSystemEventEntries: vi.fn((): Array<{ text: string; ts: number }> => []),
}));
vi.mock("../../infra/system-events.js", () => systemEventsMocks);

vi.mock("./session-freshness.js", () => ({
  validateSessionPathFreshness: vi.fn(() => ({ fresh: true })),
}));

import type { OpenClawConfig } from "../../config/config.js";
import { drainFormattedSystemEvents, incrementCompactionCount } from "./session-updates.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
  vi.clearAllMocks();
  systemEventsMocks.drainSystemEventEntries.mockReturnValue([]);
  channelSummaryMocks.buildChannelSummary.mockResolvedValue([]);
}

function mockConfig(overrides: Record<string, unknown> = {}): OpenClawConfig {
  return { ...overrides } as unknown as OpenClawConfig;
}

const TS_2024 = new Date("2024-06-15T10:30:00Z").getTime();

// ── drainFormattedSystemEvents Tests ────────────────────────────────────────

describe("drainFormattedSystemEvents", () => {
  afterEach(() => resetMocks());

  it("returns undefined when no events are queued", async () => {
    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toBeUndefined();
  });

  it("formats system events as 'System:' prefixed lines", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "User connected", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toContain("System:");
    expect(result).toContain("User connected");
  });

  it("filters out 'reason periodic' events", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "reason periodic wake", ts: TS_2024 },
      { text: "User connected", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).not.toContain("periodic");
    expect(result).toContain("User connected");
  });

  it("filters out heartbeat prompt events", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "Read HEARTBEAT.md and check for pending tasks", ts: TS_2024 },
      { text: "Real event", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).not.toContain("HEARTBEAT");
    expect(result).toContain("Real event");
  });

  it("filters out heartbeat poll/wake noise", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "heartbeat poll completed", ts: TS_2024 },
      { text: "heartbeat wake triggered", ts: TS_2024 },
      { text: "User message arrived", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).not.toContain("heartbeat poll");
    expect(result).not.toContain("heartbeat wake");
    expect(result).toContain("User message arrived");
  });

  it("compacts Node: events by stripping last input info", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "Node: browser-proxy connected · last input 2h ago", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toContain("Node: browser-proxy connected");
    expect(result).not.toContain("last input");
  });

  it("prefixes each sub-line of multi-line events with System:", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "Line 1\nLine 2\nLine 3", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    const lines = result!.split("\n");
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.startsWith("System:"))).toBe(true);
  });

  it("includes channel summary for new main sessions", async () => {
    channelSummaryMocks.buildChannelSummary.mockResolvedValue(["Telegram: 3 channels active"]);
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "Session started", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: true,
      isNewSession: true,
    });

    expect(result).toContain("Telegram: 3 channels active");
  });

  it("skips channel summary for non-main sessions", async () => {
    channelSummaryMocks.buildChannelSummary.mockResolvedValue(["Should not appear"]);
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([{ text: "Event", ts: TS_2024 }]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: true,
    });

    expect(result).not.toContain("Should not appear");
  });

  it("skips empty/whitespace events", async () => {
    systemEventsMocks.drainSystemEventEntries.mockReturnValue([
      { text: "", ts: TS_2024 },
      { text: "   ", ts: TS_2024 },
      { text: "Real event", ts: TS_2024 },
    ]);

    const result = await drainFormattedSystemEvents({
      cfg: mockConfig(),
      sessionKey: "test-key",
      isMainSession: false,
      isNewSession: false,
    });

    const lines = result!.split("\n");
    // Should only have the real event
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Real event");
  });
});

// ── incrementCompactionCount Tests ──────────────────────────────────────────

describe("incrementCompactionCount", () => {
  afterEach(() => resetMocks());

  it("returns undefined when sessionStore is missing", async () => {
    const result = await incrementCompactionCount({
      sessionKey: "test-key",
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when sessionKey is missing", async () => {
    const result = await incrementCompactionCount({
      sessionStore: {},
    });

    expect(result).toBeUndefined();
  });

  it("increments compaction count from 0", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 0,
      },
    };

    const result = await incrementCompactionCount({
      sessionStore: store as unknown as Record<
        string,
        import("../../config/sessions.js").SessionEntry
      >,
      sessionKey: "test-key",
    });

    expect(result).toBe(1);
    expect(store["test-key"].compactionCount).toBe(1);
  });

  it("increments compaction count from existing value", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 5,
      },
    };

    const result = await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
    });

    expect(result).toBe(6);
  });

  it("handles missing compactionCount (undefined → 1)", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        // no compactionCount field
      },
    };

    const result = await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
    });

    expect(result).toBe(1);
  });

  it("updates totalTokens when tokensAfter is provided", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 0,
        totalTokens: 50000,
        inputTokens: 30000,
        outputTokens: 20000,
      },
    };

    await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
      tokensAfter: 10000,
    });

    expect(store["test-key"].totalTokens).toBe(10000);
    expect(store["test-key"].totalTokensFresh).toBe(true);
    // Input/output breakdown should be cleared
    expect(store["test-key"].inputTokens).toBeUndefined();
    expect(store["test-key"].outputTokens).toBeUndefined();
  });

  it("does not update tokens when tokensAfter is 0", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 0,
        totalTokens: 50000,
      },
    };

    await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
      tokensAfter: 0,
    });

    // tokensAfter=0 should NOT update token counts
    expect(store["test-key"].totalTokens).toBe(50000);
  });

  it("persists to store file when storePath is provided", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 2,
      },
    };

    await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
      storePath: "/tmp/sessions.json",
    });

    expect(sessionStoreMocks.updateSessionStore).toHaveBeenCalledWith(
      "/tmp/sessions.json",
      expect.any(Function),
    );
  });

  it("does not persist when storePath is not provided", async () => {
    const store: Record<string, Record<string, unknown>> = {
      "test-key": {
        sessionId: "s1",
        updatedAt: Date.now(),
        compactionCount: 0,
      },
    };

    await incrementCompactionCount({
      sessionStore: store as Record<string, never>,
      sessionKey: "test-key",
      // no storePath
    });

    expect(sessionStoreMocks.updateSessionStore).not.toHaveBeenCalled();
  });
});
