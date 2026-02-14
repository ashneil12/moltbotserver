<<<<<<< HEAD
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createMockServerResponse } from "../test-utils/mock-http-response.js";
=======
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import {
  installRequestBodyLimitGuard,
  isRequestBodyLimitError,
  readJsonBodyWithLimit,
  readRequestBodyWithLimit,
} from "./http-body.js";

<<<<<<< HEAD
type MockIncomingMessage = IncomingMessage & {
  destroyed?: boolean;
  destroy: (error?: Error) => MockIncomingMessage;
  __unhandledDestroyError?: unknown;
};

async function waitForMicrotaskTurn(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
function createMockRequest(params: {
  chunks?: string[];
  headers?: Record<string, string>;
  emitEnd?: boolean;
<<<<<<< HEAD
}): MockIncomingMessage {
  const req = new EventEmitter() as MockIncomingMessage;
  req.destroyed = false;
  req.headers = params.headers ?? {};
  req.destroy = ((error?: Error) => {
    req.destroyed = true;
    if (error) {
      // Simulate Node's async 'error' emission on destroy(err). If no listener is
      // present at that time, EventEmitter throws; capture that as "unhandled".
      queueMicrotask(() => {
        try {
          req.emit("error", error);
        } catch (err) {
          req.__unhandledDestroyError = err;
        }
      });
    }
    return req;
  }) as MockIncomingMessage["destroy"];
=======
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { destroyed?: boolean; destroy: () => void };
  req.destroyed = false;
  req.headers = params.headers ?? {};
  req.destroy = () => {
    req.destroyed = true;
  };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

  if (params.chunks) {
    void Promise.resolve().then(() => {
      for (const chunk of params.chunks ?? []) {
        req.emit("data", Buffer.from(chunk, "utf-8"));
        if (req.destroyed) {
          return;
        }
      }
      if (params.emitEnd !== false) {
        req.emit("end");
      }
    });
  }

  return req;
}

<<<<<<< HEAD
=======
function createMockResponse(): ServerResponse & { body?: string } {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value;
      return res;
    },
    end: (body?: string) => {
      res.headersSent = true;
      res.body = body;
      return res;
    },
  } as unknown as ServerResponse & { body?: string };
  return res;
}

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
describe("http body limits", () => {
  it("reads body within max bytes", async () => {
    const req = createMockRequest({ chunks: ['{"ok":true}'] });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 1024 })).resolves.toBe('{"ok":true}');
  });

  it("rejects oversized body", async () => {
    const req = createMockRequest({ chunks: ["x".repeat(512)] });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 64 })).rejects.toMatchObject({
      message: "PayloadTooLarge",
    });
<<<<<<< HEAD
    expect(req.__unhandledDestroyError).toBeUndefined();
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });

  it("returns json parse error when body is invalid", async () => {
    const req = createMockRequest({ chunks: ["{bad json"] });
    const result = await readJsonBodyWithLimit(req, { maxBytes: 1024, emptyObjectOnEmpty: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_JSON");
    }
  });

  it("returns payload-too-large for json body", async () => {
    const req = createMockRequest({ chunks: ["x".repeat(1024)] });
    const result = await readJsonBodyWithLimit(req, { maxBytes: 10 });
    expect(result).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE", error: "Payload too large" });
  });

  it("guard rejects oversized declared content-length", () => {
    const req = createMockRequest({
      headers: { "content-length": "9999" },
      emitEnd: false,
    });
<<<<<<< HEAD
    const res = createMockServerResponse();
=======
    const res = createMockResponse();
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const guard = installRequestBodyLimitGuard(req, res, { maxBytes: 128 });
    expect(guard.isTripped()).toBe(true);
    expect(guard.code()).toBe("PAYLOAD_TOO_LARGE");
    expect(res.statusCode).toBe(413);
  });

  it("guard rejects streamed oversized body", async () => {
    const req = createMockRequest({ chunks: ["small", "x".repeat(256)], emitEnd: false });
<<<<<<< HEAD
    const res = createMockServerResponse();
    const guard = installRequestBodyLimitGuard(req, res, { maxBytes: 128, responseFormat: "text" });
    await waitForMicrotaskTurn();
=======
    const res = createMockResponse();
    const guard = installRequestBodyLimitGuard(req, res, { maxBytes: 128, responseFormat: "text" });
    await new Promise((resolve) => setTimeout(resolve, 0));
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    expect(guard.isTripped()).toBe(true);
    expect(guard.code()).toBe("PAYLOAD_TOO_LARGE");
    expect(res.statusCode).toBe(413);
    expect(res.body).toBe("Payload too large");
<<<<<<< HEAD
    expect(req.__unhandledDestroyError).toBeUndefined();
  });

  it("timeout surfaces typed error when timeoutMs is clamped", async () => {
    const req = createMockRequest({ emitEnd: false });
    const promise = readRequestBodyWithLimit(req, { maxBytes: 128, timeoutMs: 0 });
    await expect(promise).rejects.toSatisfy((error: unknown) =>
      isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT"),
    );
    expect(req.__unhandledDestroyError).toBeUndefined();
  });

  it("guard clamps invalid maxBytes to one byte", async () => {
    const req = createMockRequest({ chunks: ["ab"], emitEnd: false });
    const res = createMockServerResponse();
    const guard = installRequestBodyLimitGuard(req, res, {
      maxBytes: Number.NaN,
      responseFormat: "text",
    });
    await waitForMicrotaskTurn();
    expect(guard.isTripped()).toBe(true);
    expect(guard.code()).toBe("PAYLOAD_TOO_LARGE");
    expect(res.statusCode).toBe(413);
    expect(req.__unhandledDestroyError).toBeUndefined();
  });

  it("declared oversized content-length does not emit unhandled error", async () => {
    const req = createMockRequest({
      headers: { "content-length": "9999" },
      emitEnd: false,
    });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 128 })).rejects.toMatchObject({
      message: "PayloadTooLarge",
    });
    // Wait a tick for any async destroy(err) emission.
    await waitForMicrotaskTurn();
    expect(req.__unhandledDestroyError).toBeUndefined();
=======
  });

  it("timeout surfaces typed error", async () => {
    const req = createMockRequest({ emitEnd: false });
    const promise = readRequestBodyWithLimit(req, { maxBytes: 128, timeoutMs: 10 });
    await expect(promise).rejects.toSatisfy((error: unknown) =>
      isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT"),
    );
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });
});
