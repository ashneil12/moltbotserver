import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
<<<<<<< HEAD
import { createCliRuntimeCapture } from "./test-runtime-capture.js";
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

type NodeInvokeCall = {
  method?: string;
  params?: {
    idempotencyKey?: string;
    command?: string;
    params?: unknown;
    timeoutMs?: number;
  };
};

const callGateway = vi.fn(async (opts: NodeInvokeCall) => {
  if (opts.method === "node.list") {
    return {
      nodes: [
        {
          nodeId: "mac-1",
          displayName: "Mac",
          platform: "macos",
          caps: ["canvas"],
          connected: true,
          permissions: { screenRecording: true },
        },
      ],
    };
  }
  if (opts.method === "node.invoke") {
    return {
      payload: {
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true,
        timedOut: false,
      },
    };
  }
  if (opts.method === "exec.approvals.node.get") {
    return {
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "hash",
      file: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "on-miss",
          askFallback: "deny",
        },
        agents: {},
      },
    };
  }
  if (opts.method === "exec.approval.request") {
    return { decision: "allow-once" };
  }
  return { ok: true };
});

const randomIdempotencyKey = vi.fn(() => "rk_test");

const { defaultRuntime, resetRuntimeCapture } = createCliRuntimeCapture();

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGateway(opts as NodeInvokeCall),
  randomIdempotencyKey: () => randomIdempotencyKey(),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
}));

describe("nodes-cli coverage", () => {
  let registerNodesCli: (program: Command) => void;

<<<<<<< HEAD
  const getNodeInvokeCall = () =>
    callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0] as NodeInvokeCall;

  const createNodesProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);
    return program;
  };

  const runNodesCommand = async (args: string[]) => {
    const program = createNodesProgram();
    await program.parseAsync(args, { from: "user" });
    return getNodeInvokeCall();
  };

  beforeAll(async () => {
    ({ registerNodesCli } = await import("./nodes-cli.js"));
  });

  beforeEach(() => {
    resetRuntimeCapture();
    callGateway.mockClear();
    randomIdempotencyKey.mockClear();
  });

  it("invokes system.run with parsed params", async () => {
    const invoke = await runNodesCommand([
      "nodes",
      "run",
      "--node",
      "mac-1",
      "--cwd",
      "/tmp",
      "--env",
      "FOO=bar",
      "--command-timeout",
      "1200",
      "--needs-screen-recording",
      "--invoke-timeout",
      "5000",
      "echo",
      "hi",
    ]);
=======
  beforeAll(async () => {
    ({ registerNodesCli } = await import("./nodes-cli.js"));
  });

  beforeEach(() => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();
    randomIdempotencyKey.mockClear();
  });

  it("invokes system.run with parsed params", async () => {
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "run",
        "--node",
        "mac-1",
        "--cwd",
        "/tmp",
        "--env",
        "FOO=bar",
        "--command-timeout",
        "1200",
        "--needs-screen-recording",
        "--invoke-timeout",
        "5000",
        "echo",
        "hi",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.idempotencyKey).toBe("rk_test");
    expect(invoke?.params?.command).toBe("system.run");
    expect(invoke?.params?.params).toEqual({
      command: ["echo", "hi"],
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 1200,
      needsScreenRecording: true,
      agentId: "main",
      approved: true,
      approvalDecision: "allow-once",
      runId: expect.any(String),
    });
    expect(invoke?.params?.timeoutMs).toBe(5000);
  });

  it("invokes system.run with raw command", async () => {
<<<<<<< HEAD
    const invoke = await runNodesCommand([
      "nodes",
      "run",
      "--agent",
      "main",
      "--node",
      "mac-1",
      "--raw",
      "echo hi",
    ]);
=======
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      ["nodes", "run", "--agent", "main", "--node", "mac-1", "--raw", "echo hi"],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.idempotencyKey).toBe("rk_test");
    expect(invoke?.params?.command).toBe("system.run");
    expect(invoke?.params?.params).toMatchObject({
      command: ["/bin/sh", "-lc", "echo hi"],
      rawCommand: "echo hi",
      agentId: "main",
      approved: true,
      approvalDecision: "allow-once",
      runId: expect.any(String),
    });
  });

  it("invokes system.notify with provided fields", async () => {
<<<<<<< HEAD
    const invoke = await runNodesCommand([
      "nodes",
      "notify",
      "--node",
      "mac-1",
      "--title",
      "Ping",
      "--body",
      "Gateway ready",
      "--delivery",
      "overlay",
    ]);
=======
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "notify",
        "--node",
        "mac-1",
        "--title",
        "Ping",
        "--body",
        "Gateway ready",
        "--delivery",
        "overlay",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.command).toBe("system.notify");
    expect(invoke?.params?.params).toEqual({
      title: "Ping",
      body: "Gateway ready",
      sound: undefined,
      priority: undefined,
      delivery: "overlay",
    });
  });

  it("invokes location.get with params", async () => {
<<<<<<< HEAD
    const invoke = await runNodesCommand([
      "nodes",
      "location",
      "get",
      "--node",
      "mac-1",
      "--accuracy",
      "precise",
      "--max-age",
      "1000",
      "--location-timeout",
      "5000",
      "--invoke-timeout",
      "6000",
    ]);
=======
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "location",
        "get",
        "--node",
        "mac-1",
        "--accuracy",
        "precise",
        "--max-age",
        "1000",
        "--location-timeout",
        "5000",
        "--invoke-timeout",
        "6000",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.command).toBe("location.get");
    expect(invoke?.params?.params).toEqual({
      maxAgeMs: 1000,
      desiredAccuracy: "precise",
      timeoutMs: 5000,
    });
    expect(invoke?.params?.timeoutMs).toBe(6000);
  });
});
