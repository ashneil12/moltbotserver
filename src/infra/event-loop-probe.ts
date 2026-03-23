/**
 * Event Loop Liveness Probe — detect degraded-but-alive gateway states.
 *
 * A Node.js process can respond to HTTP health checks while the event loop
 * is severely lagged (e.g. 5s+ delays), making the agent unusable. This
 * probe uses `perf_hooks.monitorEventLoopDelay()` to measure p99 latency
 * and flags degradation before Docker's HTTP healthcheck catches it.
 *
 * Thresholds:
 * - warn:  p99 > 500ms  — noticeable agent response lag
 * - fail:  p99 > 2000ms — agent effectively unusable
 *
 * Integrated into the health sentinel via doctorProbes.checkEventLoopHealth.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { CheckResult } from "../logging/diagnostics-toolkit.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const WARN_THRESHOLD_MS = 500;
const FAIL_THRESHOLD_MS = 2000;
const HISTOGRAM_RESOLUTION_MS = 20;

// ═══════════════════════════════════════════════════════════════════════════
// Singleton histogram (starts measuring on first import)
// ═══════════════════════════════════════════════════════════════════════════

let histogram: IntervalHistogram | null = null;

/**
 * Start the event loop delay monitor. Safe to call multiple times (idempotent).
 * Should be called early in gateway startup.
 */
export function startEventLoopMonitor(): void {
  if (histogram) {
    return;
  }
  histogram = monitorEventLoopDelay({ resolution: HISTOGRAM_RESOLUTION_MS });
  histogram.enable();
}

/**
 * Stop the event loop delay monitor and discard accumulated data.
 * Primarily for tests.
 */
export function stopEventLoopMonitor(): void {
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check event loop health by reading the p99 delay from the histogram.
 *
 * Returns a `CheckResult` compatible with the health sentinel's probe system.
 * Resets the histogram after each read so that each sentinel cycle gets a
 * fresh measurement window.
 */
export function checkEventLoopHealth(opts?: {
  warnThresholdMs?: number;
  failThresholdMs?: number;
}): CheckResult {
  const warnMs = opts?.warnThresholdMs ?? WARN_THRESHOLD_MS;
  const failMs = opts?.failThresholdMs ?? FAIL_THRESHOLD_MS;

  if (!histogram) {
    return {
      name: "process.event_loop_delay",
      status: "skip",
      detail: "Event loop monitor not started",
    };
  }

  // p99 in nanoseconds → milliseconds
  const p99Ns = histogram.percentile(99);
  const p99Ms = Math.round(p99Ns / 1_000_000);
  const minMs = Math.round(histogram.min / 1_000_000);
  const maxMs = Math.round(histogram.max / 1_000_000);
  const meanMs = Math.round(histogram.mean / 1_000_000);

  // Reset for the next measurement window
  histogram.reset();

  const detail = `p99=${p99Ms}ms mean=${meanMs}ms min=${minMs}ms max=${maxMs}ms`;

  if (p99Ms >= failMs) {
    return {
      name: "process.event_loop_delay",
      status: "fail",
      detail: `Event loop severely degraded: ${detail} (threshold: ${failMs}ms)`,
    };
  }

  if (p99Ms >= warnMs) {
    return {
      name: "process.event_loop_delay",
      status: "warn",
      detail: `Event loop lag elevated: ${detail} (threshold: ${warnMs}ms)`,
    };
  }

  return {
    name: "process.event_loop_delay",
    status: "pass",
    detail,
  };
}
