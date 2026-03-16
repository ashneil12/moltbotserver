import { describe, expect, it } from "vitest";
import {
  logSecurityEvent,
  querySecurityEvents,
  resetSecurityEventJournalForTest,
} from "./security-event-journal.js";

// The security event journal uses a lazy-loaded event logger. In tests, the
// logger may not be initialized, so we verify that the public API never throws
// regardless of logger state.

describe("security-event-journal", () => {
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

  it("querySecurityEvents returns an array (empty when no logger)", () => {
    resetSecurityEventJournalForTest();
    const results = querySecurityEvents({ type: "secret_redacted" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("querySecurityEvents with since filter returns an array", () => {
    const results = querySecurityEvents({
      since: new Date(Date.now() - 3600_000),
      limit: 10,
    });
    expect(Array.isArray(results)).toBe(true);
  });
});
