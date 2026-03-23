import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  checkEventLoopHealth,
} from "./event-loop-probe.js";

describe("event-loop-probe", () => {
  beforeEach(() => {
    stopEventLoopMonitor();
  });

  afterEach(() => {
    stopEventLoopMonitor();
  });

  it("returns skip when monitor is not started", () => {
    const result = checkEventLoopHealth();
    expect(result.name).toBe("process.event_loop_delay");
    expect(result.status).toBe("skip");
    expect(result.detail).toContain("not started");
  });

  it("returns pass for a healthy event loop", async () => {
    startEventLoopMonitor();
    // Let the histogram collect some data
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = checkEventLoopHealth();
    expect(result.name).toBe("process.event_loop_delay");
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("p99=");
    expect(result.detail).toContain("mean=");
  });

  it("resets histogram between checks (fresh measurement window)", async () => {
    startEventLoopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const first = checkEventLoopHealth();
    expect(first.status).toBe("pass");

    // Second immediate call — histogram was just reset, minimal data
    const second = checkEventLoopHealth();
    expect(second.status).toBe("pass");
    // p99 should be very low since histogram was just reset
    expect(second.detail).toContain("p99=");
  });

  it("classifies warn when p99 exceeds warn threshold", async () => {
    startEventLoopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Use very low thresholds to trigger warn
    const result = checkEventLoopHealth({
      warnThresholdMs: 0,
      failThresholdMs: 999999,
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("elevated");
  });

  it("classifies fail when p99 exceeds fail threshold", async () => {
    startEventLoopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Use zero for both thresholds — any p99 > 0 will trigger fail
    const result = checkEventLoopHealth({
      warnThresholdMs: 0,
      failThresholdMs: 0,
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("severely degraded");
  });

  it("is idempotent — calling start twice does not crash", () => {
    startEventLoopMonitor();
    startEventLoopMonitor(); // should be a no-op
    const result = checkEventLoopHealth();
    expect(result.status).not.toBe("skip");
  });

  it("stop then start creates a fresh monitor", async () => {
    startEventLoopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 50));
    stopEventLoopMonitor();

    // After stop, should report skip
    expect(checkEventLoopHealth().status).toBe("skip");

    // Re-start and verify it works again
    startEventLoopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = checkEventLoopHealth();
    expect(result.status).toBe("pass");
  });
});
