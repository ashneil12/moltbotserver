import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const loggerMocks = vi.hoisted(() => ({
  logWarn: vi.fn(),
}));
vi.mock("../logger.js", () => loggerMocks);

const eventLogMocks = vi.hoisted(() => {
  const logFn = vi.fn();
  const queryFn = vi.fn((..._args: unknown[]) => [] as unknown[]);
  return {
    createEventLogger: vi.fn(() => ({ log: logFn, query: queryFn })),
    _logFn: logFn,
    _queryFn: queryFn,
  };
});
vi.mock("../logging/event-log.js", () => eventLogMocks);

// Must import after mocks
import {
  logSecurityEvent,
  querySecurityEvents,
  resetSecurityEventJournalForTest,
} from "./security-event-journal.js";

/**
 * Wait for the lazy dynamic import() to settle. The mock resolves
 * synchronously but the .then() microtask still needs one event-loop
 * tick to propagate to LazyEventLogger._cached.
 */
const flushImport = () => new Promise<void>((r) => setTimeout(r, 20));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("security-event-journal", () => {
  // Let the module-level LazyEventLogger init settle once, then keep it
  // alive across all tests (resetForTest would require re-awaiting init
  // every time, which creates flaky ordering).
  beforeAll(async () => {
    await flushImport();
  });

  beforeEach(() => {
    eventLogMocks._logFn.mockClear();
    eventLogMocks._queryFn.mockClear();
    loggerMocks.logWarn.mockClear();
  });

  // ── logSecurityEvent ────────────────────────────────────────────────

  it("logSecurityEvent never throws", () => {
    expect(() =>
      logSecurityEvent({
        type: "secret_redacted",
        patterns: ["openai_key"],
        source: "test",
      }),
    ).not.toThrow();
  });

  it("logSecurityEvent handles all event types without throwing", () => {
    for (const type of [
      "secret_redacted",
      "content_quarantined",
      "injection_detected",
      "audit_finding",
    ] as const) {
      expect(() => logSecurityEvent({ type, source: "test" })).not.toThrow();
    }
  });

  it("logs secret_redacted events to console via logWarn", () => {
    logSecurityEvent({
      type: "secret_redacted",
      patterns: ["openai_key", "stripe_key"],
      source: "normalize-reply",
    });

    expect(loggerMocks.logWarn).toHaveBeenCalledOnce();
    expect(loggerMocks.logWarn.mock.calls[0]?.[0]).toContain("openai_key, stripe_key");
    expect(loggerMocks.logWarn.mock.calls[0]?.[0]).toContain("normalize-reply");
  });

  it("does NOT logWarn for non-secret_redacted event types", () => {
    logSecurityEvent({ type: "content_quarantined", source: "test" });
    logSecurityEvent({ type: "injection_detected", source: "test" });
    logSecurityEvent({ type: "audit_finding", source: "test" });

    expect(loggerMocks.logWarn).not.toHaveBeenCalled();
  });

  it("logs structured event with correct event name and level", () => {
    logSecurityEvent({
      type: "content_quarantined",
      source: "web-fetch",
      detail: "suspicious iframe",
    });

    expect(eventLogMocks._logFn).toHaveBeenCalledOnce();
    const call = eventLogMocks._logFn.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      event: "security.content_quarantined",
      level: "info",
      subsystem: "agentguard",
      data: expect.objectContaining({
        source: "web-fetch",
        detail: "suspicious iframe",
      }),
    });
  });

  it("uses 'warn' level for secret_redacted events", () => {
    logSecurityEvent({
      type: "secret_redacted",
      patterns: ["api_key"],
      source: "test",
    });

    const call = eventLogMocks._logFn.mock.calls[0]?.[0];
    expect(call?.level).toBe("warn");
    expect(call?.event).toBe("security.secret_redacted");
  });

  it("includes extra data in structured event", () => {
    logSecurityEvent({
      type: "audit_finding",
      source: "scan",
      extra: { riskScore: 75, fileName: "test.md" },
    });

    const call = eventLogMocks._logFn.mock.calls[0]?.[0];
    expect(call?.data?.riskScore).toBe(75);
    expect(call?.data?.fileName).toBe("test.md");
  });

  it("defaults patterns to empty array and source to 'unknown'", () => {
    logSecurityEvent({ type: "injection_detected" });

    const call = eventLogMocks._logFn.mock.calls[0]?.[0];
    expect(call?.data?.patterns).toEqual([]);
    expect(call?.data?.source).toBe("unknown");
  });

  // ── querySecurityEvents ─────────────────────────────────────────────

  it("querySecurityEvents returns an array (empty when no logger)", () => {
    // Temporarily reset to simulate unavailable logger
    resetSecurityEventJournalForTest();
    const results = querySecurityEvents({ type: "secret_redacted" });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("querySecurityEvents delegates to logger.query with correct event prefix", async () => {
    // Re-init after prior test's reset
    await flushImport();

    querySecurityEvents({ type: "content_quarantined", limit: 50 });

    expect(eventLogMocks._queryFn).toHaveBeenCalledOnce();
    const call = eventLogMocks._queryFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.event).toBe("security.content_quarantined");
    expect(call?.limit).toBe(50);
  });

  it("querySecurityEvents uses 'security.' prefix when no type specified", () => {
    querySecurityEvents();

    const call = eventLogMocks._queryFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.event).toBe("security.");
    expect(call?.limit).toBe(100); // default
  });

  it("querySecurityEvents passes since date filter", () => {
    const since = new Date(Date.now() - 3600_000);

    querySecurityEvents({ since, limit: 10 });

    const call = eventLogMocks._queryFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.since).toBe(since);
  });
});
