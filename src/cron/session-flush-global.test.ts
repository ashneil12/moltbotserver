import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerSessionFlushCallback,
  unregisterSessionFlushCallback,
  requestSessionFlush,
  type SessionFlushCallback,
} from "./session-flush-global.js";

describe("session-flush-global", () => {
  afterEach(() => {
    unregisterSessionFlushCallback();
  });

  it("fires callback when registered and flush is requested", async () => {
    const cb = vi.fn<SessionFlushCallback>().mockResolvedValue(undefined);
    registerSessionFlushCallback(cb);

    requestSessionFlush({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });

    // Wait for the fire-and-forget promise
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));

    expect(cb).toHaveBeenCalledWith({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });
  });

  it("no-ops silently when no callback is registered", () => {
    // Should not throw
    requestSessionFlush({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });
  });

  it("unregister removes the callback", async () => {
    const cb = vi.fn<SessionFlushCallback>().mockResolvedValue(undefined);
    registerSessionFlushCallback(cb);
    unregisterSessionFlushCallback();

    requestSessionFlush({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });

    // Give time for any async operation
    await new Promise((r) => setTimeout(r, 50));
    expect(cb).not.toHaveBeenCalled();
  });

  it("swallows errors from the callback without throwing", async () => {
    const cb = vi.fn<SessionFlushCallback>().mockRejectedValue(new Error("flush failed"));
    registerSessionFlushCallback(cb);

    // Should not throw even though callback rejects
    requestSessionFlush({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });

    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  });

  it("replaces previous callback on re-register", async () => {
    const cb1 = vi.fn<SessionFlushCallback>().mockResolvedValue(undefined);
    const cb2 = vi.fn<SessionFlushCallback>().mockResolvedValue(undefined);

    registerSessionFlushCallback(cb1);
    registerSessionFlushCallback(cb2);

    requestSessionFlush({
      sessionKey: "agent:main:dm:user1",
      agentId: "main",
      reason: "reset-trigger",
    });

    await vi.waitFor(() => expect(cb2).toHaveBeenCalledTimes(1));
    expect(cb1).not.toHaveBeenCalled();
  });
});
