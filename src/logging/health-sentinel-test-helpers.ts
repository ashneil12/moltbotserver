/**
 * Shared mock factories for Health Sentinel tests.
 *
 * Centralizes mock creation for HealthSummary, HealthCheckReport, and SentinelDeps
 * used across health-sentinel.test.ts, health-sentinel-sidecars.test.ts, and
 * health-sentinel-browsers.test.ts.
 */

import { vi } from "vitest";
import type { ChannelHealthSummary, HealthSummary } from "../commands/health.js";
import type { CheckResult, HealthCheckReport } from "./diagnostics-toolkit.js";
import type { SentinelDeps } from "./health-sentinel-types.js";

/**
 * Create a mock HealthSummary with optional channel overrides.
 * Defaults to a healthy system with no active channels.
 */
export function createMockHealthSummary(
  channels: Record<string, Partial<ChannelHealthSummary>> = {},
): HealthSummary {
  return {
    ok: true,
    ts: Date.now(),
    durationMs: 100,
    channels: channels as Record<string, ChannelHealthSummary>,
    channelOrder: Object.keys(channels),
    channelLabels: {},
    heartbeatSeconds: 30,
    defaultAgentId: "default",
    agents: [],
    sessions: { path: "/tmp/sessions", count: 0, recent: [] },
  };
}

/**
 * Create a mock HealthCheckReport from partial check results.
 * Automatically computes summary counts and healthy flag.
 */
export function createMockSystemReport(
  checks: Array<Partial<CheckResult>> = [],
): HealthCheckReport {
  const fullChecks: CheckResult[] = checks.map((c) => ({
    name: c.name ?? "unknown",
    status: c.status ?? "pass",
    detail: c.detail ?? "",
    ...c,
  }));

  return {
    timestamp: new Date().toISOString(),
    healthy: fullChecks.every((c) => c.status === "pass" || c.status === "skip"),
    summary: {
      pass: fullChecks.filter((c) => c.status === "pass").length,
      fail: fullChecks.filter((c) => c.status === "fail").length,
      warn: fullChecks.filter((c) => c.status === "warn").length,
      skip: fullChecks.filter((c) => c.status === "skip").length,
    },
    checks: fullChecks,
  };
}

/**
 * Create a mock SentinelDeps with sensible defaults and optional overrides.
 * All function deps are vi.fn() mocks for easy assertion.
 */
export function createMockDeps(overrides?: Partial<SentinelDeps>): SentinelDeps {
  return {
    getHealthSnapshot: vi.fn(async () => createMockHealthSummary()),
    runHealthCheck: vi.fn(async () => createMockSystemReport()),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    resolveMainSessionKey: vi.fn(() => "main"),
    nowMs: () => Date.now(),
    ...overrides,
  };
}
