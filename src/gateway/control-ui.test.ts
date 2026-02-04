import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleControlUiHttpRequest } from "./control-ui.js";

const makeResponse = (): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} => {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return { res, setHeader, end };
};

describe("handleControlUiHttpRequest", () => {
  it("sets anti-clickjacking headers for Control UI responses when not in SaaS mode", async () => {
    // Ensure we're NOT in SaaS mode for this test
    const origDisableDeviceAuth = process.env.OPENCLAW_DISABLE_DEVICE_AUTH;
    const origAllowOrigins = process.env.OPENCLAW_ALLOW_IFRAME_ORIGINS;
    delete process.env.OPENCLAW_DISABLE_DEVICE_AUTH;
    delete process.env.OPENCLAW_ALLOW_IFRAME_ORIGINS;

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
      const { res, setHeader } = makeResponse();
      const handled = handleControlUiHttpRequest(
        { url: "/", method: "GET" } as IncomingMessage,
        res,
        {
          root: { kind: "resolved", path: tmp },
        },
      );
      expect(handled).toBe(true);
      expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
      expect(setHeader).toHaveBeenCalledWith("Content-Security-Policy", "frame-ancestors 'none'");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      // Restore env
      if (origDisableDeviceAuth !== undefined) {
        process.env.OPENCLAW_DISABLE_DEVICE_AUTH = origDisableDeviceAuth;
      }
      if (origAllowOrigins !== undefined) {
        process.env.OPENCLAW_ALLOW_IFRAME_ORIGINS = origAllowOrigins;
      }
    }
  });
});
