import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForTransportReady } from "./transport-ready.js";

// Perf: `sleepWithAbort` uses `node:timers/promises` which isn't controlled by fake timers.
// Route sleeps through global `setTimeout` so tests can advance time deterministically.
vi.mock("./backoff.js", () => ({
  sleepWithAbort: async (ms: number) => {
    if (ms <= 0) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  },
}));

function createRuntime() {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
}

describe("waitForTransportReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns when the check succeeds and logs after the delay", async () => {
    const runtime = createRuntime();
    let attempts = 0;
    const readyPromise = waitForTransportReady({
      label: "test transport",
      timeoutMs: 220,
<<<<<<< HEAD
      // Deterministic: first attempt at t=0 won't log; second attempt at t=50 will.
      logAfterMs: 1,
=======
      logAfterMs: 60,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      logIntervalMs: 1_000,
      pollIntervalMs: 50,
      runtime,
      check: async () => {
        attempts += 1;
        if (attempts > 2) {
          return { ok: true };
        }
        return { ok: false, error: "not ready" };
      },
    });

<<<<<<< HEAD
    await vi.advanceTimersByTimeAsync(200);
=======
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(50);
    }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    await readyPromise;
    expect(runtime.error).toHaveBeenCalled();
  });

  it("throws after the timeout", async () => {
<<<<<<< HEAD
    const runtime = createRuntime();
=======
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const waitPromise = waitForTransportReady({
      label: "test transport",
      timeoutMs: 110,
      logAfterMs: 0,
      logIntervalMs: 1_000,
      pollIntervalMs: 50,
      runtime,
      check: async () => ({ ok: false, error: "still down" }),
    });
<<<<<<< HEAD
    const asserted = expect(waitPromise).rejects.toThrow("test transport not ready");
    await vi.advanceTimersByTimeAsync(200);
    await asserted;
=======
    await vi.advanceTimersByTimeAsync(200);
    await expect(waitPromise).rejects.toThrow("test transport not ready");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    expect(runtime.error).toHaveBeenCalled();
  });

  it("returns early when aborted", async () => {
    const runtime = createRuntime();
    const controller = new AbortController();
    controller.abort();
    await waitForTransportReady({
      label: "test transport",
      timeoutMs: 200,
      runtime,
      abortSignal: controller.signal,
      check: async () => ({ ok: false, error: "still down" }),
    });
    expect(runtime.error).not.toHaveBeenCalled();
  });
});
