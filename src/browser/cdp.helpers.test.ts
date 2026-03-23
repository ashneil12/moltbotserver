import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendCdpPath, fetchCdpChecked, getHeadersWithAuth, redactCdpUrl } from "./cdp.helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cdp.helpers", () => {
  it("preserves query params when appending CDP paths", () => {
    const url = appendCdpPath("https://example.com?token=abc", "/json/version");
    expect(url).toBe("https://example.com/json/version?token=abc");
  });

  it("appends paths under a base prefix", () => {
    const url = appendCdpPath("https://example.com/chrome/?token=abc", "json/list");
    expect(url).toBe("https://example.com/chrome/json/list?token=abc");
  });

  it("adds basic auth headers when credentials are present", () => {
    const headers = getHeadersWithAuth("https://user:pass@example.com");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("keeps preexisting authorization headers", () => {
    const headers = getHeadersWithAuth("https://user:pass@example.com", {
      Authorization: "Bearer token",
    });
    expect(headers.Authorization).toBe("Bearer token");
  });

  it("uses a manual HTTP request when Host must be overridden", async () => {
    const requestSpy = vi.spyOn(http, "request").mockImplementation(((
      ...args: Parameters<typeof http.request>
    ) => {
      const callback = args[2] as ((res: http.IncomingMessage) => void) | undefined;
      const req = new EventEmitter() as http.ClientRequest;
      req.write = vi.fn(() => true) as typeof req.write;
      req.end = vi.fn(() => {
        const res = new EventEmitter() as http.IncomingMessage;
        res.statusCode = 200;
        res.statusMessage = "OK";
        res.headers = { "content-type": "application/json" };
        process.nextTick(() => {
          callback?.(res);
          res.emit("data", Buffer.from(JSON.stringify({ ok: true })));
          res.emit("end");
        });
        return req;
      }) as typeof req.end;
      req.on = EventEmitter.prototype.on.bind(req) as typeof req.on;
      return req;
    }) as typeof http.request);

    const res = await fetchCdpChecked("http://browser.test:9222/json/version", 1000);
    expect(await res.json()).toEqual({ ok: true });

    const [, options] = requestSpy.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      headers: expect.objectContaining({ Host: "localhost" }),
    });
  });
});

describe("redactCdpUrl", () => {
  it("passes null and undefined through", () => {
    expect(redactCdpUrl(null)).toBeNull();
    expect(redactCdpUrl(undefined)).toBeUndefined();
  });

  it("passes empty string through", () => {
    expect(redactCdpUrl("")).toBe("");
    expect(redactCdpUrl("   ")).toBe("");
  });

  it("strips credentials from a CDP URL", () => {
    const result = redactCdpUrl("http://user:pass@browser.test:9222/json");
    expect(result).toBe("http://browser.test:9222/json");
    expect(result).not.toContain("user");
    expect(result).not.toContain("pass");
  });

  it("preserves URLs without credentials", () => {
    expect(redactCdpUrl("http://localhost:9222")).toBe("http://localhost:9222");
  });

  it("handles invalid URLs gracefully", () => {
    expect(redactCdpUrl("not-a-url")).toBe("not-a-url");
  });

  it("removes trailing slashes", () => {
    expect(redactCdpUrl("http://localhost:9222/")).toBe("http://localhost:9222");
  });
});
