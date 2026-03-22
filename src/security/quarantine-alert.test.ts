import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  alertOperatorQuarantine,
  resetQuarantineAlertForTest,
  getAlertCacheSize,
  type QuarantineAlertParams,
} from "./quarantine-alert.js";

function makeParams(overrides?: Partial<QuarantineAlertParams>): QuarantineAlertParams {
  return {
    fileName: "hacked-notes.md",
    filePath: "/home/node/.openclaw/workspace/hacked-notes.md",
    riskScore: 92,
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
        severity: "critical",
        pattern: "ChatML",
        description: "ChatML role marker injection",
        weight: 20,
      },
    ],
    enqueueSystemEvent: vi.fn(() => true),
    sessionKey: "agent:main:main",
    ...overrides,
  };
}

describe("quarantine-alert", () => {
  beforeEach(() => {
    resetQuarantineAlertForTest();
    vi.clearAllMocks();
  });

  it("sends alert for high-severity quarantines (riskScore >= 85)", () => {
    const params = makeParams({ riskScore: 92 });
    const result = alertOperatorQuarantine(params);

    expect(result).toBe(true);
    expect(params.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(params.enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("Security Quarantine Alert"),
      { sessionKey: "agent:main:main" },
    );
  });

  it("does not send alert for moderate quarantines (riskScore < 85)", () => {
    const params = makeParams({ riskScore: 72 });
    const result = alertOperatorQuarantine(params);

    expect(result).toBe(false);
    expect(params.enqueueSystemEvent).not.toHaveBeenCalled();
  });

  it("respects custom alert threshold", () => {
    const params = makeParams({ riskScore: 55, alertThreshold: 50 });
    const result = alertOperatorQuarantine(params);

    expect(result).toBe(true);
  });

  it("rate limits: suppresses duplicate alerts for the same file within 1 hour", () => {
    const params = makeParams();

    const first = alertOperatorQuarantine(params);
    expect(first).toBe(true);

    const second = alertOperatorQuarantine(params);
    expect(second).toBe(false);

    expect(params.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(getAlertCacheSize()).toBe(1);
  });

  it("allows alerts for different files", () => {
    const params1 = makeParams({ filePath: "/workspace/file1.md", fileName: "file1.md" });
    const params2 = makeParams({ filePath: "/workspace/file2.md", fileName: "file2.md" });

    expect(alertOperatorQuarantine(params1)).toBe(true);
    expect(alertOperatorQuarantine(params2)).toBe(true);

    expect(getAlertCacheSize()).toBe(2);
  });

  it("includes file name and risk score in alert message", () => {
    const params = makeParams();
    alertOperatorQuarantine(params);

    const call = (params.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = call[0] as string;
    expect(text).toContain("hacked-notes.md");
    expect(text).toContain("92/100");
  });

  it("includes top findings in alert message", () => {
    const params = makeParams();
    alertOperatorQuarantine(params);

    const call = (params.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = call[0] as string;
    expect(text).toContain("Attempts to override prior instructions");
    expect(text).toContain("ChatML role marker injection");
  });
});
