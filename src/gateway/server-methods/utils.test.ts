import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isManagedPlatformAdmin } from "./utils.js";

describe("isManagedPlatformAdmin", () => {
  const origEnv = process.env.OPENCLAW_MANAGED_PLATFORM;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.OPENCLAW_MANAGED_PLATFORM;
    } else {
      process.env.OPENCLAW_MANAGED_PLATFORM = origEnv;
    }
  });

  function buildClient(clientId: string) {
    return {
      connect: {
        role: "operator",
        scopes: [] as string[],
        client: { id: clientId, version: "1.0.0", platform: "server", mode: "backend" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      connId: "conn-test",
    } as Parameters<typeof isManagedPlatformAdmin>[0];
  }

  describe("when OPENCLAW_MANAGED_PLATFORM=1", () => {
    beforeEach(() => {
      process.env.OPENCLAW_MANAGED_PLATFORM = "1";
    });

    it("returns true for gateway-client", () => {
      expect(isManagedPlatformAdmin(buildClient("gateway-client"))).toBe(true);
    });

    it("returns true for openclaw-control-ui", () => {
      expect(isManagedPlatformAdmin(buildClient("openclaw-control-ui"))).toBe(true);
    });

    it("returns false for unknown client ID", () => {
      expect(isManagedPlatformAdmin(buildClient("random-client"))).toBe(false);
    });

    it("returns false for null client", () => {
      expect(isManagedPlatformAdmin(null)).toBe(false);
    });

    it("returns false when client has no connect", () => {
      expect(isManagedPlatformAdmin({} as any)).toBe(false);
    });
  });

  describe("when OPENCLAW_MANAGED_PLATFORM is not set (self-hosted)", () => {
    beforeEach(() => {
      delete process.env.OPENCLAW_MANAGED_PLATFORM;
    });

    it("returns false for gateway-client", () => {
      expect(isManagedPlatformAdmin(buildClient("gateway-client"))).toBe(false);
    });

    it("returns false for openclaw-control-ui", () => {
      expect(isManagedPlatformAdmin(buildClient("openclaw-control-ui"))).toBe(false);
    });
  });

  describe("when OPENCLAW_MANAGED_PLATFORM is a different value", () => {
    beforeEach(() => {
      process.env.OPENCLAW_MANAGED_PLATFORM = "0";
    });

    it("returns false even for gateway-client", () => {
      expect(isManagedPlatformAdmin(buildClient("gateway-client"))).toBe(false);
    });
  });
});
