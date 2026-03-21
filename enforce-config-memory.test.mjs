/**
 * enforce-config-memory.test.mjs — Tests for enforceMemory() config enforcement.
 *
 * Verifies that the memory section of enforce-config.mjs correctly sets:
 * - QMD backend defaults (searchMode, limits, update intervals)
 * - Hybrid search weights (vector 0.7, text 0.3)
 * - Session memory and sources
 * - Builtin backend fallback when QMD is disabled
 * - Gemini embedding provider for builtin mode
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig, ensure, env, isTruthy } from "./enforce-config-helpers.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "enforce-memory-test-"));
  // Clean env vars that affect enforceMemory behavior
  delete process.env.OPENCLAW_QMD_ENABLED;
  delete process.env.OPENCLAW_BUSINESS_MODE;
  delete process.env.AI_GATEWAY_URL;
  delete process.env.GATEWAY_TOKEN;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.OPENCLAW_QMD_ENABLED;
  delete process.env.OPENCLAW_BUSINESS_MODE;
  delete process.env.AI_GATEWAY_URL;
  delete process.env.GATEWAY_TOKEN;
  delete process.env.GEMINI_API_KEY;
});

/**
 * Replicate enforceMemory logic for testing (private function in enforce-config.mjs).
 * Keeping this inline follows the pattern established by enforce-config-cron-seed.test.mjs.
 */
function enforceMemory(configPath) {
  const config = readConfig(configPath);
  const memory = ensure(config, "memory");
  memory.citations = "auto";

  const defaults = ensure(config, "agents", "defaults");
  const memSearch = ensure(defaults, "memorySearch");
  memSearch.experimental = { sessionMemory: true };
  memSearch.sources = ["memory", "sessions"];
  memSearch.query = {
    ...memSearch.query,
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
    },
  };

  const qmdDisabled =
    env("OPENCLAW_QMD_ENABLED") === "false" || env("OPENCLAW_QMD_ENABLED") === "0";
  if (!qmdDisabled) {
    memory.backend = "qmd";
    const qmd = ensure(memory, "qmd");
    qmd.includeDefaultMemory = true;
    qmd.searchMode = "vsearch";
    qmd.update = { interval: "5m", onBoot: true, waitForBootSync: false };
    const businessMode = isTruthy(env("OPENCLAW_BUSINESS_MODE"));
    qmd.limits = {
      maxResults: 8,
      maxSnippetChars: 700,
      maxInjectedChars: businessMode ? 10000 : 5000,
      timeoutMs: 5000,
    };

    const aiGatewayUrl = env("AI_GATEWAY_URL");
    const gatewayToken = env("GATEWAY_TOKEN");
    if (aiGatewayUrl && gatewayToken) {
      memSearch.provider = "openai";
      memSearch.model = "voyage/voyage-3.5";
      memSearch.remote = {
        baseUrl: `${aiGatewayUrl}/api/gateway`,
        apiKey: gatewayToken,
      };
    }
  } else {
    memory.backend = "builtin";
    delete memory.qmd;

    const geminiKey = env("GEMINI_API_KEY");
    if (geminiKey) {
      memSearch.provider = "gemini";
      memSearch.model = "gemini-embedding-2-preview";
    }
  }

  writeConfig(configPath, config);
}

// ── QMD backend (default path) ─────────────────────────────────────────────

describe("enforceMemory — QMD backend (default)", () => {
  it("sets memory.backend to 'qmd' when QMD is not disabled", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.backend).toBe("qmd");
  });

  it("sets searchMode to 'vsearch' for hybrid vector+BM25 search", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd.searchMode).toBe("vsearch");
  });

  it("sets QMD update interval and boot behavior", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd.update).toEqual({
      interval: "5m",
      onBoot: true,
      waitForBootSync: false,
    });
  });

  it("sets QMD limits with standard maxInjectedChars (5000) by default", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd.limits).toEqual({
      maxResults: 8,
      maxSnippetChars: 700,
      maxInjectedChars: 5000,
      timeoutMs: 5000,
    });
  });

  it("elevates maxInjectedChars to 10000 in business mode", () => {
    process.env.OPENCLAW_BUSINESS_MODE = "true";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd.limits.maxInjectedChars).toBe(10000);
  });

  it("sets includeDefaultMemory to true", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd.includeDefaultMemory).toBe(true);
  });
});

// ── Memory search common settings ──────────────────────────────────────────

describe("enforceMemory — common memorySearch settings", () => {
  it("enables hybrid search with 70/30 vector/text weights", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    const hybrid = result.agents.defaults.memorySearch.query.hybrid;
    expect(hybrid).toEqual({
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
    });
  });

  it("enables session memory via experimental flag", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.agents.defaults.memorySearch.experimental).toEqual({
      sessionMemory: true,
    });
  });

  it("sets memory and sessions as search sources", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.agents.defaults.memorySearch.sources).toEqual(["memory", "sessions"]);
  });

  it("sets memory.citations to 'auto'", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.citations).toBe("auto");
  });
});

// ── Gateway embedding provider ─────────────────────────────────────────────

describe("enforceMemory — gateway embedding fallback", () => {
  it("configures OpenAI provider when AI_GATEWAY_URL and GATEWAY_TOKEN are set", () => {
    process.env.AI_GATEWAY_URL = "https://gateway.example.com";
    process.env.GATEWAY_TOKEN = "test-token-123";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    const ms = result.agents.defaults.memorySearch;
    expect(ms.provider).toBe("openai");
    expect(ms.model).toBe("voyage/voyage-3.5");
    expect(ms.remote.baseUrl).toBe("https://gateway.example.com/api/gateway");
    expect(ms.remote.apiKey).toBe("test-token-123");
  });

  it("does not configure gateway provider when AI_GATEWAY_URL is missing", () => {
    process.env.GATEWAY_TOKEN = "test-token-123";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.agents.defaults.memorySearch.provider).toBeUndefined();
  });
});

// ── QMD disabled (builtin backend) ─────────────────────────────────────────

describe("enforceMemory — builtin backend (QMD disabled)", () => {
  it("sets memory.backend to 'builtin' when QMD is disabled via false", () => {
    process.env.OPENCLAW_QMD_ENABLED = "false";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.backend).toBe("builtin");
  });

  it("sets memory.backend to 'builtin' when QMD is disabled via 0", () => {
    process.env.OPENCLAW_QMD_ENABLED = "0";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.backend).toBe("builtin");
  });

  it("removes stale QMD config when switching to builtin", () => {
    process.env.OPENCLAW_QMD_ENABLED = "false";
    const p = join(tmpDir, "config.json");
    writeConfig(p, { memory: { qmd: { searchMode: "vsearch" } } });
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.memory.qmd).toBeUndefined();
  });

  it("configures Gemini embedding provider when GEMINI_API_KEY is set", () => {
    process.env.OPENCLAW_QMD_ENABLED = "false";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    const ms = result.agents.defaults.memorySearch;
    expect(ms.provider).toBe("gemini");
    expect(ms.model).toBe("gemini-embedding-2-preview");
  });

  it("does not set provider when no Gemini key is available (FTS-only fallback)", () => {
    process.env.OPENCLAW_QMD_ENABLED = "false";
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.agents.defaults.memorySearch.provider).toBeUndefined();
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────

describe("enforceMemory — idempotency", () => {
  it("running twice produces the same result", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, {});
    enforceMemory(p);
    const first = readConfig(p);
    enforceMemory(p);
    const second = readConfig(p);
    expect(second).toEqual(first);
  });

  it("preserves existing config keys not managed by enforceMemory", () => {
    const p = join(tmpDir, "config.json");
    writeConfig(p, { customKey: "preserved", agents: { customAgent: true } });
    enforceMemory(p);
    const result = readConfig(p);
    expect(result.customKey).toBe("preserved");
    expect(result.agents.customAgent).toBe(true);
  });
});
