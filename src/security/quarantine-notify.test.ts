import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  notifyQuarantine,
  buildQuarantineSystemEventText,
  resetQuarantineNotifyForTest,
  getQuarantineNotifiedCount,
  type QuarantineNotifyParams,
} from "./quarantine-notify.js";

// Mock the security event journal to avoid I/O
vi.mock("./security-event-journal.js", () => ({
  logSecurityEvent: vi.fn(),
}));

const { logSecurityEvent } = await import("./security-event-journal.js");

function makeParams(overrides?: Partial<QuarantineNotifyParams>): QuarantineNotifyParams {
  return {
    fileName: "suspicious-notes.md",
    filePath: "/home/node/.openclaw/workspace/suspicious-notes.md",
    mtimeMs: 1700000000000,
    riskScore: 82,
    findings: [
      {
        category: "prompt_injection",
        severity: "critical",
        pattern: "ignore.*previous",
        description: "Attempts to override prior instructions",
        weight: 20,
      },
      {
        category: "role_marker",
        severity: "high",
        pattern: "<system>",
        description: "XML role tag injection",
        weight: 15,
      },
    ],
    enqueueSystemEvent: vi.fn(() => true),
    sessionKey: "agent:main:main",
    ...overrides,
  };
}

describe("quarantine-notify", () => {
  beforeEach(() => {
    resetQuarantineNotifyForTest();
    vi.clearAllMocks();
  });

  it("enqueues a system event for quarantined content", () => {
    const params = makeParams();
    const result = notifyQuarantine(params);

    expect(result).toBe(true);
    expect(params.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(params.enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("suspicious-notes.md"),
      { sessionKey: "agent:main:main" },
    );
  });

  it("includes risk score and findings in the system event text", () => {
    const params = makeParams();
    notifyQuarantine(params);

    const call = (params.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = call[0] as string;
    expect(text).toContain("82/100");
    expect(text).toContain("prompt injection");
    expect(text).toContain("role marker");
  });

  it("logs to the security event journal", () => {
    const params = makeParams();
    notifyQuarantine(params);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "content_quarantined",
        source: "workspace_context",
        detail: expect.stringContaining("suspicious-notes.md"),
      }),
    );
  });

  it("deduplicates by file path + mtime", () => {
    const params = makeParams();

    const first = notifyQuarantine(params);
    expect(first).toBe(true);

    const second = notifyQuarantine(params);
    expect(second).toBe(false);

    expect(params.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(getQuarantineNotifiedCount()).toBe(1);
  });

  it("re-notifies when file mtime changes", () => {
    const params = makeParams();
    notifyQuarantine(params);

    const updatedParams = makeParams({ mtimeMs: 1700000099000 });
    const result = notifyQuarantine(updatedParams);

    expect(result).toBe(true);
    expect(updatedParams.enqueueSystemEvent).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate when mtimeMs is undefined", () => {
    const params = makeParams({ mtimeMs: undefined });

    notifyQuarantine(params);
    notifyQuarantine(params);

    // Both should fire because no mtime for dedup
    expect(params.enqueueSystemEvent).toHaveBeenCalledTimes(2);
  });

  it("handles enqueueSystemEvent returning false", () => {
    const params = makeParams({
      enqueueSystemEvent: vi.fn(() => false),
    });

    const result = notifyQuarantine(params);

    expect(result).toBe(false);
    // Still logs to security journal even if event wasn't enqueued
    expect(logSecurityEvent).toHaveBeenCalled();
  });
});

describe("buildQuarantineSystemEventText", () => {
  it("produces a human-readable alert", () => {
    const text = buildQuarantineSystemEventText("evil.md", 95, [
      {
        category: "prompt_injection",
        severity: "critical",
        pattern: "test",
        description: "test finding",
        weight: 20,
      },
    ]);

    expect(text).toContain("evil.md");
    expect(text).toContain("95/100");
    expect(text).toContain("prompt injection");
    expect(text).toContain("proactively inform the user");
  });

  it("deduplicates finding categories", () => {
    const text = buildQuarantineSystemEventText("file.md", 80, [
      {
        category: "prompt_injection",
        severity: "critical",
        pattern: "a",
        description: "a",
        weight: 20,
      },
      {
        category: "prompt_injection",
        severity: "high",
        pattern: "b",
        description: "b",
        weight: 15,
      },
      {
        category: "role_marker",
        severity: "high",
        pattern: "c",
        description: "c",
        weight: 15,
      },
    ]);

    // Should list each category once
    const occurrences = (text.match(/prompt injection/g) || []).length;
    expect(occurrences).toBe(1);
    expect(text).toContain("role marker");
  });
});
