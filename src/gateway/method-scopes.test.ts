import { describe, expect, it, vi } from "vitest";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers, handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";

describe("method scope resolution", () => {
  it.each([
    ["sessions.resolve", ["operator.read"]],
    ["config.schema.lookup", ["operator.read"]],
    ["poll", ["operator.write"]],
    ["config.patch", ["operator.admin"]],
    ["wizard.start", ["operator.admin"]],
    ["update.run", ["operator.admin"]],
  ])("resolves least-privilege scopes for %s", (method, expected) => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod(method)).toEqual(expected);
  });

  it("leaves node-only pending drain outside operator scopes", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("node.pending.drain")).toEqual([]);
  });

  it("returns empty scopes for unknown methods", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("totally.unknown.method")).toEqual([]);
  });

  it("classifies system.diskHealth as operator.read", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("system.diskHealth")).toEqual([
      "operator.read",
    ]);
  });

  it("classifies system.diskCleanup as operator.admin", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("system.diskCleanup")).toEqual([
      "operator.admin",
    ]);
  });
});

describe("operator scope authorization", () => {
  it.each([
    ["health", ["operator.read"], { allowed: true }],
    ["health", ["operator.write"], { allowed: true }],
    ["config.schema.lookup", ["operator.read"], { allowed: true }],
    ["config.patch", ["operator.admin"], { allowed: true }],
  ])("authorizes %s for scopes %j", (method, scopes, expected) => {
    expect(authorizeOperatorScopesForMethod(method, scopes)).toEqual(expected);
  });

  it("requires operator.write for write methods", () => {
    expect(authorizeOperatorScopesForMethod("send", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
  });

  it("requires approvals scope for approval methods", () => {
    expect(authorizeOperatorScopesForMethod("exec.approval.resolve", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
  });

  it("requires admin for unknown methods", () => {
    expect(authorizeOperatorScopesForMethod("unknown.method", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.admin",
    });
  });
});

describe("core gateway method classification", () => {
  it("treats node-role methods as classified even without operator scopes", () => {
    expect(isGatewayMethodClassified("node.pending.drain")).toBe(true);
    expect(isGatewayMethodClassified("node.pending.pull")).toBe(true);
  });

  it("classifies every exposed core gateway handler method", () => {
    const unclassified = Object.keys(coreGatewayHandlers).filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies every listed gateway method name", () => {
    const unclassified = listGatewayMethods().filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SHARED_AUTH_EXEMPT_METHODS — integration tests
// ---------------------------------------------------------------------------

describe("scope-exempt methods (SHARED_AUTH_EXEMPT_METHODS)", () => {
  const noWebchat = () => false;

  /**
   * Build a minimal client that simulates the dashboard's device-less
   * WebSocket connection — authenticated (has a connect object) but with
   * empty scopes, exactly as `clearUnboundScopes` would leave it.
   */
  function buildScopelessClient() {
    return {
      connect: {
        role: "operator",
        scopes: [] as string[],
        client: {
          id: "gateway-client",
          version: "1.0.0",
          platform: "linux",
          mode: "ui",
        },
        minProtocol: 1,
        maxProtocol: 1,
      },
      connId: "conn-dashboard",
      clientIp: "127.0.0.1",
    } as Parameters<typeof handleGatewayRequest>[0]["client"];
  }

  function buildContext() {
    return {
      logGateway: { warn: vi.fn() },
    } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"];
  }

  async function invokeMethod(params: {
    method: string;
    client: Parameters<typeof handleGatewayRequest>[0]["client"];
    handler: GatewayRequestHandler;
  }) {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: crypto.randomUUID(),
        method: params.method,
      },
      respond,
      client: params.client,
      isWebchatConnect: noWebchat,
      context: buildContext(),
      extraHandlers: {
        [params.method]: params.handler,
      },
    });
    return respond;
  }

  const okHandler: GatewayRequestHandler = (opts) => {
    opts.respond(true, { ok: true }, undefined);
  };

  it.each(["health", "system.diskHealth", "system.diskCleanup"])(
    "allows %s with empty scopes (dashboard device-less client)",
    async (method) => {
      const respond = await invokeMethod({
        method,
        client: buildScopelessClient(),
        handler: okHandler,
      });
      expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    },
  );

  it.each(["send", "config.patch", "agents.create"])(
    "blocks %s with empty scopes (non-exempt method)",
    async (method) => {
      const respond = await invokeMethod({
        method,
        client: buildScopelessClient(),
        handler: okHandler,
      });
      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({
          code: "INVALID_REQUEST",
          message: expect.stringContaining("missing scope"),
        }),
      );
    },
  );

  it.each([
    "cron.list",
    "cron.health",
    "cron.status",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "cron.runs",
  ])("allows %s with empty scopes (cron exempt for dashboard)", async (method) => {
    const respond = await invokeMethod({
      method,
      client: buildScopelessClient(),
      handler: okHandler,
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("allows exempt methods with full operator.admin scopes too", async () => {
    const client = buildScopelessClient();
    client!.connect.scopes = ["operator.admin"];
    const respond = await invokeMethod({
      method: "system.diskHealth",
      client,
      handler: okHandler,
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("allows exempt methods for unauthenticated clients (no connect)", async () => {
    // When client has no connect object, authorizeGatewayMethod returns null early.
    const respond = await invokeMethod({
      method: "health",
      client: null,
      handler: okHandler,
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });
});
