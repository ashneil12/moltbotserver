/**
 * Browser control service tests.
 *
 * Tests the service lifecycle and per-agent workspace registration:
 *   1. startBrowserControlServiceFromConfig — startup, per-agent download routing
 *   2. stopBrowserControlService — cleanup, workspace deregistration
 *   3. getBrowserControlState — state management
 *   4. Per-agent download workspace isolation
 *
 * The download workspace registration loop (lines 52-71 of control-service.ts)
 * is a custom addition that maps each agent's CDP URL to their workspace directory.
 * Without this, browser downloads from agent browsers land in the wrong workspace.
 */
// oxlint-disable typescript/no-explicit-any -- vi.spyOn mock implementations
// require `as any` casts to satisfy branded return types from the original
// function signatures. This is test-only code with no production impact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ── Mocks ───────────────────────────────────────────────────────────────────
import * as agentScopeMod from "../agents/agent-scope.js";
const agentScopeMocks = {
  listAgentIds: vi.spyOn(agentScopeMod, "listAgentIds").mockImplementation((): string[] => []),
  resolveAgentWorkspaceDir: vi
    .spyOn(agentScopeMod, "resolveAgentWorkspaceDir")
    .mockImplementation((_cfg: unknown, agentId: string) => `/home/node/data/workspace-${agentId}`),
};

import * as configMod from "../config/config.js";
const configMocks = {
  loadConfig: vi.spyOn(configMod, "loadConfig").mockImplementation(() => ({ browser: {} }) as any),
};

import * as browserConfigMod from "./config.js";
const browserConfigMocks = {
  resolveBrowserConfig: vi
    .spyOn(browserConfigMod, "resolveBrowserConfig")
    .mockImplementation((): any => ({
      enabled: false,
      controlPort: 18791,
      profiles: {},
      defaultProfile: "openclaw",
    })),
};

import * as controlAuthMod from "./control-auth.js";
const controlAuthMocks = {
  ensureBrowserControlAuth: vi
    .spyOn(controlAuthMod, "ensureBrowserControlAuth")
    .mockImplementation(async () => ({ generatedToken: false }) as any),
};

import * as downloadRegistryMod from "./download-workspace-registry.js";
const downloadRegistryMocks = {
  setDownloadWorkspaceForCdp: vi
    .spyOn(downloadRegistryMod, "setDownloadWorkspaceForCdp")
    .mockImplementation(() => {}),
};

import * as runtimeLifecycleMod from "./runtime-lifecycle.js";
const runtimeMocks = {
  createBrowserRuntimeState: vi
    .spyOn(runtimeLifecycleMod, "createBrowserRuntimeState")
    .mockImplementation(
      async (params: Record<string, unknown>) =>
        ({
          resolved: params.resolved,
          profiles: new Map(),
          server: null,
        }) as any,
    ),
  stopBrowserRuntime: vi
    .spyOn(runtimeLifecycleMod, "stopBrowserRuntime")
    .mockImplementation(async (params: Record<string, unknown>) => {
      const clearState = params.clearState as () => void;
      clearState();
    }),
};

import * as serverContextMod from "./server-context.js";
// _serverContextMocks: held for vi.spyOn side effect (prevents real server-context import)
const _serverContextMocks = {
  createBrowserRouteContext: vi
    .spyOn(serverContextMod, "createBrowserRouteContext")
    .mockImplementation(() => ({}) as any),
};

// Logger mock (noop)
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

import {
  getBrowserControlState,
  startBrowserControlServiceFromConfig,
  stopBrowserControlService,
} from "./control-service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetAllMocks() {
  vi.clearAllMocks();
  configMocks.loadConfig.mockReturnValue({ browser: {} });
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: false,
    controlPort: 18791,
    profiles: {},
    defaultProfile: "openclaw",
  });
  agentScopeMocks.listAgentIds.mockReturnValue([]);
}

function enableBrowserWithProfiles(
  profiles: Record<string, { cdpUrl?: string; color?: string }>,
  agentIds: string[] = [],
) {
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: true,
    controlPort: 18791,
    profiles,
    defaultProfile: "openclaw",
  });
  agentScopeMocks.listAgentIds.mockReturnValue(agentIds);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("browser control service state", () => {
  beforeEach(() => resetAllMocks());
  afterEach(async () => {
    // Make sure we stop any started services to reset module-level state
    await stopBrowserControlService();
    resetAllMocks();
  });

  it("returns null state when service is not started", () => {
    expect(getBrowserControlState()).toBeNull();
  });

  it("returns null when browser is disabled", async () => {
    browserConfigMocks.resolveBrowserConfig.mockReturnValue({
      enabled: false,
      controlPort: 18791,
      profiles: {},
      defaultProfile: "openclaw",
    });

    const result = await startBrowserControlServiceFromConfig();
    expect(result).toBeNull();
    expect(getBrowserControlState()).toBeNull();
  });

  it("creates state when browser is enabled", async () => {
    enableBrowserWithProfiles({});

    const result = await startBrowserControlServiceFromConfig();
    expect(result).not.toBeNull();
    expect(getBrowserControlState()).not.toBeNull();
  });

  it("returns existing state on duplicate start call", async () => {
    enableBrowserWithProfiles({});

    const first = await startBrowserControlServiceFromConfig();
    const second = await startBrowserControlServiceFromConfig();
    expect(first).toBe(second);
    // createBrowserRuntimeState should only be called once
    expect(runtimeMocks.createBrowserRuntimeState).toHaveBeenCalledTimes(1);
  });
});

describe("per-agent download workspace registration", () => {
  beforeEach(() => resetAllMocks());
  afterEach(async () => {
    await stopBrowserControlService();
    resetAllMocks();
  });

  it("registers workspace for a single agent profile", async () => {
    enableBrowserWithProfiles(
      {
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
      },
      ["dan"],
    );

    await startBrowserControlServiceFromConfig();

    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-dan:9222",
      "/home/node/data/workspace-dan",
    );
  });

  it("registers workspaces for multiple agent profiles", async () => {
    enableBrowserWithProfiles(
      {
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
        jael: { cdpUrl: "http://browser-jael:9222", color: "#7B2D8E" },
        nehemiah: { cdpUrl: "http://browser-nehemiah:9222", color: "#2196F3" },
      },
      ["dan", "jael", "nehemiah"],
    );

    await startBrowserControlServiceFromConfig();

    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledTimes(3);
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-dan:9222",
      "/home/node/data/workspace-dan",
    );
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-jael:9222",
      "/home/node/data/workspace-jael",
    );
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-nehemiah:9222",
      "/home/node/data/workspace-nehemiah",
    );
  });

  it("skips profiles without cdpUrl", async () => {
    enableBrowserWithProfiles(
      {
        "no-cdp": { color: "#FF0000" }, // no cdpUrl
      },
      [],
    );

    await startBrowserControlServiceFromConfig();

    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).not.toHaveBeenCalled();
  });

  it("uses profile name as fallback when not in agentIds list", async () => {
    enableBrowserWithProfiles(
      {
        "unknown-profile": { cdpUrl: "http://browser-unknown:9222", color: "#999" },
      },
      ["dan", "jael"], // "unknown-profile" is NOT in the agent IDs list
    );

    await startBrowserControlServiceFromConfig();

    // Falls back to the profile name ("unknown-profile") as the agentId
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-unknown:9222",
      "/home/node/data/workspace-unknown-profile",
    );
  });

  it("resolves workspace using matched agentId, not just profile name", async () => {
    enableBrowserWithProfiles(
      {
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
      },
      ["dan"],
    );

    await startBrowserControlServiceFromConfig();

    // resolveAgentWorkspaceDir should be called with the matched agentId
    expect(agentScopeMocks.resolveAgentWorkspaceDir).toHaveBeenCalledWith(expect.anything(), "dan");
  });

  it("survives workspace resolution errors gracefully", async () => {
    enableBrowserWithProfiles(
      {
        "broken-agent": { cdpUrl: "http://browser-broken:9222", color: "#FF0000" },
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
      },
      ["dan"],
    );

    // First call (broken-agent) throws, second call (dan) succeeds
    agentScopeMocks.resolveAgentWorkspaceDir
      .mockImplementationOnce(() => {
        throw new Error("workspace dir not found");
      })
      .mockReturnValueOnce("/home/node/data/workspace-dan");

    // Should NOT throw — errors are caught per-profile
    await startBrowserControlServiceFromConfig();

    // Dan's workspace should still be registered
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-dan:9222",
      "/home/node/data/workspace-dan",
    );
  });
});

describe("browser control service shutdown", () => {
  beforeEach(() => resetAllMocks());
  afterEach(async () => {
    await stopBrowserControlService();
    resetAllMocks();
  });

  it("does nothing when not started", async () => {
    await stopBrowserControlService();
    expect(runtimeMocks.stopBrowserRuntime).not.toHaveBeenCalled();
  });

  it("clears download registry for all profiles on stop", async () => {
    enableBrowserWithProfiles(
      {
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
        jael: { cdpUrl: "http://browser-jael:9222", color: "#7B2D8E" },
      },
      ["dan", "jael"],
    );

    await startBrowserControlServiceFromConfig();
    vi.clearAllMocks();

    await stopBrowserControlService();

    // Should clear both registrations (null = delete)
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-dan:9222",
      null,
    );
    expect(downloadRegistryMocks.setDownloadWorkspaceForCdp).toHaveBeenCalledWith(
      "http://browser-jael:9222",
      null,
    );
  });

  it("resets state to null after stop", async () => {
    enableBrowserWithProfiles({});

    await startBrowserControlServiceFromConfig();
    expect(getBrowserControlState()).not.toBeNull();

    await stopBrowserControlService();
    expect(getBrowserControlState()).toBeNull();
  });

  it("allows restart after stop", async () => {
    enableBrowserWithProfiles({});

    await startBrowserControlServiceFromConfig();
    await stopBrowserControlService();
    expect(getBrowserControlState()).toBeNull();

    // Should be able to start again
    const result = await startBrowserControlServiceFromConfig();
    expect(result).not.toBeNull();
    expect(runtimeMocks.createBrowserRuntimeState).toHaveBeenCalledTimes(2);
  });
});

describe("browser control auth", () => {
  beforeEach(() => resetAllMocks());
  afterEach(async () => {
    await stopBrowserControlService();
    resetAllMocks();
  });

  it("calls ensureBrowserControlAuth on startup", async () => {
    enableBrowserWithProfiles({});
    await startBrowserControlServiceFromConfig();

    expect(controlAuthMocks.ensureBrowserControlAuth).toHaveBeenCalledWith({
      cfg: expect.anything(),
    });
  });

  it("survives auth failure gracefully", async () => {
    enableBrowserWithProfiles({});
    controlAuthMocks.ensureBrowserControlAuth.mockRejectedValueOnce(
      new Error("auth config failed"),
    );

    // Should NOT throw — auth errors are caught
    const result = await startBrowserControlServiceFromConfig();
    expect(result).not.toBeNull();
  });
});
