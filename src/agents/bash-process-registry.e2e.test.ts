import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessSession } from "./bash-process-registry.js";
import {
  addSession,
  appendOutput,
  drainSession,
  listFinishedSessions,
  markBackgrounded,
  markExited,
  resetProcessRegistryForTests,
} from "./bash-process-registry.js";
import { createProcessSessionFixture } from "./bash-process-registry.test-helpers.js";

describe("bash process registry", () => {
  function createRegistrySession(params: {
    id?: string;
    maxOutputChars: number;
    pendingMaxOutputChars: number;
    backgrounded: boolean;
  }): ProcessSession {
    return createProcessSessionFixture({
      id: params.id ?? "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as unknown as ChildProcessWithoutNullStreams,
      maxOutputChars: params.maxOutputChars,
      pendingMaxOutputChars: params.pendingMaxOutputChars,
      backgrounded: params.backgrounded,
    });
  }

  beforeEach(() => {
    resetProcessRegistryForTests();
  });

  it("captures output and truncates", () => {
<<<<<<< HEAD:src/agents/bash-process-registry.test.ts
    const session = createRegistrySession({
=======
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-process-registry.e2e.test.ts
      maxOutputChars: 10,
      pendingMaxOutputChars: 30_000,
      backgrounded: false,
    });

    addSession(session);
    appendOutput(session, "stdout", "0123456789");
    appendOutput(session, "stdout", "abcdef");

    expect(session.aggregated).toBe("6789abcdef");
    expect(session.truncated).toBe(true);
  });

  it("caps pending output to avoid runaway polls", () => {
<<<<<<< HEAD:src/agents/bash-process-registry.test.ts
    const session = createRegistrySession({
=======
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-process-registry.e2e.test.ts
      maxOutputChars: 100_000,
      pendingMaxOutputChars: 20_000,
      backgrounded: true,
    });

    addSession(session);
    const payload = `${"a".repeat(70_000)}${"b".repeat(20_000)}`;
    appendOutput(session, "stdout", payload);

    const drained = drainSession(session);
    expect(drained.stdout).toBe("b".repeat(20_000));
    expect(session.pendingStdout).toHaveLength(0);
    expect(session.pendingStdoutChars).toBe(0);
    expect(session.truncated).toBe(true);
  });

  it("respects max output cap when pending cap is larger", () => {
<<<<<<< HEAD:src/agents/bash-process-registry.test.ts
    const session = createRegistrySession({
=======
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-process-registry.e2e.test.ts
      maxOutputChars: 5_000,
      pendingMaxOutputChars: 30_000,
      backgrounded: true,
    });

    addSession(session);
    appendOutput(session, "stdout", "x".repeat(10_000));

    const drained = drainSession(session);
    expect(drained.stdout.length).toBe(5_000);
    expect(session.truncated).toBe(true);
  });

  it("caps stdout and stderr independently", () => {
<<<<<<< HEAD:src/agents/bash-process-registry.test.ts
    const session = createRegistrySession({
=======
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-process-registry.e2e.test.ts
      maxOutputChars: 100,
      pendingMaxOutputChars: 10,
      backgrounded: true,
    });

    addSession(session);
    appendOutput(session, "stdout", "a".repeat(6));
    appendOutput(session, "stdout", "b".repeat(6));
    appendOutput(session, "stderr", "c".repeat(12));

    const drained = drainSession(session);
    expect(drained.stdout).toBe("a".repeat(4) + "b".repeat(6));
    expect(drained.stderr).toBe("c".repeat(10));
    expect(session.truncated).toBe(true);
  });

  it("only persists finished sessions when backgrounded", () => {
<<<<<<< HEAD:src/agents/bash-process-registry.test.ts
    const session = createRegistrySession({
=======
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-process-registry.e2e.test.ts
      maxOutputChars: 100,
      pendingMaxOutputChars: 30_000,
      backgrounded: false,
    });

    addSession(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(0);

    markBackgrounded(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(1);
  });
});
