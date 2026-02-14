<<<<<<< HEAD
import { describe, expect, it } from "vitest";
import { createMockIncomingRequest } from "../../test/helpers/mock-incoming-request.js";
import { readLineWebhookRequestBody } from "./webhook-node.js";

describe("readLineWebhookRequestBody", () => {
  it("reads body within limit", async () => {
    const req = createMockIncomingRequest(['{"events":[{"type":"message"}]}']);
=======
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readLineWebhookRequestBody } from "./monitor.js";

function createMockRequest(chunks: string[]): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { destroyed?: boolean; destroy: () => void };
  req.destroyed = false;
  req.headers = {};
  req.destroy = () => {
    req.destroyed = true;
  };

  void Promise.resolve().then(() => {
    for (const chunk of chunks) {
      req.emit("data", Buffer.from(chunk, "utf-8"));
      if (req.destroyed) {
        return;
      }
    }
    req.emit("end");
  });

  return req;
}

describe("readLineWebhookRequestBody", () => {
  it("reads body within limit", async () => {
    const req = createMockRequest(['{"events":[{"type":"message"}]}']);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const body = await readLineWebhookRequestBody(req, 1024);
    expect(body).toContain('"events"');
  });

  it("rejects oversized body", async () => {
<<<<<<< HEAD
    const req = createMockIncomingRequest(["x".repeat(2048)]);
=======
    const req = createMockRequest(["x".repeat(2048)]);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    await expect(readLineWebhookRequestBody(req, 128)).rejects.toThrow("PayloadTooLarge");
  });
});
