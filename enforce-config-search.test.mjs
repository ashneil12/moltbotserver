/**
 * enforce-config-search.test.mjs — Tests for search provider enforcement in enforceCore().
 *
 * Verifies:
 * - Legacy "tavily" → "searxng" normalization when SearXNG is available
 * - SearXNG provider and baseUrl wiring
 * - Explicit provider passthrough (brave, searxng)
 * - No provider set when neither env var is configured
 * - Video understanding auto-enable with Gemini key
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig, ensure, env, isTruthy } from "./enforce-config-helpers.mjs";

let tmpDir;

const SEARCH_ENV_VARS = [
  "OPENCLAW_SEARCH_PROVIDER",
  "SEARXNG_BASE_URL",
  "OPENCLAW_VIDEO_ENABLED",
  "GEMINI_API_KEY",
  "OPENCLAW_BROWSER_ENABLED",
  "GATEWAY_PORT",
  "GATEWAY_BIND",
  "GATEWAY_TOKEN",
  "OPENCLAW_MANAGED_PLATFORM",
  "OPENCLAW_HEARTBEAT_INTERVAL",
  "OPENCLAW_MAX_CONCURRENT",
  "OPENCLAW_SUBAGENT_MAX_CONCURRENT",
  "OPENCLAW_WORKSPACE_DIR",
  "OPENCLAW_DATA_DIR",
  "OPENCLAW_ALLOW_IFRAME_ORIGINS",
];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "enforce-search-test-"));
  for (const v of SEARCH_ENV_VARS) {
    delete process.env[v];
  }
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const v of SEARCH_ENV_VARS) {
    delete process.env[v];
  }
});

/**
 * Replicate the search-provider-relevant subset of enforceCore() for
 * isolated testing. This mirrors the approach in enforce-config-memory.test.mjs.
 */
function enforceSearchProvider(configPath) {
  const config = readConfig(configPath);
  const tools = ensure(config, "tools");

  // Web Search Provider (reproduces lines 634–658 of enforce-config.mjs)
  let searchProvider = env("OPENCLAW_SEARCH_PROVIDER");
  const searxngBaseUrl = env("SEARXNG_BASE_URL");

  if (searchProvider === "tavily" && searxngBaseUrl) {
    searchProvider = "searxng";
  }

  if (searchProvider || searxngBaseUrl) {
    const toolsWeb = ensure(tools, "web");
    const search = ensure(toolsWeb, "search");
    if (searchProvider) {
      search.provider = searchProvider;
    }
    if (searxngBaseUrl) {
      const searxng = ensure(search, "searxng");
      if (!searxng.baseUrl) {
        searxng.baseUrl = searxngBaseUrl;
      }
    }
  }

  // Video Understanding (reproduces lines 618–632)
  const videoEnabledRaw = env("OPENCLAW_VIDEO_ENABLED");
  if (videoEnabledRaw) {
    const mediaVideo = ensure(tools, "media", "video");
    mediaVideo.enabled = isTruthy(videoEnabledRaw);
  } else if (env("GEMINI_API_KEY")) {
    const mediaVideo = ensure(tools, "media", "video");
    mediaVideo.enabled = true;
  }

  writeConfig(configPath, config);
}

// ── Tavily → SearXNG normalization ─────────────────────────────────────────

describe("enforceSearchProvider — tavily normalization", () => {
  it('normalizes "tavily" → "searxng" when SEARXNG_BASE_URL is set', () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "tavily";
    process.env.SEARXNG_BASE_URL = "http://searxng:8080";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.provider).toBe("searxng");
  });

  it('keeps "tavily" when SEARXNG_BASE_URL is NOT set', () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "tavily";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.provider).toBe("tavily");
  });

  it('passes through "brave" without normalization', () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "brave";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.provider).toBe("brave");
  });

  it('passes through "searxng" without changes', () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "searxng";
    process.env.SEARXNG_BASE_URL = "http://searxng:8080";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.provider).toBe("searxng");
  });
});

// ── SearXNG baseUrl wiring ─────────────────────────────────────────────────

describe("enforceSearchProvider — SearXNG baseUrl", () => {
  it("wires SEARXNG_BASE_URL into tools.web.search.searxng.baseUrl", () => {
    process.env.SEARXNG_BASE_URL = "http://my-searxng:9090";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.searxng.baseUrl).toBe("http://my-searxng:9090");
  });

  it("preserves existing baseUrl if already set", () => {
    process.env.SEARXNG_BASE_URL = "http://new-url:8080";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {
      tools: { web: { search: { searxng: { baseUrl: "http://existing:8080" } } } },
    });
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.web.search.searxng.baseUrl).toBe("http://existing:8080");
  });

  it("does not create search config when no search env vars are set", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools?.web?.search).toBeUndefined();
  });
});

// ── Video understanding auto-enable ────────────────────────────────────────

describe("enforceSearchProvider — video understanding", () => {
  it("auto-enables video when GEMINI_API_KEY is present", () => {
    process.env.GEMINI_API_KEY = "test-key";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.media.video.enabled).toBe(true);
  });

  it("respects explicit OPENCLAW_VIDEO_ENABLED=1", () => {
    process.env.OPENCLAW_VIDEO_ENABLED = "1";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.media.video.enabled).toBe(true);
  });

  it("respects explicit OPENCLAW_VIDEO_ENABLED=0 (disabled)", () => {
    process.env.OPENCLAW_VIDEO_ENABLED = "0";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools.media.video.enabled).toBe(false);
  });

  it("does not enable video when no Gemini key and no explicit flag", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.tools?.media?.video).toBeUndefined();
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────

describe("enforceSearchProvider — idempotency", () => {
  it("running twice with tavily normalization produces the same result", () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "tavily";
    process.env.SEARXNG_BASE_URL = "http://searxng:8080";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceSearchProvider(p);
    const first = readConfig(p);
    enforceSearchProvider(p);
    const second = readConfig(p);
    expect(second).toEqual(first);
  });

  it("preserves existing config keys not managed by search enforcement", () => {
    process.env.OPENCLAW_SEARCH_PROVIDER = "searxng";
    const p = join(tmpDir, "config.json");
    writeConfig(p, { customKey: "preserved", tools: { customTool: true } });
    enforceSearchProvider(p);
    const result = readConfig(p);
    expect(result.customKey).toBe("preserved");
    expect(result.tools.customTool).toBe(true);
  });
});
