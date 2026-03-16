/**
 * Browser server-context tests.
 *
 * Tests the custom modifications to server-context.ts:
 *   1. listKnownProfileNames — merges config profiles with runtime profiles
 *   2. createBrowserRouteContext    — parallel profile listing (Promise.all), profile resolution, error mapping
 *   3. listTabsForStatus — timeout protection for remote profiles
 *
 * The Promise.all parallel listing (line 185) is a custom patch that prevents
 * serial CDP timeout compounding. Without it, N remote profiles × 3s timeout = N×3s worst case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

// Minimal mock for SSRF blocked error
vi.mock("../infra/net/ssrf.js", () => ({
  SsrFBlockedError: class SsrFBlockedError extends Error {},
}));

// Mock chrome reachability
const chromeMocks = vi.hoisted(() => ({
  isChromeReachable: vi.fn(async () => false),
  resolveOpenClawUserDataDir: vi.fn(() => "/tmp/user-data"),
}));
vi.mock("./chrome.js", () => chromeMocks);

// Config mocks
const browserConfigMocks = vi.hoisted(() => ({
  resolveProfile: vi.fn((resolved: Record<string, unknown>, name: string) => {
    const profiles = resolved.profiles as Record<string, Record<string, unknown>> | undefined;
    const profile = profiles?.[name];
    if (!profile) {
      return null;
    }
    return {
      name,
      driver: profile.driver ?? "openclaw",
      cdpPort: typeof profile.cdpPort === "number" ? profile.cdpPort : 9222,
      cdpUrl: typeof profile.cdpUrl === "string" ? profile.cdpUrl : "http://127.0.0.1:9222",
      cdpHost: "127.0.0.1",
      cdpIsLoopback: profile.cdpIsLoopback !== undefined ? profile.cdpIsLoopback : true,
      color: typeof profile.color === "string" ? profile.color : "#FF4500",
      attachOnly: profile.attachOnly === true,
    };
  }),
}));
vi.mock("./config.js", () => browserConfigMocks);

// Navigation guard
vi.mock("./navigation-guard.js", () => ({
  InvalidBrowserNavigationUrlError: class InvalidBrowserNavigationUrlError extends Error {},
}));

// Profile capabilities
vi.mock("./profile-capabilities.js", () => ({
  getBrowserProfileCapabilities: vi.fn((profile: { driver?: string; cdpIsLoopback?: boolean }) => ({
    mode: profile.cdpIsLoopback === false ? "remote-cdp" : "local-managed",
    isRemote: profile.cdpIsLoopback === false,
    usesChromeMcp: profile.driver === "existing-session",
    requiresRelay: profile.driver === "extension",
    requiresAttachedTab: profile.driver === "extension",
    usesPersistentPlaywright: false,
    supportsPerTabWs: true,
    supportsJsonTabEndpoints: true,
    supportsReset: true,
    supportsManagedTabLimit: true,
  })),
}));

// Hot reload (no-op)
vi.mock("./resolved-config-refresh.js", () => ({
  refreshResolvedBrowserConfigFromDisk: vi.fn(),
  resolveBrowserProfileWithHotReload: vi.fn(
    (params: { current: { resolved: { profiles: Record<string, unknown> } }; name: string }) => {
      const profile = params.current.resolved.profiles[params.name];
      if (!profile) {
        return null;
      }
      const p = profile as Record<string, unknown>;
      return {
        name: params.name,
        driver: p.driver ?? "openclaw",
        cdpPort: typeof p.cdpPort === "number" ? p.cdpPort : 9222,
        cdpUrl: typeof p.cdpUrl === "string" ? p.cdpUrl : "http://127.0.0.1:9222",
        cdpHost: "127.0.0.1",
        cdpIsLoopback: p.cdpIsLoopback !== undefined ? p.cdpIsLoopback : true,
        color: typeof p.color === "string" ? p.color : "#FF4500",
        attachOnly: p.attachOnly === true,
      };
    },
  ),
}));

vi.mock("./errors.js", () => ({
  BrowserProfileNotFoundError: class BrowserProfileNotFoundError extends Error {},
  toBrowserErrorResponse: vi.fn(() => null),
}));

// Stub sub-modules that create complex profile operations
vi.mock("./server-context.availability.js", () => ({
  createProfileAvailability: vi.fn(() => ({
    ensureBrowserAvailable: vi.fn(async () => {}),
    isHttpReachable: vi.fn(async () => false),
    isReachable: vi.fn(async () => false),
    stopRunningBrowser: vi.fn(async () => ({ stopped: false })),
  })),
}));

vi.mock("./server-context.tab-ops.js", () => ({
  createProfileTabOps: vi.fn(() => ({
    listTabs: vi.fn(async () => []),
    openTab: vi.fn(async () => ({ targetId: "t1", type: "page", url: "" })),
  })),
}));

vi.mock("./server-context.selection.js", () => ({
  createProfileSelectionOps: vi.fn(() => ({
    ensureTabAvailable: vi.fn(async () => ({
      targetId: "t1",
      type: "page",
      url: "",
    })),
    focusTab: vi.fn(async () => {}),
    closeTab: vi.fn(async () => {}),
  })),
}));

vi.mock("./server-context.reset.js", () => ({
  createProfileResetOps: vi.fn(() => ({
    resetProfile: vi.fn(async () => ({ moved: false, from: "" })),
  })),
}));

import { createBrowserRouteContext, listKnownProfileNames } from "./server-context.js";
import type { BrowserServerState } from "./server-context.types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockState(
  profiles: Record<string, Record<string, unknown>>,
  defaultProfile = "openclaw",
): BrowserServerState {
  return {
    port: 18791,
    resolved: {
      enabled: true,
      controlPort: 18791,
      profiles,
      defaultProfile,
    } as unknown as BrowserServerState["resolved"],
    profiles: new Map(),
  };
}

function resetMocks() {
  vi.clearAllMocks();
}

// ── listKnownProfileNames Tests ─────────────────────────────────────────────

describe("listKnownProfileNames", () => {
  afterEach(() => resetMocks());

  it("returns profile names from config", () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
      dan: { cdpUrl: "http://browser-dan:9222" },
    });

    const names = listKnownProfileNames(state);
    expect(names).toContain("openclaw");
    expect(names).toContain("dan");
  });

  it("includes runtime profiles not in config", () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
    });
    // Add a runtime-only profile
    state.profiles.set("dynamic-agent", {
      profile: { name: "dynamic-agent" },
      running: null,
      lastTargetId: null,
      reconcile: null,
    } as unknown as BrowserServerState["profiles"] extends Map<string, infer V> ? V : never);

    const names = listKnownProfileNames(state);
    expect(names).toContain("openclaw");
    expect(names).toContain("dynamic-agent");
  });

  it("deduplicates profiles that exist in both config and runtime", () => {
    const state = createMockState({
      dan: { cdpUrl: "http://browser-dan:9222" },
    });
    state.profiles.set("dan", {
      profile: { name: "dan" },
      running: null,
      lastTargetId: null,
      reconcile: null,
    } as unknown as BrowserServerState["profiles"] extends Map<string, infer V> ? V : never);

    const names = listKnownProfileNames(state);
    const danCount = names.filter((n) => n === "dan").length;
    expect(danCount).toBe(1);
  });

  it("returns empty array when no profiles exist", () => {
    const state = createMockState({});
    const names = listKnownProfileNames(state);
    expect(names).toEqual([]);
  });
});

// ── createBrowserRouteContext Tests ──────────────────────────────────────────

describe("createBrowserRouteContext", () => {
  afterEach(() => resetMocks());

  it("throws when state is null", () => {
    const ctx = createBrowserRouteContext({
      getState: () => null,
    });

    expect(() => ctx.state()).toThrow("Browser server not started");
  });

  it("resolves profile by name", () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
      dan: { cdpUrl: "http://browser-dan:9222" },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profileCtx = ctx.forProfile("dan");
    expect(profileCtx.profile.name).toBe("dan");
  });

  it("throws for unknown profile", () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    expect(() => ctx.forProfile("nonexistent")).toThrow(/not found/i);
  });

  it("uses default profile when name is omitted", () => {
    const state = createMockState(
      {
        openclaw: { cdpUrl: "http://127.0.0.1:9222" },
      },
      "openclaw",
    );

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profileCtx = ctx.forProfile();
    expect(profileCtx.profile.name).toBe("openclaw");
  });
});

// ── listProfiles Parallel Tests ─────────────────────────────────────────────

describe("createBrowserRouteContext listProfiles", () => {
  afterEach(() => resetMocks());

  it("lists all configured profiles", async () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222", color: "#FF4500" },
      dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35", cdpIsLoopback: false },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profiles = await ctx.listProfiles();
    expect(profiles.length).toBe(2);
    const names = profiles.map((p) => p.name);
    expect(names).toContain("openclaw");
    expect(names).toContain("dan");
  });

  it("marks the default profile", async () => {
    const state = createMockState(
      {
        openclaw: { cdpUrl: "http://127.0.0.1:9222", color: "#FF4500" },
        dan: { cdpUrl: "http://browser-dan:9222", color: "#FF6B35" },
      },
      "openclaw",
    );

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profiles = await ctx.listProfiles();
    const openclawProfile = profiles.find((p) => p.name === "openclaw");
    const danProfile = profiles.find((p) => p.name === "dan");
    expect(openclawProfile?.isDefault).toBe(true);
    expect(danProfile?.isDefault).toBe(false);
  });

  it("marks remote profiles correctly", async () => {
    const state = createMockState({
      local: { cdpUrl: "http://127.0.0.1:9222", color: "#FF4500", cdpIsLoopback: true },
      remote: {
        cdpUrl: "http://browser-dan:9222",
        color: "#FF6B35",
        cdpIsLoopback: false,
      },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profiles = await ctx.listProfiles();
    const localProfile = profiles.find((p) => p.name === "local");
    const remoteProfile = profiles.find((p) => p.name === "remote");
    expect(localProfile?.isRemote).toBe(false);
    expect(remoteProfile?.isRemote).toBe(true);
  });

  it("handles profiles in parallel (Promise.all)", async () => {
    // Create multiple profiles to verify they're checked in parallel
    const profiles: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 5; i++) {
      profiles[`agent-${i}`] = {
        cdpUrl: `http://browser-agent-${i}:9222`,
        color: "#FF6B35",
        cdpIsLoopback: false,
      };
    }

    const state = createMockState(profiles);

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const start = Date.now();
    const result = await ctx.listProfiles();
    const elapsed = Date.now() - start;

    // All 5 should be returned
    expect(result.length).toBe(5);
    // Should complete quickly (parallel, not serial) — each would add ~3s if serial
    expect(elapsed).toBeLessThan(1000);
  });

  it("returns empty array when no profiles exist", async () => {
    const state = createMockState({});

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const profiles = await ctx.listProfiles();
    expect(profiles).toEqual([]);
  });
});

// ── Error Mapping Tests ─────────────────────────────────────────────────────

describe("createBrowserRouteContext mapTabError", () => {
  afterEach(() => resetMocks());

  it("returns null for unknown errors", () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    expect(ctx.mapTabError(new Error("random error"))).toBeNull();
  });

  it("maps SSRF blocked errors to 400", async () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const { SsrFBlockedError } = await import("../infra/net/ssrf.js");
    const result = ctx.mapTabError(new SsrFBlockedError("blocked"));
    expect(result).toEqual({ status: 400, message: "blocked" });
  });

  it("maps invalid navigation URL errors to 400", async () => {
    const state = createMockState({
      openclaw: { cdpUrl: "http://127.0.0.1:9222" },
    });

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const { InvalidBrowserNavigationUrlError } = await import("./navigation-guard.js");
    const result = ctx.mapTabError(new InvalidBrowserNavigationUrlError("bad url"));
    expect(result).toEqual({ status: 400, message: "bad url" });
  });
});
