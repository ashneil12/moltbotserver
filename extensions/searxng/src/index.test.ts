import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapturedPluginRegistration } from "../../../src/plugins/captured-registration.js";
import plugin, { createSearxngWebSearchProvider } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARXNG_BASE_URL;
});

describe("searxng bundled plugin", () => {
  it("registers one bundled web search provider", () => {
    const captured = createCapturedPluginRegistration();

    plugin.register(captured.api);

    expect(captured.webSearchProviders).toHaveLength(1);
    expect(captured.webSearchProviders[0]?.id).toBe("searxng");
  });

  it("creates a web-search tool without requiring plugin config", () => {
    const provider = createSearxngWebSearchProvider();
    const tool = provider.createTool({
      config: {} as never,
      searchConfig: {},
    });

    expect(tool).not.toBeNull();
    expect(tool?.description).toContain("SearXNG");
  });

  it("applies provider selection config to web search settings", () => {
    const provider = createSearxngWebSearchProvider();

    expect(
      provider.applySelectionConfig({
        tools: {
          web: {
            search: {
              safeSearch: "moderate",
            },
          },
        },
      }),
    ).toEqual({
      tools: {
        web: {
          search: {
            provider: "searxng",
            safeSearch: "moderate",
          },
        },
      },
    });
  });

  it("uses configured baseUrl and categories when executing searches", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "Result 1", url: "https://example.com/1", content: "Alpha" },
            { title: "Result 2", url: "https://example.com/2", content: "Beta" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createSearxngWebSearchProvider();
    const tool = provider.createTool({
      config: {} as never,
      searchConfig: {
        searxng: {
          baseUrl: "https://search.example",
          categories: "news",
        },
      },
    });

    const results = await tool.execute({ query: "status", count: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://search.example/search?q=status&format=json&categories=news",
      }),
    );
    expect(results).toEqual([
      {
        title: "Result 1",
        url: "https://example.com/1",
        description: "Alpha",
      },
    ]);
  });

  it("falls back to the env baseUrl and per-call category override", async () => {
    process.env.SEARXNG_BASE_URL = "https://env-search.example";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createSearxngWebSearchProvider();
    const tool = provider.createTool({
      config: {} as never,
      searchConfig: {},
    });

    await tool.execute({ query: "status", categories: "images" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://env-search.example/search?q=status&format=json&categories=images",
      }),
    );
  });

  it("surfaces upstream API failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "bad gateway" }), {
          status: 502,
        }),
      ),
    );

    const provider = createSearxngWebSearchProvider();
    const tool = provider.createTool({
      config: {} as never,
      searchConfig: {},
    });

    await expect(tool.execute({ query: "status" })).rejects.toThrow("SearXNG API error: 502");
  });
});
