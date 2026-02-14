<<<<<<< HEAD
import { describe, expect, it } from "vitest";
import { createMockIncomingRequest } from "../../../test/helpers/mock-incoming-request.js";
import { readNextcloudTalkWebhookBody } from "./monitor.js";

describe("readNextcloudTalkWebhookBody", () => {
  it("reads valid body within max bytes", async () => {
    const req = createMockIncomingRequest(['{"type":"Create"}']);
=======
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readNextcloudTalkWebhookBody } from "./monitor.js";

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

describe("readNextcloudTalkWebhookBody", () => {
  it("reads valid body within max bytes", async () => {
    const req = createMockRequest(['{"type":"Create"}']);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const body = await readNextcloudTalkWebhookBody(req, 1024);
    expect(body).toBe('{"type":"Create"}');
  });

  it("rejects when payload exceeds max bytes", async () => {
<<<<<<< HEAD
    const req = createMockIncomingRequest(["x".repeat(300)]);
=======
    const req = createMockRequest(["x".repeat(300)]);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    await expect(readNextcloudTalkWebhookBody(req, 128)).rejects.toThrow("PayloadTooLarge");
  });
});
