<<<<<<< HEAD
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBrowserConfig } from "./config.js";
import {
  refreshResolvedBrowserConfigFromDisk,
  resolveBrowserProfileWithHotReload,
} from "./resolved-config-refresh.js";
=======
import { beforeEach, describe, expect, it, vi } from "vitest";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

let cfgProfiles: Record<string, { cdpPort?: number; cdpUrl?: string; color?: string }> = {};

// Simulate module-level cache behavior
let cachedConfig: ReturnType<typeof buildConfig> | null = null;

function buildConfig() {
  return {
    browser: {
      enabled: true,
      color: "#FF4500",
      headless: true,
      defaultProfile: "openclaw",
      profiles: { ...cfgProfiles },
    },
  };
}

<<<<<<< HEAD
vi.mock("../config/config.js", () => ({
  createConfigIO: () => ({
    loadConfig: () => {
      // Always return fresh config for createConfigIO to simulate fresh disk read
      return buildConfig();
    },
  }),
  loadConfig: () => {
    // simulate stale loadConfig that doesn't see updates unless cache cleared
    if (!cachedConfig) {
      cachedConfig = buildConfig();
    }
    return cachedConfig;
  },
  writeConfigFile: vi.fn(async () => {}),
}));

describe("server-context hot-reload profiles", () => {
  let loadConfig: typeof import("../config/config.js").loadConfig;

  beforeAll(async () => {
    ({ loadConfig } = await import("../config/config.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
=======
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    createConfigIO: () => ({
      loadConfig: () => {
        // Always return fresh config for createConfigIO to simulate fresh disk read
        return buildConfig();
      },
    }),
    loadConfig: () => {
      // simulate stale loadConfig that doesn't see updates unless cache cleared
      if (!cachedConfig) {
        cachedConfig = buildConfig();
      }
      return cachedConfig;
    },
    clearConfigCache: vi.fn(() => {
      // Clear the simulated cache
      cachedConfig = null;
    }),
    writeConfigFile: vi.fn(async () => {}),
  };
});

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => false),
  isChromeReachable: vi.fn(async () => false),
  launchOpenClawChrome: vi.fn(async () => {
    throw new Error("launch disabled");
  }),
  resolveOpenClawUserDataDir: vi.fn(() => "/tmp/openclaw"),
  stopOpenClawChrome: vi.fn(async () => {}),
}));

vi.mock("./cdp.js", () => ({
  createTargetViaCdp: vi.fn(async () => {
    throw new Error("cdp disabled");
  }),
  normalizeCdpWsUrl: vi.fn((wsUrl: string) => wsUrl),
  snapshotAria: vi.fn(async () => ({ nodes: [] })),
  getHeadersWithAuth: vi.fn(() => ({})),
  appendCdpPath: vi.fn((cdpUrl: string, path: string) => `${cdpUrl}${path}`),
}));

vi.mock("./pw-ai.js", () => ({
  closePlaywrightBrowserConnection: vi.fn(async () => {}),
}));

vi.mock("../media/store.js", () => ({
  ensureMediaDir: vi.fn(async () => {}),
  saveMediaBuffer: vi.fn(async () => ({ path: "/tmp/fake.png" })),
}));

describe("server-context hot-reload profiles", () => {
  beforeEach(() => {
    vi.resetModules();
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    cfgProfiles = {
      openclaw: { cdpPort: 18800, color: "#FF4500" },
    };
    cachedConfig = null; // Clear simulated cache
  });

  it("forProfile hot-reloads newly added profiles from config", async () => {
    // Start with only openclaw profile
<<<<<<< HEAD
=======
    const { createBrowserRouteContext } = await import("./server-context.js");
    const { resolveBrowserConfig } = await import("./config.js");
    const { loadConfig } = await import("../config/config.js");

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    // 1. Prime the cache by calling loadConfig() first
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);

    // Verify cache is primed (without desktop)
<<<<<<< HEAD
    expect(cfg.browser?.profiles?.desktop).toBeUndefined();
=======
    expect(cfg.browser.profiles.desktop).toBeUndefined();
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };

<<<<<<< HEAD
    // Initially, "desktop" profile should not exist
    expect(
      resolveBrowserProfileWithHotReload({
        current: state,
        refreshConfigFromDisk: true,
        name: "desktop",
      }),
    ).toBeNull();
=======
    const ctx = createBrowserRouteContext({
      getState: () => state,
      refreshConfigFromDisk: true,
    });

    // Initially, "desktop" profile should not exist
    expect(() => ctx.forProfile("desktop")).toThrow(/not found/);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    // 2. Simulate adding a new profile to config (like user editing openclaw.json)
    cfgProfiles.desktop = { cdpUrl: "http://127.0.0.1:9222", color: "#0066CC" };

    // 3. Verify without clearConfigCache, loadConfig() still returns stale cached value
    const staleCfg = loadConfig();
<<<<<<< HEAD
    expect(staleCfg.browser?.profiles?.desktop).toBeUndefined(); // Cache is stale!

    // 4. Hot-reload should read fresh config for the lookup (createConfigIO().loadConfig()),
    // without flushing the global loadConfig cache.
    const profile = resolveBrowserProfileWithHotReload({
      current: state,
      refreshConfigFromDisk: true,
      name: "desktop",
    });
    expect(profile?.name).toBe("desktop");
    expect(profile?.cdpUrl).toBe("http://127.0.0.1:9222");
=======
    expect(staleCfg.browser.profiles.desktop).toBeUndefined(); // Cache is stale!

    // 4. Now forProfile should hot-reload (calls createConfigIO().loadConfig() internally)
    // It should NOT clear the global cache
    const profileCtx = ctx.forProfile("desktop");
    expect(profileCtx.profile.name).toBe("desktop");
    expect(profileCtx.profile.cdpUrl).toBe("http://127.0.0.1:9222");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    // 5. Verify the new profile was merged into the cached state
    expect(state.resolved.profiles.desktop).toBeDefined();

    // 6. Verify GLOBAL cache was NOT cleared - subsequent simple loadConfig() still sees STALE value
    // This confirms the fix: we read fresh config for the specific profile lookup without flushing the global cache
    const stillStaleCfg = loadConfig();
<<<<<<< HEAD
    expect(stillStaleCfg.browser?.profiles?.desktop).toBeUndefined();
  });

  it("forProfile still throws for profiles that don't exist in fresh config", async () => {
=======
    expect(stillStaleCfg.browser.profiles.desktop).toBeUndefined();

    // Verify clearConfigCache was not called
    const { clearConfigCache } = await import("../config/config.js");
    expect(clearConfigCache).not.toHaveBeenCalled();
  });

  it("forProfile still throws for profiles that don't exist in fresh config", async () => {
    const { createBrowserRouteContext } = await import("./server-context.js");
    const { resolveBrowserConfig } = await import("./config.js");
    const { loadConfig } = await import("../config/config.js");

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };

<<<<<<< HEAD
    // Profile that doesn't exist anywhere should still throw
    expect(
      resolveBrowserProfileWithHotReload({
        current: state,
        refreshConfigFromDisk: true,
        name: "nonexistent",
      }),
    ).toBeNull();
  });

  it("forProfile refreshes existing profile config after loadConfig cache updates", async () => {
=======
    const ctx = createBrowserRouteContext({
      getState: () => state,
      refreshConfigFromDisk: true,
    });

    // Profile that doesn't exist anywhere should still throw
    expect(() => ctx.forProfile("nonexistent")).toThrow(/not found/);
  });

  it("forProfile refreshes existing profile config after loadConfig cache updates", async () => {
    const { createBrowserRouteContext } = await import("./server-context.js");
    const { resolveBrowserConfig } = await import("./config.js");
    const { loadConfig } = await import("../config/config.js");

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };

<<<<<<< HEAD
    cfgProfiles.openclaw = { cdpPort: 19999, color: "#FF4500" };
    cachedConfig = null;

    const after = resolveBrowserProfileWithHotReload({
      current: state,
      refreshConfigFromDisk: true,
      name: "openclaw",
    });
    expect(after?.cdpPort).toBe(19999);
=======
    const ctx = createBrowserRouteContext({
      getState: () => state,
      refreshConfigFromDisk: true,
    });

    const before = ctx.forProfile("openclaw");
    expect(before.profile.cdpPort).toBe(18800);

    cfgProfiles.openclaw = { cdpPort: 19999, color: "#FF4500" };
    cachedConfig = null;

    const after = ctx.forProfile("openclaw");
    expect(after.profile.cdpPort).toBe(19999);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    expect(state.resolved.profiles.openclaw?.cdpPort).toBe(19999);
  });

  it("listProfiles refreshes config before enumerating profiles", async () => {
<<<<<<< HEAD
=======
    const { createBrowserRouteContext } = await import("./server-context.js");
    const { resolveBrowserConfig } = await import("./config.js");
    const { loadConfig } = await import("../config/config.js");

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };

<<<<<<< HEAD
    cfgProfiles.desktop = { cdpPort: 19999, color: "#0066CC" };
    cachedConfig = null;

    refreshResolvedBrowserConfigFromDisk({
      current: state,
      refreshConfigFromDisk: true,
      mode: "cached",
    });
    expect(Object.keys(state.resolved.profiles)).toContain("desktop");
=======
    const ctx = createBrowserRouteContext({
      getState: () => state,
      refreshConfigFromDisk: true,
    });

    cfgProfiles.desktop = { cdpPort: 19999, color: "#0066CC" };
    cachedConfig = null;

    const profiles = await ctx.listProfiles();
    expect(profiles.some((p) => p.name === "desktop")).toBe(true);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });
});
