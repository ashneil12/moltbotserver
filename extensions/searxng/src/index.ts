import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search";

const DEFAULT_SEARXNG_BASE_URL = "http://searxng:8080";

type SearchConfigRecord = Record<string, unknown>;

const SearxngSearchSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: 10,
      }),
    ),
    categories: Type.Optional(
      Type.String({
        description: "Optional SearXNG categories override such as general, news, or images.",
      }),
    ),
  },
  { additionalProperties: false },
);

type SearxngPluginConfig = {
  webSearch?: {
    baseUrl?: string;
    categories?: string;
  };
};

type SearxngResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type SearxngResponse = {
  results?: unknown;
};

function cloneRecord<T extends Record<string, unknown> | undefined>(value: T): Record<string, unknown> {
  return value ? { ...value } : {};
}

function getScopedCredentialValue(searchConfig: SearchConfigRecord | undefined, key: string): unknown {
  const scoped = searchConfig?.[key];
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return undefined;
  }
  return (scoped as SearchConfigRecord).apiKey;
}

function setScopedCredentialValue(
  searchConfigTarget: SearchConfigRecord,
  key: string,
  value: unknown,
): void {
  const scoped = searchConfigTarget[key];
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    searchConfigTarget[key] = { apiKey: value };
    return;
  }
  (scoped as SearchConfigRecord).apiKey = value;
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean } = {},
): string | undefined {
  const raw = params[key];
  if (typeof raw !== "string") {
    if (options.required) {
      throw new Error(`${key} required`);
    }
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    if (options.required) {
      throw new Error(`${key} required`);
    }
    return undefined;
  }
  return value;
}

function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { integer?: boolean } = {},
): number | undefined {
  const raw = params[key];
  let value: number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw.trim());
    if (Number.isFinite(parsed)) {
      value = parsed;
    }
  }
  if (value === undefined) {
    return undefined;
  }
  return options.integer ? Math.trunc(value) : value;
}

function applyProviderSelectionConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = cloneRecord(config);
  const tools = cloneRecord(next.tools as Record<string, unknown> | undefined);
  const web = cloneRecord(tools.web as Record<string, unknown> | undefined);
  const search = cloneRecord(web.search as Record<string, unknown> | undefined);

  search.provider = "searxng";
  web.search = search;
  tools.web = web;
  next.tools = tools;

  return next;
}

function resolveSearxngPluginConfig(searchConfig?: SearchConfigRecord): SearxngPluginConfig["webSearch"] {
  const searxng = searchConfig?.searxng;
  return searxng && typeof searxng === "object" && !Array.isArray(searxng)
    ? (searxng as SearxngPluginConfig["webSearch"])
    : undefined;
}

function resolveSearxngBaseUrl(searchConfig?: SearchConfigRecord): string {
  const configured = resolveSearxngPluginConfig(searchConfig)?.baseUrl?.trim();
  const fromEnv = process.env.SEARXNG_BASE_URL?.trim();
  return configured || fromEnv || DEFAULT_SEARXNG_BASE_URL;
}

function resolveSearxngCategories(searchConfig?: SearchConfigRecord): string {
  return resolveSearxngPluginConfig(searchConfig)?.categories?.trim() || "general";
}

export function createSearxngWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "searxng",
    label: "SearXNG Search",
    hint: "Self-hosted metasearch with no API key required",
    requiresCredential: false,
    envVars: [],
    placeholder: "(no key needed)",
    signupUrl: "https://github.com/searxng/searxng",
    docsUrl: "https://docs.openclaw.ai/tools/web",
    autoDetectOrder: 90,
    credentialPath: "",
    inactiveSecretPaths: [],
    getCredentialValue: (searchConfig) => getScopedCredentialValue(searchConfig, "searxng"),
    setCredentialValue: (searchConfigTarget, value) =>
      setScopedCredentialValue(searchConfigTarget, "searxng", value),
    applySelectionConfig: (config) => applyProviderSelectionConfig(config),
    createTool: (ctx) => {
      const baseUrl = resolveSearxngBaseUrl(ctx.searchConfig);
      const defaultCategories = resolveSearxngCategories(ctx.searchConfig);

      return {
        description:
          "Search the web using SearXNG, a self-hosted metasearch engine. Returns titles, URLs, and snippets.",
        parameters: SearxngSearchSchema,
        execute: async (args) => {
          const query = readStringParam(args, "query", { required: true });
          const count = Math.max(1, Math.min(10, readNumberParam(args, "count", { integer: true }) ?? 5));
          const categories = readStringParam(args, "categories") || defaultCategories;
          const url = new URL("/search", baseUrl);
          url.searchParams.set("q", query);
          url.searchParams.set("format", "json");
          url.searchParams.set("categories", categories);

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`SearXNG API error: ${response.status}`);
          }

          const payload = (await response.json()) as SearxngResponse;
          const results = Array.isArray(payload.results) ? (payload.results as SearxngResult[]) : [];
          return results.slice(0, count).map((entry) => ({
            title: typeof entry.title === "string" ? entry.title : "",
            url: typeof entry.url === "string" ? entry.url : "",
            description: typeof entry.content === "string" ? entry.content : "",
          }));
        },
      };
    },
  };
}

export default definePluginEntry({
  id: "searxng",
  name: "SearXNG Plugin",
  description: "Bundled SearXNG web search plugin",
  register(api) {
    api.registerWebSearchProvider(createSearxngWebSearchProvider());
  },
});
