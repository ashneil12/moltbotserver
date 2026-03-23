/**
 * Browser tool per-agent routing tests.
 *
 * These tests verify the critical custom patch path:
 *   1. openclaw-tools.ts passes agentId to createBrowserTool()
 *   2. browser-tool.ts overrides profile="openclaw" → agent's profile when config has one
 *   3. Requests route to the agent's dedicated container (http://browser-<agentId>:9222)
 *
 * This is the most breakable path during upstream syncs because:
 *   - The agentId injection in openclaw-tools.ts is a LOCAL PATCH
 *   - The profile override logic in browser-tool.ts is upstream but our patch depends on it
 *   - Without these, all agents silently share the main browser
 */
// oxlint-disable typescript/no-explicit-any -- vi.spyOn mock implementations
// require `as any` casts to satisfy branded return types from the original
// function signatures. This is test-only code with no production impact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ── Mocks (vi.spyOn + __testing.setDepsForTest injection) ───────────────────
import * as browserClientMod from "../../browser/client.js";
const browserClientMocks = {
  browserCloseTab: vi
    .spyOn(browserClientMod, "browserCloseTab")
    .mockImplementation(async (..._args: unknown[]) => ({}) as any),
  browserFocusTab: vi
    .spyOn(browserClientMod, "browserFocusTab")
    .mockImplementation(async (..._args: unknown[]) => ({}) as any),
  browserOpenTab: vi.spyOn(browserClientMod, "browserOpenTab").mockImplementation(
    async (..._args: unknown[]) =>
      ({
        targetId: "tab-1",
        title: "New Tab",
        url: "about:blank",
      }) as any,
  ),
  browserProfiles: vi
    .spyOn(browserClientMod, "browserProfiles")
    .mockImplementation(async (..._args: unknown[]): Promise<any> => []),
  browserSnapshot: vi.spyOn(browserClientMod, "browserSnapshot").mockImplementation(
    async (..._args: unknown[]): Promise<any> => ({
      ok: true,
      format: "ai",
      targetId: "t1",
      url: "https://example.com",
      snapshot: "ok",
    }),
  ),
  browserStart: vi
    .spyOn(browserClientMod, "browserStart")
    .mockImplementation(async (..._args: unknown[]) => ({}) as any),
  browserStatus: vi.spyOn(browserClientMod, "browserStatus").mockImplementation(
    async (..._args: unknown[]) =>
      ({
        ok: true,
        running: true,
        pid: 1,
        cdpPort: 9222,
        cdpUrl: "http://127.0.0.1:9222",
      }) as any,
  ),
  browserStop: vi
    .spyOn(browserClientMod, "browserStop")
    .mockImplementation(async (..._args: unknown[]) => ({}) as any),
  browserTabs: vi
    .spyOn(browserClientMod, "browserTabs")
    .mockImplementation(async (..._args: unknown[]): Promise<any> => []),
};

import * as browserActionsMod from "../../browser/client-actions.js";
const browserActionsMocks = {
  browserAct: vi
    .spyOn(browserActionsMod, "browserAct")
    .mockImplementation(async () => ({ ok: true }) as any),
  browserArmDialog: vi
    .spyOn(browserActionsMod, "browserArmDialog")
    .mockImplementation(async () => ({ ok: true }) as any),
  browserArmFileChooser: vi
    .spyOn(browserActionsMod, "browserArmFileChooser")
    .mockImplementation(async () => ({ ok: true }) as any),
  browserConsoleMessages: vi.spyOn(browserActionsMod, "browserConsoleMessages").mockImplementation(
    async () =>
      ({
        ok: true,
        targetId: "t1",
        messages: [],
      }) as any,
  ),
  browserNavigate: vi
    .spyOn(browserActionsMod, "browserNavigate")
    .mockImplementation(async () => ({ ok: true }) as any),
  browserPdfSave: vi
    .spyOn(browserActionsMod, "browserPdfSave")
    .mockImplementation(async () => ({ ok: true, path: "/tmp/test.pdf" }) as any),
  browserScreenshotAction: vi
    .spyOn(browserActionsMod, "browserScreenshotAction")
    .mockImplementation(async () => ({ ok: true, path: "/tmp/test.png" }) as any),
};

import * as browserConfigMod from "../../browser/config.js";
const browserConfigMocks = {
  resolveBrowserConfig: vi
    .spyOn(browserConfigMod, "resolveBrowserConfig")
    .mockImplementation((() => ({
      enabled: true,
      controlPort: 18791,
      profiles: {},
      defaultProfile: "openclaw",
    })) as any),
  resolveProfile: vi
    .spyOn(browserConfigMod, "resolveProfile")
    .mockImplementation((() => null) as any),
};

import * as nodesUtilsMod from "./nodes-utils.js";
const nodesUtilsMocks = {
  listNodes: vi
    .spyOn(nodesUtilsMod, "listNodes")
    .mockImplementation(async (..._args: unknown[]): Promise<any> => []),
};

import * as gatewayMod from "./gateway.js";
const gatewayMocks = {
  callGatewayTool: vi.spyOn(gatewayMod, "callGatewayTool").mockImplementation(
    async () =>
      ({
        ok: true,
        payload: { result: { ok: true, running: true } },
      }) as any,
  ),
};

import * as configMod from "../../config/config.js";
const configMocks = {
  loadConfig: vi
    .spyOn(configMod, "loadConfig")
    .mockImplementation((() => ({ browser: {} })) as any),
};

import * as sessionTabRegistryMod from "../../browser/session-tab-registry.js";
const sessionTabRegistryMocks = {
  trackSessionBrowserTab: vi
    .spyOn(sessionTabRegistryMod, "trackSessionBrowserTab")
    .mockImplementation(() => {}),
  untrackSessionBrowserTab: vi
    .spyOn(sessionTabRegistryMod, "untrackSessionBrowserTab")
    .mockImplementation(() => {}),
};

import { __testing as browserToolActionsTesting } from "./browser-tool.actions.js";
import { createBrowserTool, __testing as browserToolTesting } from "./browser-tool.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetAllMocks() {
  vi.clearAllMocks();
  configMocks.loadConfig.mockReturnValue({ browser: {} } as any);
  browserConfigMocks.resolveProfile.mockImplementation((() => null) as any);
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: true,
    controlPort: 18791,
    profiles: {},
    defaultProfile: "openclaw",
  } as any);
  nodesUtilsMocks.listNodes.mockResolvedValue([]);

  // Inject mocks into the browser-tool deps cache
  browserToolTesting.setDepsForTest({
    browserAct: browserActionsMocks.browserAct as never,
    browserArmDialog: browserActionsMocks.browserArmDialog as never,
    browserArmFileChooser: browserActionsMocks.browserArmFileChooser as never,
    browserCloseTab: browserClientMocks.browserCloseTab as never,
    browserFocusTab: browserClientMocks.browserFocusTab as never,
    browserNavigate: browserActionsMocks.browserNavigate as never,
    browserOpenTab: browserClientMocks.browserOpenTab as never,
    browserPdfSave: browserActionsMocks.browserPdfSave as never,
    browserProfiles: browserClientMocks.browserProfiles as never,
    browserScreenshotAction: browserActionsMocks.browserScreenshotAction as never,
    browserStart: browserClientMocks.browserStart as never,
    browserStatus: browserClientMocks.browserStatus as never,
    browserStop: browserClientMocks.browserStop as never,
    loadConfig: configMocks.loadConfig as never,
    listNodes: nodesUtilsMocks.listNodes as never,
    callGatewayTool: gatewayMocks.callGatewayTool as never,
    trackSessionBrowserTab: sessionTabRegistryMocks.trackSessionBrowserTab as never,
    untrackSessionBrowserTab: sessionTabRegistryMocks.untrackSessionBrowserTab as never,
  });
  browserToolActionsTesting.setDepsForTest({
    browserAct: browserActionsMocks.browserAct as never,
    browserConsoleMessages: browserActionsMocks.browserConsoleMessages as never,
    browserSnapshot: browserClientMocks.browserSnapshot as never,
    browserTabs: browserClientMocks.browserTabs as never,
    loadConfig: configMocks.loadConfig as never,
  } as any);
}

/**
 * Simulate a config where agent "dan" has a dedicated browser profile
 * pointing to http://browser-dan:9222.
 */
function configWithAgentProfile(agentId: string, cdpPort = 9222) {
  const profiles: Record<string, Record<string, unknown>> = {
    [agentId]: {
      cdpUrl: `http://browser-${agentId}:${cdpPort}`,
      color: "#FF6B35",
    },
  };
  configMocks.loadConfig.mockReturnValue({
    browser: {
      enabled: true,
      profiles,
    },
  });
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: true,
    controlPort: 18791,
    profiles,
    defaultProfile: "openclaw",
  });
}

/**
 * Simulate a config with multiple agent browsers.
 */
function configWithMultipleAgentProfiles(agentIds: string[]) {
  const profiles: Record<string, Record<string, unknown>> = {};
  agentIds.forEach((id, i) => {
    profiles[id] = {
      cdpUrl: `http://browser-${id}:9222`,
      color: ["#FF6B35", "#7B2D8E", "#2196F3", "#4CAF50"][i % 4],
    };
  });
  configMocks.loadConfig.mockReturnValue({
    browser: {
      enabled: true,
      profiles,
    },
  });
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: true,
    controlPort: 18791,
    profiles,
    defaultProfile: "openclaw",
  });
}

// ── Per-Agent Profile Override Tests ────────────────────────────────────────

describe("browser tool per-agent profile routing", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("overrides default profile to agent's profile when agentId is set and config has a profile", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    // The status call should be made with profile="dan", NOT "openclaw"
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it('overrides explicit profile="openclaw" to agent profile', async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status", profile: "openclaw" });

    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("does NOT override when the agent explicitly requests a different profile", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status", profile: "custom-profile" });

    // Should keep "custom-profile", NOT override to "dan"
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "custom-profile" }),
    );
  });

  it("does NOT override when agentId is 'main'", async () => {
    configWithAgentProfile("main");
    const tool = createBrowserTool({ agentId: "main" });
    await tool.execute?.("call-1", { action: "status" });

    // "main" agent should use default profile (undefined = "openclaw")
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("does NOT override when agentId is not set", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool(); // no agentId
    await tool.execute?.("call-1", { action: "status" });

    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("does NOT override when config has no profile for this agent", async () => {
    // Config only has a profile for "jael", but the tool is for "dan"
    configWithAgentProfile("jael");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    // No profile for "dan" in config → keep default (undefined)
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("routes each agent to its own profile in multi-agent config", async () => {
    configWithMultipleAgentProfiles(["dan", "jael", "nehemiah"]);

    // Agent "dan" should route to profile "dan"
    const danTool = createBrowserTool({ agentId: "dan" });
    await danTool.execute?.("call-1", { action: "status" });
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );

    vi.clearAllMocks();
    configWithMultipleAgentProfiles(["dan", "jael", "nehemiah"]);

    // Agent "jael" should route to profile "jael"
    const jaelTool = createBrowserTool({ agentId: "jael" });
    await jaelTool.execute?.("call-1", { action: "status" });
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "jael" }),
    );
  });
});

// ── Profile Override Across All Actions ─────────────────────────────────────

describe("browser tool per-agent routing across all actions", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("routes agent profile for 'start' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "start" });

    expect(browserClientMocks.browserStart).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'stop' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "stop" });

    expect(browserClientMocks.browserStop).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'open' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "open",
      targetUrl: "https://example.com",
    });

    expect(browserClientMocks.browserOpenTab).toHaveBeenCalledWith(
      undefined,
      "https://example.com",
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'navigate' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "navigate",
      targetUrl: "https://example.com",
    });

    expect(browserActionsMocks.browserNavigate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        url: "https://example.com",
        profile: "dan",
      }),
    );
  });

  it("routes agent profile for 'snapshot' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "snapshot",
      snapshotFormat: "aria",
    });

    expect(browserClientMocks.browserSnapshot).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'act' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "act",
      request: { kind: "click", ref: "e1" },
    });

    expect(browserActionsMocks.browserAct).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ kind: "click", ref: "e1" }),
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'close' action with targetId", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "close",
      targetId: "tab-123",
    });

    expect(browserClientMocks.browserCloseTab).toHaveBeenCalledWith(
      undefined,
      "tab-123",
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("routes agent profile for 'console' action", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "console" });

    expect(browserActionsMocks.browserConsoleMessages).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });
});

// ── Host-Only Profile Protection ────────────────────────────────────────────

describe("browser tool host-only profile protection with agentId", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it('does NOT override profile="user" even when agent has a profile', async () => {
    configWithAgentProfile("dan");
    browserConfigMocks.resolveProfile.mockReturnValue({
      name: "user",
      driver: "existing-session",
      cdpPort: 0,
      cdpUrl: "",
      cdpHost: "",
      cdpIsLoopback: true,
      color: "#00AA00",
      attachOnly: true,
    });
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "status",
      profile: "user",
    });

    // "user" is host-only and should stay "user", NOT be overridden to "dan"
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "user" }),
    );
  });

  it('does NOT override profile="chrome-relay" even when agent has a profile', async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", {
      action: "status",
      profile: "chrome-relay",
    });

    // "chrome-relay" should stay, NOT be overridden
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "chrome-relay" }),
    );
  });

  it('rejects profile="user" with target="sandbox"', async () => {
    configWithAgentProfile("dan");
    browserConfigMocks.resolveProfile.mockReturnValue({
      name: "user",
      driver: "existing-session",
      cdpPort: 0,
      cdpUrl: "",
      cdpHost: "",
      cdpIsLoopback: true,
      color: "#00AA00",
      attachOnly: true,
    });
    const tool = createBrowserTool({
      agentId: "dan",
      sandboxBridgeUrl: "http://127.0.0.1:9999",
    });

    await expect(
      tool.execute?.("call-1", {
        action: "status",
        profile: "user",
        target: "sandbox",
      }),
    ).rejects.toThrow(/profile="user" cannot use the sandbox browser/i);
  });

  it('rejects profile="chrome-relay" with target="node"', async () => {
    nodesUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "node-1",
        displayName: "Browser Node",
        connected: true,
        caps: ["browser"],
        commands: ["browser.proxy"],
      },
    ]);
    configWithAgentProfile("dan");
    browserConfigMocks.resolveProfile.mockReturnValue({
      name: "chrome-relay",
      driver: "existing-session",
      cdpPort: 0,
      cdpUrl: "",
      cdpHost: "",
      cdpIsLoopback: true,
      color: "#00AA00",
      attachOnly: true,
    });
    const tool = createBrowserTool({ agentId: "dan" });

    await expect(
      tool.execute?.("call-1", {
        action: "status",
        profile: "chrome-relay",
        target: "node",
      }),
    ).rejects.toThrow(/profile="chrome-relay" only supports the local host browser/i);
  });
});

// ── Sandbox Bridge URL Interaction ──────────────────────────────────────────

describe("browser tool per-agent routing with sandbox bridge", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("applies agent profile override independently of sandbox bridge URL", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({
      agentId: "dan",
      sandboxBridgeUrl: "http://browser-dan:9222",
    });
    // Default target is "sandbox" when sandboxBridgeUrl is set
    await tool.execute?.("call-1", { action: "status" });

    // Profile should be overridden to "dan" regardless of target/base URL
    const call = browserClientMocks.browserStatus.mock.calls[0];
    expect(call?.[1]).toEqual(expect.objectContaining({ profile: "dan" }));
  });

  it("uses host base URL (undefined) when target=host even with sandbox bridge", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({
      agentId: "dan",
      sandboxBridgeUrl: "http://browser-dan:9222",
    });
    await tool.execute?.("call-1", { action: "status", target: "host" });

    // target=host → base URL undefined, but profile still overridden to "dan"
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });
});

// ── Tab Tracking With Agent Context ─────────────────────────────────────────

describe("browser tool tab tracking with per-agent routing", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("tracks tabs under the agent's session key and profile", async () => {
    configWithAgentProfile("dan");
    browserClientMocks.browserOpenTab.mockResolvedValueOnce({
      targetId: "tab-dan-1",
      title: "Agent Tab",
      url: "https://example.com",
    });

    const tool = createBrowserTool({
      agentId: "dan",
      agentSessionKey: "agent:dan:main",
    });
    await tool.execute?.("call-1", {
      action: "open",
      targetUrl: "https://example.com",
    });

    expect(sessionTabRegistryMocks.trackSessionBrowserTab).toHaveBeenCalledWith({
      sessionKey: "agent:dan:main",
      targetId: "tab-dan-1",
      baseUrl: undefined,
      profile: "dan",
    });
  });

  it("untracks tabs under the agent's profile on close", async () => {
    configWithAgentProfile("dan");
    const tool = createBrowserTool({
      agentId: "dan",
      agentSessionKey: "agent:dan:main",
    });
    await tool.execute?.("call-1", {
      action: "close",
      targetId: "tab-dan-1",
    });

    expect(sessionTabRegistryMocks.untrackSessionBrowserTab).toHaveBeenCalledWith({
      sessionKey: "agent:dan:main",
      targetId: "tab-dan-1",
      baseUrl: undefined,
      profile: "dan",
    });
  });
});

// ── Tool Creation & Description ─────────────────────────────────────────────

describe("browser tool creation", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("sets target default to sandbox when sandboxBridgeUrl is provided", () => {
    const tool = createBrowserTool({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
    });
    expect(tool.description).toContain("Default: sandbox");
  });

  it("sets target default to host when no sandboxBridgeUrl", () => {
    const tool = createBrowserTool();
    expect(tool.description).toContain("Default: host");
  });

  it("includes host-blocked hint when allowHostControl is false", () => {
    const tool = createBrowserTool({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
      allowHostControl: false,
    });
    expect(tool.description).toContain("Host target blocked by policy.");
  });

  it("includes host-allowed hint when allowHostControl is not false", () => {
    const tool = createBrowserTool();
    expect(tool.description).toContain("Host target allowed.");
  });

  it("has name 'browser' and label 'Browser'", () => {
    const tool = createBrowserTool();
    expect(tool.name).toBe("browser");
    expect(tool.label).toBe("Browser");
  });
});

// ── Error Handling ──────────────────────────────────────────────────────────

describe("browser tool error handling", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("throws on unknown action", async () => {
    const tool = createBrowserTool();
    await expect(tool.execute?.("call-1", { action: "unknown-action" })).rejects.toThrow(
      "Unknown action: unknown-action",
    );
  });

  it("throws when host control is disabled and target is host", async () => {
    const tool = createBrowserTool({ allowHostControl: false });
    await expect(tool.execute?.("call-1", { action: "status", target: "host" })).rejects.toThrow(
      "Host browser control is disabled by sandbox policy.",
    );
  });

  it("throws when sandbox bridge is missing and target is sandbox", async () => {
    const tool = createBrowserTool(); // no sandboxBridgeUrl
    await expect(tool.execute?.("call-1", { action: "status", target: "sandbox" })).rejects.toThrow(
      /sandbox browser is unavailable/i,
    );
  });

  it("throws when 'open' action has no URL", async () => {
    const tool = createBrowserTool();
    await expect(tool.execute?.("call-1", { action: "open" })).rejects.toThrow(
      "targetUrl required",
    );
  });

  it("throws when 'act' action has no request", async () => {
    const tool = createBrowserTool();
    await expect(tool.execute?.("call-1", { action: "act" })).rejects.toThrow("request required");
  });

  it("throws when node target is combined with non-node target", async () => {
    const tool = createBrowserTool();
    await expect(
      tool.execute?.("call-1", {
        action: "status",
        node: "node-1",
        target: "sandbox",
      }),
    ).rejects.toThrow('node is only supported with target="node".');
  });
});

// ── Agent Profile Config Edge Cases ─────────────────────────────────────────

describe("browser tool agent profile edge cases", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("handles browser config with empty profiles object", async () => {
    configMocks.loadConfig.mockReturnValue({
      browser: { enabled: true, profiles: {} },
    });
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    // No profile for dan → stays undefined
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("handles browser config with no profiles key", async () => {
    configMocks.loadConfig.mockReturnValue({
      browser: { enabled: true },
    });
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    // No profiles → stays undefined
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("handles browser config with null browser section", async () => {
    configMocks.loadConfig.mockReturnValue({});
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    // No browser config at all → stays undefined
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );
  });

  it("only overrides for the specific agent, not all agents", async () => {
    // Config has profiles for both dan and jael
    configWithMultipleAgentProfiles(["dan", "jael"]);

    const danTool = createBrowserTool({ agentId: "dan" });
    await danTool.execute?.("call-1", { action: "status" });

    // Should be "dan", not "jael"
    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });

  it("reads config fresh on each execute call (not cached at creation)", async () => {
    // First call: no profile for dan
    configMocks.loadConfig.mockReturnValue({ browser: { profiles: {} } });
    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status" });

    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: undefined }),
    );

    vi.clearAllMocks();

    // Second call: profile for dan now exists (dynamic config reload)
    configWithAgentProfile("dan");
    await tool.execute?.("call-2", { action: "status" });

    expect(browserClientMocks.browserStatus).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profile: "dan" }),
    );
  });
});

// ── Node Proxy With Agent Profile ───────────────────────────────────────────

describe("browser tool node proxy with per-agent routing", () => {
  beforeEach(() => resetAllMocks());
  afterEach(() => resetAllMocks());

  it("passes agent profile through to node proxy requests", async () => {
    configWithAgentProfile("dan");
    nodesUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "node-1",
        displayName: "Browser Node",
        connected: true,
        caps: ["browser"],
        commands: ["browser.proxy"],
      },
    ]);

    const tool = createBrowserTool({ agentId: "dan" });
    await tool.execute?.("call-1", { action: "status", target: "node" });

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      expect.any(Object),
      expect.objectContaining({
        nodeId: "node-1",
        command: "browser.proxy",
        params: expect.objectContaining({
          profile: "dan",
        }),
      }),
    );
  });
});
