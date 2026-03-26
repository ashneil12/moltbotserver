import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const resolveLsofCommandSyncMock = vi.hoisted(() => vi.fn());
const resolveGatewayPortMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => spawnSyncMock(...args),
  };
});

vi.mock("./ports-lsof.js", () => ({
  resolveLsofCommandSync: (...args: unknown[]) => resolveLsofCommandSyncMock(...args),
}));

vi.mock("../config/paths.js", () => ({
  resolveGatewayPort: (...args: unknown[]) => resolveGatewayPortMock(...args),
}));

let __testing: typeof import("./restart-stale-pids.js").__testing;
let cleanStaleGatewayProcessesSync: typeof import("./restart-stale-pids.js").cleanStaleGatewayProcessesSync;
let findGatewayPidsOnPortSync: typeof import("./restart-stale-pids.js").findGatewayPidsOnPortSync;

let currentTimeMs = 0;

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    return {
      ...actual,
      spawnSync: (...args: Parameters<typeof actual.spawnSync>) => spawnSyncMock(...args),
    };
  });
  vi.doMock("./ports-lsof.js", () => ({
    resolveLsofCommandSync: (...args: unknown[]) => resolveLsofCommandSyncMock(...args),
  }));
  vi.doMock("../config/paths.js", () => ({
    resolveGatewayPort: (...args: unknown[]) => resolveGatewayPortMock(...args),
  }));
  ({ __testing, cleanStaleGatewayProcessesSync, findGatewayPidsOnPortSync } =
    await import("./restart-stale-pids.js"));
  spawnSyncMock.mockReset();
  resolveLsofCommandSyncMock.mockReset();
  resolveGatewayPortMock.mockReset();

  currentTimeMs = 0;
  resolveLsofCommandSyncMock.mockReturnValue("/usr/sbin/lsof");
  resolveGatewayPortMock.mockReturnValue(18789);
  __testing.setSleepSyncOverride((ms) => {
    currentTimeMs += ms;
  });
  __testing.setDateNowOverride(() => currentTimeMs);
});

afterEach(() => {
  __testing.setSleepSyncOverride(null);
  __testing.setDateNowOverride(null);
  vi.restoreAllMocks();
});

describe.runIf(process.platform !== "win32")("findGatewayPidsOnPortSync", () => {
  it("parses lsof output and filters non-openclaw/current processes", () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: [
        `p${process.pid}`,
        "copenclaw",
        "p4100",
        "copenclaw-gateway",
        "p4200",
        "cnode",
        "p4300",
        "cOpenClaw",
      ].join("\n"),
    });

    const pids = findGatewayPidsOnPortSync(18789);

    expect(pids).toEqual([4100, 4300]);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP:18789", "-sTCP:LISTEN", "-Fpc"],
      expect.objectContaining({ encoding: "utf8", timeout: 2000 }),
    );
  });

  it("returns empty when lsof fails", () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 1,
      stdout: "",
      stderr: "lsof failed",
    });

    expect(findGatewayPidsOnPortSync(18789)).toEqual([]);
  });
});

describe.runIf(process.platform !== "win32")("cleanStaleGatewayProcessesSync", () => {
  it("kills stale gateway pids discovered on the gateway port", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        error: undefined,
        status: 0,
        stdout: ["p6001", "copenclaw", "p6002", "copenclaw-gateway"].join("\n"),
      })
      .mockReturnValue({
        error: undefined,
        status: 1,
        stdout: "",
      });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const killed = cleanStaleGatewayProcessesSync();

    expect(killed).toEqual([6001, 6002]);
    expect(resolveGatewayPortMock).toHaveBeenCalledWith(undefined, process.env);
    expect(killSpy).toHaveBeenCalledWith(6001, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(6002, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(6001, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(6002, "SIGKILL");
  });

  it("uses explicit port override when provided", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        error: undefined,
        status: 0,
        stdout: ["p7001", "copenclaw"].join("\n"),
      })
      .mockReturnValue({
        error: undefined,
        status: 1,
        stdout: "",
      });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const killed = cleanStaleGatewayProcessesSync(19999);

    expect(killed).toEqual([7001]);
    expect(resolveGatewayPortMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP:19999", "-sTCP:LISTEN", "-Fpc"],
      expect.objectContaining({ encoding: "utf8", timeout: 2000 }),
    );
    expect(killSpy).toHaveBeenCalledWith(7001, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(7001, "SIGKILL");
  });

  it("returns empty when no stale listeners are found", () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: "",
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const killed = cleanStaleGatewayProcessesSync();

    expect(killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });
});

import { triggerOpenClawRestart } from "./restart.js";

describe.runIf(process.platform === "linux")("triggerOpenClawRestart — managed platform", () => {
  const originalEnv = process.env.OPENCLAW_MANAGED_PLATFORM;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCLAW_MANAGED_PLATFORM;
    } else {
      process.env.OPENCLAW_MANAGED_PLATFORM = originalEnv;
    }
  });

  it("sends SIGUSR1 to PID 1 and returns ok when OPENCLAW_MANAGED_PLATFORM=1", () => {
    process.env.OPENCLAW_MANAGED_PLATFORM = "1";
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const result = triggerOpenClawRestart();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("supervisor");
    expect(result.tried).toEqual(["kill -USR1 1 (managed platform)"]);
    expect(killSpy).toHaveBeenCalledWith(1, "SIGUSR1");
    // Should NOT have attempted systemctl
    expect(spawnSyncMock).not.toHaveBeenCalledWith(
      "systemctl",
      expect.anything(),
      expect.anything(),
    );
  });

  it("returns ok=false with error detail when process.kill throws in managed platform", () => {
    process.env.OPENCLAW_MANAGED_PLATFORM = "1";
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("Operation not permitted");
    });

    const result = triggerOpenClawRestart();

    expect(result.ok).toBe(false);
    expect(result.method).toBe("supervisor");
    expect(result.detail).toBe("Operation not permitted");
    expect(result.tried).toEqual(["kill -USR1 1 (managed platform)"]);
  });

  it("falls through to systemctl when OPENCLAW_MANAGED_PLATFORM is not set", () => {
    delete process.env.OPENCLAW_MANAGED_PLATFORM;
    spawnSyncMock.mockReturnValue({
      error: new Error("not found"),
      status: null,
      stdout: "",
      stderr: "",
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);

    const result = triggerOpenClawRestart();

    expect(result.method).toBe("systemd");
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "systemctl",
      expect.arrayContaining(["restart"]),
      expect.anything(),
    );
  });
});
