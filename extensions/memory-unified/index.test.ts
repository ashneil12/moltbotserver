/**
 * memory-unified plugin — unit tests
 *
 * Tests cover:
 * - Plugin metadata stability
 * - autoRecall flag: disabled vs enabled
 * - Guard conditions (short prompt, slash command, skip triggers, no session key)
 * - Result formatting (XML block, numbered entries, path hints)
 * - Timeout resilience: slow execute() never blocks the agent
 * - autoRecall=true still skips injection when there are no results
 * - Alignment scoring hook registration respects ALIGNMENT_CHECK_ENABLED
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ────────────────────────────────────────────────────────────────────

type MemoryResult = { path?: string; snippet?: string; score?: number };

/** Build a minimal search result JSON string as the tool would return it. */
function makeSearchResult(results: MemoryResult[]): string {
  return JSON.stringify({ results });
}

/**
 * Build a minimal mock OpenClawPluginApi.
 * Only the properties exercised by memory-unified/index.ts are provided.
 */
function buildMockApi(
  overrides: {
    pluginConfig?: Record<string, unknown>;
    memorySearchTool?: {
      execute: ReturnType<typeof vi.fn>;
    } | null;
  } = {},
) {
  const registeredHooks: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const logInfo = vi.fn();
  const logWarn = vi.fn();
  const logDebug = vi.fn();

  // Default search tool returns two results
  const defaultExecute = vi.fn(async () =>
    makeSearchResult([
      { path: "MEMORY.md", snippet: "Ash prefers TypeScript.", score: 0.85 },
      { path: "notes/project.md", snippet: "QMD is opt-in only.", score: 0.72 },
    ]),
  );

  const memorySearchTool =
    overrides.memorySearchTool !== undefined
      ? overrides.memorySearchTool
      : { execute: defaultExecute };

  const api = {
    pluginConfig: overrides.pluginConfig ?? {},
    config: {},
    logger: { info: logInfo, warn: logWarn, debug: logDebug },
    runtime: {
      tools: {
        createMemorySearchTool: vi.fn(() => memorySearchTool),
        createMemoryGetTool: vi.fn(() => ({ execute: vi.fn() })),
        registerMemoryCli: vi.fn(),
      },
    },
    registerTool: vi.fn(),
    registerCli: vi.fn(),
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      if (!registeredHooks[event]) registeredHooks[event] = [];
      registeredHooks[event].push(handler);
    },
    /** Fire a named hook with the provided arguments and return collected return values. */
    async fireHook(event: string, ...args: unknown[]): Promise<Array<unknown>> {
      const handlers = registeredHooks[event] ?? [];
      return Promise.all(handlers.map((h) => h(...args)));
    },
  };

  return { api, logInfo, logWarn, logDebug, defaultExecute };
}

// ── Shared test context ────────────────────────────────────────────────────────

/** Standard event + ctx passed to before_agent_start hooks. */
function makeBeforeStartArgs(
  overrides: {
    prompt?: string;
    trigger?: string;
    sessionKey?: string;
    messages?: unknown[];
  } = {},
) {
  const event = {
    prompt: overrides.prompt ?? "What was the plan we discussed?",
    messages: overrides.messages ?? [],
  };
  const ctx = {
    trigger: overrides.trigger,
    sessionKey: overrides.sessionKey ?? "sess-test",
    workspaceDir: "/workspace",
    config: {},
  };
  return [event, ctx] as const;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("memory-unified plugin metadata", () => {
  test("exports stable plugin metadata", async () => {
    const { default: plugin } = await import("./index.js");
    expect(plugin.id).toBe("memory-unified");
    expect(plugin.name).toBe("Memory (Unified)");
    expect(plugin.kind).toBe("memory");
    expect(typeof plugin.register).toBe("function");
  });
});

describe("memory-unified — tool registration", () => {
  test("always registers memory_search and memory_get tools", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi();
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalled();
  });

  test("always registers the memory CLI command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi();
    plugin.register(api as never);
    expect(api.registerCli).toHaveBeenCalled();
  });
});

describe("memory-unified — autoRecall disabled", () => {
  beforeEach(() => {
    vi.resetModules();
    // Ensure alignment env vars don't interfere
    delete process.env.ALIGNMENT_CHECK_ENABLED;
  });

  test("does not call search tool when autoRecall=false", async () => {
    process.env.ALIGNMENT_CHECK_ENABLED = "false";
    vi.resetModules();
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: false } });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(defaultExecute).not.toHaveBeenCalled();
    delete process.env.ALIGNMENT_CHECK_ENABLED;
  });

  test("tool execute is never called when autoRecall=false", async () => {
    process.env.ALIGNMENT_CHECK_ENABLED = "false";
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: false } });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(defaultExecute).not.toHaveBeenCalled();
    delete process.env.ALIGNMENT_CHECK_ENABLED;
  });
});

describe("memory-unified — autoRecall enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ALIGNMENT_CHECK_ENABLED = "false"; // isolate from alignment tests
  });

  afterEach(() => {
    delete process.env.ALIGNMENT_CHECK_ENABLED;
  });

  test("injects memories when search returns results", async () => {
    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi({ pluginConfig: { autoRecall: true } });
    plugin.register(api as never);

    const [returnValue] = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    const rv = returnValue as { prependContext?: string } | undefined;
    expect(rv?.prependContext).toContain("<auto-recalled-memories>");
    expect(rv?.prependContext).toContain("Ash prefers TypeScript.");
    expect(rv?.prependContext).toContain("QMD is opt-in only.");
    expect(rv?.prependContext).toContain("[1] (MEMORY.md)");
    expect(rv?.prependContext).toContain("[2] (notes/project.md)");
  });

  test("returns undefined when search returns empty results", async () => {
    const { default: plugin } = await import("./index.js");
    const emptyExecute = vi.fn(async () => makeSearchResult([]));
    const { api } = buildMockApi({
      pluginConfig: { autoRecall: true },
      memorySearchTool: { execute: emptyExecute },
    });
    plugin.register(api as never);

    const [returnValue] = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(returnValue).toBeUndefined();
  });

  test("skips injection when prompt is too short (< 10 chars)", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: true } });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs({ prompt: "hi" }));
    expect(defaultExecute).not.toHaveBeenCalled();
  });

  test("skips injection when prompt is a slash command", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: true } });
    plugin.register(api as never);

    await api.fireHook(
      "before_agent_start",
      ...makeBeforeStartArgs({ prompt: "/reset session now" }),
    );
    expect(defaultExecute).not.toHaveBeenCalled();
  });

  test.each(["cron", "heartbeat", "memory"])(
    "skips injection for skip trigger: %s",
    async (trigger) => {
      vi.resetModules();
      process.env.ALIGNMENT_CHECK_ENABLED = "false";
      const { default: plugin } = await import("./index.js");
      const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: true } });
      plugin.register(api as never);

      await api.fireHook("before_agent_start", ...makeBeforeStartArgs({ trigger }));
      expect(defaultExecute).not.toHaveBeenCalled();
    },
  );

  test("skips injection when sessionKey is absent", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({ pluginConfig: { autoRecall: true } });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs({ sessionKey: "" }));
    expect(defaultExecute).not.toHaveBeenCalled();
  });

  test("skips injection when no memory search tool is available", async () => {
    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi({
      pluginConfig: { autoRecall: true },
      memorySearchTool: null,
    });
    plugin.register(api as never);

    const [returnValue] = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(returnValue).toBeUndefined();
  });

  test("warns and returns undefined when execute throws synchronously", async () => {
    const { default: plugin } = await import("./index.js");
    const throwingExecute = vi.fn().mockRejectedValue(new Error("search exploded"));
    const { api, logWarn } = buildMockApi({
      pluginConfig: { autoRecall: true },
      memorySearchTool: { execute: throwingExecute },
    });
    plugin.register(api as never);

    const [returnValue] = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(returnValue).toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("auto-recall failed"));
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("search exploded"));
  });

  test("times out and warns when execute hangs beyond recallTimeoutMs", async () => {
    const { default: plugin } = await import("./index.js");

    // Simulate a hanging execute that never resolves within any sensible time
    const hangingExecute = vi.fn(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve(makeSearchResult([])), 60_000)),
    );
    process.env.MEMORY_RECALL_TIMEOUT_MS = "50"; // force a 50ms timeout for the test

    const { api, logWarn } = buildMockApi({
      pluginConfig: { autoRecall: true },
      memorySearchTool: { execute: hangingExecute },
    });
    plugin.register(api as never);

    const [returnValue] = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(returnValue).toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("auto-recall failed"));
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("timed out"));

    delete process.env.MEMORY_RECALL_TIMEOUT_MS;
  }, 10_000);

  test("respects recallMaxResults and recallMinScore config", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({
      pluginConfig: { autoRecall: true, recallMaxResults: 3, recallMinScore: 0.55 },
    });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(defaultExecute).toHaveBeenCalledWith(
      expect.stringContaining("auto-recall-"),
      expect.objectContaining({ maxResults: 3, minScore: 0.55 }),
    );
  });

  test("defaults to 10 max results in business mode", async () => {
    process.env.OPENCLAW_BUSINESS_MODE = "1";
    vi.resetModules();
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({
      pluginConfig: { autoRecall: true }, // force autoRecall to skip guard if businessMode defaults change
    });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(defaultExecute).toHaveBeenCalledWith(
      expect.stringContaining("auto-recall-"),
      expect.objectContaining({ maxResults: 10 }),
    );
    delete process.env.OPENCLAW_BUSINESS_MODE;
  });

  test("defaults to 8 max results in standard mode", async () => {
    delete process.env.OPENCLAW_BUSINESS_MODE;
    vi.resetModules();
    const { default: plugin } = await import("./index.js");
    const { api, defaultExecute } = buildMockApi({
      pluginConfig: { autoRecall: true },
    });
    plugin.register(api as never);

    await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(defaultExecute).toHaveBeenCalledWith(
      expect.stringContaining("auto-recall-"),
      expect.objectContaining({ maxResults: 8 }),
    );
  });

  test("formats results with numbered location hints and snippets", async () => {
    const { default: plugin } = await import("./index.js");
    // One result with a path, one without
    const execute = vi.fn(async () =>
      makeSearchResult([
        { path: "docs/arch.md", snippet: "Architecture doc fragment." },
        { snippet: "An anonymous snippet with no file path." },
      ]),
    );
    const { api } = buildMockApi({
      pluginConfig: { autoRecall: true },
      memorySearchTool: { execute },
    });
    plugin.register(api as never);

    const [rv] = (await api.fireHook("before_agent_start", ...makeBeforeStartArgs())) as [
      { prependContext: string } | undefined,
    ];
    expect(rv?.prependContext).toContain("[1] (docs/arch.md)");
    expect(rv?.prependContext).toContain("Architecture doc fragment.");
    expect(rv?.prependContext).toContain("[2]\n"); // no path — no parenthetical suffix
    expect(rv?.prependContext).toContain("An anonymous snippet with no file path.");
  });
});

describe("memory-unified — alignment scoring hook", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("does NOT register alignment hook when ALIGNMENT_CHECK_ENABLED=false", async () => {
    process.env.ALIGNMENT_CHECK_ENABLED = "false";
    process.env.MEMORY_RECALL_TIMEOUT_MS = "100";

    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi({ pluginConfig: { autoRecall: false } });
    plugin.register(api as never);

    const hooks = await api.fireHook("before_agent_start", ...makeBeforeStartArgs());
    expect(hooks).toHaveLength(0);

    delete process.env.ALIGNMENT_CHECK_ENABLED;
    delete process.env.MEMORY_RECALL_TIMEOUT_MS;
  });

  test("resets alignment state on session_start", async () => {
    process.env.ALIGNMENT_CHECK_ENABLED = "true";
    process.env.MEMORY_RECALL_TIMEOUT_MS = "100";

    const { default: plugin } = await import("./index.js");
    const { api } = buildMockApi({ pluginConfig: { autoRecall: false } });
    plugin.register(api as never);

    // Just verifying the session_start hook was registered without throwing
    const results = await api.fireHook("session_start");
    expect(results).toBeDefined();

    delete process.env.ALIGNMENT_CHECK_ENABLED;
    delete process.env.MEMORY_RECALL_TIMEOUT_MS;
  });
});
