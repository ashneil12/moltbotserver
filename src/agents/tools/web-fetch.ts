import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeResolvedSecretInputString } from "../../config/types.secrets.js";
import { SsrFBlockedError } from "../../infra/net/ssrf.js";
import { logDebug } from "../../logger.js";
import type { RuntimeWebFetchFirecrawlMetadata } from "../../secrets/runtime-web-tools.js";
import { wrapExternalContent, wrapWebContent } from "../../security/external-content.js";
import { scanAndLog } from "../../security/scan-and-log.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  extractReadableContent,
  htmlToMarkdown,
  markdownToText,
  truncateText,
  type ExtractMode,
} from "./web-fetch-utils.js";
import { fetchWithWebToolsNetworkGuard } from "./web-guarded-fetch.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

export { extractReadableContent } from "./web-fetch-utils.js";

const EXTRACT_MODES = ["markdown", "text"] as const;

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_RESPONSE_BYTES_MIN = 32_000;
const FETCH_MAX_RESPONSE_BYTES_MAX = 10_000_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_ERROR_MAX_CHARS = 4_000;
const DEFAULT_ERROR_MAX_BYTES = 64_000;
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172_800_000;
const DEFAULT_SCRAPLING_TIMEOUT_SECONDS = 30;
const DEFAULT_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const WebFetchSchema = Type.Object({
  url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
  extractMode: Type.Optional(
    stringEnum(EXTRACT_MODES, {
      description: 'Extraction mode ("markdown" or "text").',
      default: "markdown",
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: "Maximum characters to return (truncates when exceeded).",
      minimum: 100,
    }),
  ),
});

type WebFetchConfig = NonNullable<OpenClawConfig["tools"]>["web"] extends infer Web
  ? Web extends { fetch?: infer Fetch }
    ? Fetch
    : undefined
  : undefined;

type FirecrawlFetchConfig =
  | {
      enabled?: boolean;
      apiKey?: unknown;
      baseUrl?: string;
      onlyMainContent?: boolean;
      maxAgeMs?: number;
      timeoutSeconds?: number;
    }
  | undefined;

function resolveFetchConfig(cfg?: OpenClawConfig): WebFetchConfig {
  const fetch = cfg?.tools?.web?.fetch;
  if (!fetch || typeof fetch !== "object") {
    return undefined;
  }
  return fetch as WebFetchConfig;
}

function resolveFetchEnabled(params: { fetch?: WebFetchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.fetch?.enabled === "boolean") {
    return params.fetch.enabled;
  }
  return true;
}

function resolveFetchReadabilityEnabled(fetch?: WebFetchConfig): boolean {
  if (typeof fetch?.readability === "boolean") {
    return fetch.readability;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scrapling config resolvers
// ---------------------------------------------------------------------------

type ScraplingFetchConfig =
  | {
      enabled?: boolean;
      baseUrl?: string;
      timeoutSeconds?: number;
      stealth?: boolean;
    }
  | undefined;

function resolveScraplingConfig(fetch?: WebFetchConfig): ScraplingFetchConfig {
  if (!fetch || typeof fetch !== "object") {
    return undefined;
  }
  const scrapling = "scrapling" in fetch ? fetch.scrapling : undefined;
  if (!scrapling || typeof scrapling !== "object") {
    return undefined;
  }
  return scrapling as ScraplingFetchConfig;
}

function resolveScraplingEnabled(params: {
  scrapling?: ScraplingFetchConfig;
  baseUrl?: string;
}): boolean {
  if (typeof params.scrapling?.enabled === "boolean") {
    return params.scrapling.enabled;
  }
  // Auto-enable when base URL is available
  return !!params.baseUrl;
}

function resolveScraplingBaseUrl(scrapling?: ScraplingFetchConfig): string | undefined {
  const fromConfig = scrapling?.baseUrl?.trim();
  const fromEnv = process.env.SCRAPLING_BASE_URL?.trim();
  return fromConfig || fromEnv || undefined;
}

function resolveScraplingTimeoutSeconds(scrapling?: ScraplingFetchConfig): number {
  return resolveTimeoutSeconds(scrapling?.timeoutSeconds, DEFAULT_SCRAPLING_TIMEOUT_SECONDS);
}

function resolveScraplingStealthDefault(scrapling?: ScraplingFetchConfig): boolean {
  if (typeof scrapling?.stealth === "boolean") {
    return scrapling.stealth;
  }
  return true; // default to stealth mode
}

function resolveFetchMaxCharsCap(fetch?: WebFetchConfig): number {
  const raw =
    fetch && "maxCharsCap" in fetch && typeof fetch.maxCharsCap === "number"
      ? fetch.maxCharsCap
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_FETCH_MAX_CHARS;
  }
  return Math.max(100, Math.floor(raw));
}

function resolveFetchMaxResponseBytes(fetch?: WebFetchConfig): number {
  const raw =
    fetch && "maxResponseBytes" in fetch && typeof fetch.maxResponseBytes === "number"
      ? fetch.maxResponseBytes
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_FETCH_MAX_RESPONSE_BYTES;
  }
  const value = Math.floor(raw);
  return Math.min(FETCH_MAX_RESPONSE_BYTES_MAX, Math.max(FETCH_MAX_RESPONSE_BYTES_MIN, value));
}

function resolveFirecrawlConfig(fetch?: WebFetchConfig): FirecrawlFetchConfig {
  if (!fetch || typeof fetch !== "object") {
    return undefined;
  }
  const firecrawl = "firecrawl" in fetch ? fetch.firecrawl : undefined;
  if (!firecrawl || typeof firecrawl !== "object") {
    return undefined;
  }
  return firecrawl as FirecrawlFetchConfig;
}

function resolveFirecrawlApiKey(firecrawl?: FirecrawlFetchConfig): string | undefined {
  const fromConfigRaw =
    firecrawl && "apiKey" in firecrawl
      ? normalizeResolvedSecretInputString({
          value: firecrawl.apiKey,
          path: "tools.web.fetch.firecrawl.apiKey",
        })
      : undefined;
  const fromConfig = normalizeSecretInput(fromConfigRaw);
  const fromEnv = normalizeSecretInput(process.env.FIRECRAWL_API_KEY);
  return fromConfig || fromEnv || undefined;
}

function resolveFirecrawlEnabled(params: {
  firecrawl?: FirecrawlFetchConfig;
  apiKey?: string;
}): boolean {
  if (typeof params.firecrawl?.enabled === "boolean") {
    return params.firecrawl.enabled;
  }
  return Boolean(params.apiKey);
}

function resolveFirecrawlBaseUrl(firecrawl?: FirecrawlFetchConfig): string {
  const raw =
    firecrawl && "baseUrl" in firecrawl && typeof firecrawl.baseUrl === "string"
      ? firecrawl.baseUrl.trim()
      : "";
  return raw || DEFAULT_FIRECRAWL_BASE_URL;
}

function resolveFirecrawlOnlyMainContent(firecrawl?: FirecrawlFetchConfig): boolean {
  if (typeof firecrawl?.onlyMainContent === "boolean") {
    return firecrawl.onlyMainContent;
  }
  return true;
}

function resolveFirecrawlMaxAgeMs(firecrawl?: FirecrawlFetchConfig): number | undefined {
  const raw =
    firecrawl && "maxAgeMs" in firecrawl && typeof firecrawl.maxAgeMs === "number"
      ? firecrawl.maxAgeMs
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  const parsed = Math.max(0, Math.floor(raw));
  return parsed > 0 ? parsed : undefined;
}

function resolveFirecrawlMaxAgeMsOrDefault(firecrawl?: FirecrawlFetchConfig): number {
  const resolved = resolveFirecrawlMaxAgeMs(firecrawl);
  if (typeof resolved === "number") {
    return resolved;
  }
  return DEFAULT_FIRECRAWL_MAX_AGE_MS;
}

function resolveMaxChars(value: unknown, fallback: number, cap: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(100, Math.floor(parsed));
  return Math.min(clamped, cap);
}

function resolveMaxRedirects(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.floor(parsed));
}

// ---------------------------------------------------------------------------
// Scrapling fetch
// ---------------------------------------------------------------------------

type ScraplingFetchResponse = {
  url: string;
  finalUrl?: string;
  status: number;
  title?: string;
  text: string;
  extractor: string;
  tookMs?: number;
  stealth?: boolean;
};

export async function fetchScraplingContent(params: {
  url: string;
  baseUrl: string;
  timeoutSeconds: number;
  stealth: boolean;
  extractMode: ExtractMode;
}): Promise<{ text: string; title?: string; finalUrl?: string; status?: number }> {
  // baseUrl is a trusted internal Docker hostname (e.g. http://scrapling:8765),
  // not user-supplied — no SSRF concern here.
  const endpoint = `${params.baseUrl.replace(/\/+$/, "")}/fetch`;

  // The Scrapling server adds its own padding on top of the requested timeout
  // (5s for basic, 10s for stealth). The client-side AbortSignal must exceed
  // the server's total timeout to avoid premature client-side aborts.
  const clientTimeoutMs = (params.timeoutSeconds + 15) * 1000;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: params.url,
      mode: params.extractMode,
      stealth: params.stealth,
      timeout: params.timeoutSeconds,
    }),
    signal: withTimeout(undefined, clientTimeoutMs),
  });

  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64_000 });
    throw new Error(
      `Scrapling fetch error (${res.status}): ${detailResult.text || res.statusText}`,
    );
  }

  const data = (await res.json()) as ScraplingFetchResponse;
  return {
    text: data.text ?? "",
    title: data.title,
    finalUrl: data.finalUrl,
    status: data.status,
  };
}

function looksLikeHtml(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed) {
    return false;
  }
  const head = trimmed.slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function formatWebFetchErrorDetail(params: {
  detail: string;
  contentType?: string | null;
  maxChars: number;
}): string {
  const { detail, contentType, maxChars } = params;
  if (!detail) {
    return "";
  }
  let text = detail;
  const contentTypeLower = contentType?.toLowerCase();
  if (contentTypeLower?.includes("text/html") || looksLikeHtml(detail)) {
    const rendered = htmlToMarkdown(detail);
    const withTitle = rendered.title ? `${rendered.title}\n${rendered.text}` : rendered.text;
    text = markdownToText(withTitle);
  }
  const truncated = truncateText(text.trim(), maxChars);
  return truncated.text;
}

function redactUrlForDebugLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname && parsed.pathname !== "/" ? `${parsed.origin}/...` : parsed.origin;
  } catch {
    return "[invalid-url]";
  }
}

const WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD = wrapWebContent("", "web_fetch").length;
const WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD = wrapExternalContent("", {
  source: "web_fetch",
  includeWarning: false,
}).length;

function wrapWebFetchContent(
  value: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
  rawLength: number;
  wrappedLength: number;
} {
  if (maxChars <= 0) {
    return { text: "", truncated: true, rawLength: 0, wrappedLength: 0 };
  }

  // Security: scan fetched web content before wrapping
  scanAndLog(value, { source: "web_fetch" });

  const includeWarning = maxChars >= WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD;
  const wrapperOverhead = includeWarning
    ? WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD
    : WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD;
  if (wrapperOverhead > maxChars) {
    const minimal = includeWarning
      ? wrapWebContent("", "web_fetch")
      : wrapExternalContent("", { source: "web_fetch", includeWarning: false });
    const truncatedWrapper = truncateText(minimal, maxChars);
    return {
      text: truncatedWrapper.text,
      truncated: true,
      rawLength: 0,
      wrappedLength: truncatedWrapper.text.length,
    };
  }
  const maxInner = Math.max(0, maxChars - wrapperOverhead);
  let truncated = truncateText(value, maxInner);
  let wrappedText = includeWarning
    ? wrapWebContent(truncated.text, "web_fetch")
    : wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });

  if (wrappedText.length > maxChars) {
    const excess = wrappedText.length - maxChars;
    const adjustedMaxInner = Math.max(0, maxInner - excess);
    truncated = truncateText(value, adjustedMaxInner);
    wrappedText = includeWarning
      ? wrapWebContent(truncated.text, "web_fetch")
      : wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });
  }

  return {
    text: wrappedText,
    truncated: truncated.truncated,
    rawLength: truncated.text.length,
    wrappedLength: wrappedText.length,
  };
}

function wrapWebFetchField(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return wrapExternalContent(value, { source: "web_fetch", includeWarning: false });
}

function buildFirecrawlWebFetchPayload(params: {
  firecrawl: Awaited<ReturnType<typeof fetchFirecrawlContent>>;
  rawUrl: string;
  finalUrlFallback: string;
  statusFallback: number;
  extractMode: ExtractMode;
  maxChars: number;
  tookMs: number;
}): Record<string, unknown> {
  const wrapped = wrapWebFetchContent(params.firecrawl.text, params.maxChars);
  const wrappedTitle = params.firecrawl.title
    ? wrapWebFetchField(params.firecrawl.title)
    : undefined;
  return {
    url: params.rawUrl, // Keep raw for tool chaining
    finalUrl: params.firecrawl.finalUrl || params.finalUrlFallback, // Keep raw
    status: params.firecrawl.status ?? params.statusFallback,
    contentType: "text/markdown", // Protocol metadata, don't wrap
    title: wrappedTitle,
    extractMode: params.extractMode,
    extractor: "firecrawl",
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      wrapped: true,
    },
    truncated: wrapped.truncated,
    length: wrapped.wrappedLength,
    rawLength: wrapped.rawLength, // Actual content length, not wrapped
    wrappedLength: wrapped.wrappedLength,
    fetchedAt: new Date().toISOString(),
    tookMs: params.tookMs,
    text: wrapped.text,
    warning: wrapWebFetchField(params.firecrawl.warning),
  };
}

function normalizeContentType(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const [raw] = value.split(";");
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export async function fetchFirecrawlContent(params: {
  url: string;
  extractMode: ExtractMode;
  apiKey: string;
  baseUrl: string;
  onlyMainContent: boolean;
  maxAgeMs: number;
  proxy: "auto" | "basic" | "stealth";
  storeInCache: boolean;
  timeoutSeconds: number;
}): Promise<{
  text: string;
  title?: string;
  finalUrl?: string;
  status?: number;
  warning?: string;
}> {
  const endpoint = resolveFirecrawlEndpoint(params.baseUrl);
  const body: Record<string, unknown> = {
    url: params.url,
    formats: ["markdown"],
    onlyMainContent: params.onlyMainContent,
    timeout: params.timeoutSeconds * 1000,
    maxAge: params.maxAgeMs,
    proxy: params.proxy,
    storeInCache: params.storeInCache,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  const payload = (await res.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      content?: string;
      metadata?: {
        title?: string;
        sourceURL?: string;
        statusCode?: number;
      };
    };
    warning?: string;
    error?: string;
  };

  if (!res.ok || payload?.success === false) {
    const detail = payload?.error ?? "";
    throw new Error(
      `Firecrawl fetch failed (${res.status}): ${wrapWebContent(detail || res.statusText, "web_fetch")}`.trim(),
    );
  }

  const data = payload?.data ?? {};
  const rawText =
    typeof data.markdown === "string"
      ? data.markdown
      : typeof data.content === "string"
        ? data.content
        : "";
  const text = params.extractMode === "text" ? markdownToText(rawText) : rawText;
  return {
    text,
    title: data.metadata?.title,
    finalUrl: data.metadata?.sourceURL,
    status: data.metadata?.statusCode,
    warning: payload?.warning,
  };
}

type FirecrawlRuntimeParams = {
  firecrawlEnabled: boolean;
  firecrawlApiKey?: string;
  firecrawlBaseUrl: string;
  firecrawlOnlyMainContent: boolean;
  firecrawlMaxAgeMs: number;
  firecrawlProxy: "auto" | "basic" | "stealth";
  firecrawlStoreInCache: boolean;
  firecrawlTimeoutSeconds: number;
};

type WebFetchRuntimeParams = FirecrawlRuntimeParams & {
  url: string;
  extractMode: ExtractMode;
  maxChars: number;
  maxResponseBytes: number;
  maxRedirects: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  userAgent: string;
  readabilityEnabled: boolean;
  scraplingEnabled: boolean;
  scraplingBaseUrl?: string;
  scraplingTimeoutSeconds: number;
  scraplingStealthDefault: boolean;
};

function toFirecrawlContentParams(
  params: FirecrawlRuntimeParams & { url: string; extractMode: ExtractMode },
): Parameters<typeof fetchFirecrawlContent>[0] | null {
  if (!params.firecrawlEnabled || !params.firecrawlApiKey) {
    return null;
  }
  return {
    url: params.url,
    extractMode: params.extractMode,
    apiKey: params.firecrawlApiKey,
    baseUrl: params.firecrawlBaseUrl,
    onlyMainContent: params.firecrawlOnlyMainContent,
    maxAgeMs: params.firecrawlMaxAgeMs,
    proxy: params.firecrawlProxy,
    storeInCache: params.firecrawlStoreInCache,
    timeoutSeconds: params.firecrawlTimeoutSeconds,
  };
}

async function maybeFetchFirecrawlWebFetchPayload(
  params: WebFetchRuntimeParams & {
    urlToFetch: string;
    finalUrlFallback: string;
    statusFallback: number;
    cacheKey: string;
    tookMs: number;
  },
): Promise<Record<string, unknown> | null> {
  const firecrawlParams = toFirecrawlContentParams({
    ...params,
    url: params.urlToFetch,
    extractMode: params.extractMode,
  });
  if (!firecrawlParams) {
    return null;
  }

  const firecrawl = await fetchFirecrawlContent(firecrawlParams);
  const payload = buildFirecrawlWebFetchPayload({
    firecrawl,
    rawUrl: params.url,
    finalUrlFallback: params.finalUrlFallback,
    statusFallback: params.statusFallback,
    extractMode: params.extractMode,
    maxChars: params.maxChars,
    tookMs: params.tookMs,
  });
  writeCache(FETCH_CACHE, params.cacheKey, payload, params.cacheTtlMs);
  return payload;
}

async function runWebFetch(params: WebFetchRuntimeParams): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `fetch:${params.url}:${params.extractMode}:${params.maxChars}`,
  );
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    throw new Error("Invalid URL: must be http or https");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL: must be http or https");
  }

  const start = Date.now();
  let res: Response;
  let release: (() => Promise<void>) | null = null;
  let finalUrl = params.url;
  try {
    const result = await fetchWithWebToolsNetworkGuard({
      url: params.url,
      maxRedirects: params.maxRedirects,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        headers: {
          Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
          "User-Agent": params.userAgent,
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    });
    res = result.response;
    finalUrl = result.finalUrl;
    release = result.release;

    // Cloudflare Markdown for Agents — log token budget hint when present
    const markdownTokens = res.headers.get("x-markdown-tokens");
    if (markdownTokens) {
      logDebug(
        `[web-fetch] x-markdown-tokens: ${markdownTokens} (${redactUrlForDebugLog(finalUrl)})`,
      );
    }
  } catch (error) {
    if (error instanceof SsrFBlockedError) {
      throw error;
    }
    const payload = await maybeScraplingOrFirecrawlFallback({
      ...params,
      urlToFetch: finalUrl,
      finalUrlFallback: finalUrl,
      statusFallback: 200,
      cacheKey,
      tookMs: Date.now() - start,
    });
    if (payload) {
      return payload;
    }
    throw error;
  }

  try {
    if (!res.ok) {
      const payload = await maybeScraplingOrFirecrawlFallback({
        ...params,
        urlToFetch: params.url,
        finalUrlFallback: finalUrl,
        statusFallback: res.status,
        cacheKey,
        tookMs: Date.now() - start,
      });
      if (payload) {
        return payload;
      }
      const rawDetailResult = await readResponseText(res, { maxBytes: DEFAULT_ERROR_MAX_BYTES });
      const rawDetail = rawDetailResult.text;
      const detail = formatWebFetchErrorDetail({
        detail: rawDetail,
        contentType: res.headers.get("content-type"),
        maxChars: DEFAULT_ERROR_MAX_CHARS,
      });
      const wrappedDetail = wrapWebFetchContent(detail || res.statusText, DEFAULT_ERROR_MAX_CHARS);
      throw new Error(`Web fetch failed (${res.status}): ${wrappedDetail.text}`);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const normalizedContentType = normalizeContentType(contentType) ?? "application/octet-stream";
    const bodyResult = await readResponseText(res, { maxBytes: params.maxResponseBytes });
    const body = bodyResult.text;
    const responseTruncatedWarning = bodyResult.truncated
      ? `Response body truncated after ${params.maxResponseBytes} bytes.`
      : undefined;

    let title: string | undefined;
    let extractor = "raw";
    let text = body;
    if (contentType.includes("text/markdown")) {
      // Cloudflare Markdown for Agents: server returned pre-rendered markdown
      extractor = "cf-markdown";
      if (params.extractMode === "text") {
        text = markdownToText(body);
      }
    } else if (contentType.includes("text/html")) {
      if (params.readabilityEnabled) {
        const readable = await extractReadableContent({
          html: body,
          url: finalUrl,
          extractMode: params.extractMode,
        });
        if (readable?.text) {
          text = readable.text;
          title = readable.title;
          extractor = "readability";
        } else {
          const scraplingOrFirecrawl = await tryScraplingOrFirecrawlFallback({
            ...params,
            url: finalUrl,
          });
          if (scraplingOrFirecrawl) {
            text = scraplingOrFirecrawl.text;
            title = scraplingOrFirecrawl.title;
            extractor = scraplingOrFirecrawl.extractor;
          } else {
            throw new Error(
              "Web fetch extraction failed: Readability, Scrapling, and Firecrawl returned no content.",
            );
          }
        }
      } else {
        throw new Error(
          "Web fetch extraction failed: Readability disabled and Firecrawl unavailable.",
        );
      }
    } else if (contentType.includes("application/json")) {
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
        extractor = "json";
      } catch {
        text = body;
        extractor = "raw";
      }
    }

    const wrapped = wrapWebFetchContent(text, params.maxChars);
    const wrappedTitle = title ? wrapWebFetchField(title) : undefined;
    const wrappedWarning = wrapWebFetchField(responseTruncatedWarning);
    const payload = {
      url: params.url, // Keep raw for tool chaining
      finalUrl, // Keep raw
      status: res.status,
      contentType: normalizedContentType, // Protocol metadata, don't wrap
      title: wrappedTitle,
      extractMode: params.extractMode,
      extractor,
      externalContent: {
        untrusted: true,
        source: "web_fetch",
        wrapped: true,
      },
      truncated: wrapped.truncated,
      length: wrapped.wrappedLength,
      rawLength: wrapped.rawLength, // Actual content length, not wrapped
      wrappedLength: wrapped.wrappedLength,
      fetchedAt: new Date().toISOString(),
      tookMs: Date.now() - start,
      text: wrapped.text,
      warning: wrappedWarning,
    };
    writeCache(FETCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  } finally {
    if (release) {
      await release();
    }
  }
}

async function tryFirecrawlFallback(
  params: FirecrawlRuntimeParams & { url: string; extractMode: ExtractMode },
): Promise<{ text: string; title?: string } | null> {
  const firecrawlParams = toFirecrawlContentParams(params);
  if (!firecrawlParams) {
    return null;
  }
  try {
    const firecrawl = await fetchFirecrawlContent(firecrawlParams);
    return { text: firecrawl.text, title: firecrawl.title };
  } catch {
    return null;
  }
}

/**
 * Try Scrapling stealth scraping fallback, then Firecrawl.
 * Returns result with extractor name, or null if both fail.
 */
async function tryScraplingOrFirecrawlFallback(
  params: WebFetchRuntimeParams & { url: string },
): Promise<{ text: string; title?: string; extractor: string } | null> {
  // Try Scrapling first
  if (params.scraplingEnabled && params.scraplingBaseUrl) {
    try {
      const result = await fetchScraplingContent({
        url: params.url,
        baseUrl: params.scraplingBaseUrl,
        timeoutSeconds: params.scraplingTimeoutSeconds,
        stealth: params.scraplingStealthDefault,
        extractMode: params.extractMode,
      });
      if (result.text) {
        return { text: result.text, title: result.title, extractor: "scrapling" };
      }
    } catch (e) {
      logDebug(
        `[web-fetch] Scrapling fallback failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // Then try Firecrawl
  const firecrawl = await tryFirecrawlFallback(params);
  if (firecrawl) {
    return { text: firecrawl.text, title: firecrawl.title, extractor: "firecrawl" };
  }
  return null;
}

/**
 * Build a full web_fetch payload from a Scrapling or Firecrawl fallback on
 * network-error / non-2xx paths.
 */
async function maybeScraplingOrFirecrawlFallback(
  params: WebFetchRuntimeParams & {
    urlToFetch: string;
    finalUrlFallback: string;
    statusFallback: number;
    cacheKey: string;
    tookMs: number;
  },
): Promise<Record<string, unknown> | null> {
  // Try Scrapling first
  if (params.scraplingEnabled && params.scraplingBaseUrl) {
    try {
      const result = await fetchScraplingContent({
        url: params.urlToFetch,
        baseUrl: params.scraplingBaseUrl,
        timeoutSeconds: params.scraplingTimeoutSeconds,
        stealth: params.scraplingStealthDefault,
        extractMode: params.extractMode,
      });
      if (result.text) {
        const wrapped = wrapWebFetchContent(result.text, params.maxChars);
        const wrappedTitle = result.title ? wrapWebFetchField(result.title) : undefined;
        const payload = {
          url: params.url,
          finalUrl: result.finalUrl || params.finalUrlFallback,
          status: result.status ?? params.statusFallback,
          title: wrappedTitle,
          extractMode: params.extractMode,
          extractor: "scrapling",
          externalContent: {
            untrusted: true,
            source: "web_fetch",
            wrapped: true,
          },
          truncated: wrapped.truncated,
          length: wrapped.wrappedLength,
          rawLength: wrapped.rawLength,
          wrappedLength: wrapped.wrappedLength,
          fetchedAt: new Date().toISOString(),
          tookMs: params.tookMs,
          text: wrapped.text,
        };
        writeCache(FETCH_CACHE, params.cacheKey, payload, params.cacheTtlMs);
        return payload;
      }
    } catch (e) {
      logDebug(
        `[web-fetch] Scrapling fallback failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // Then try Firecrawl
  return maybeFetchFirecrawlWebFetchPayload(params);
}

function resolveFirecrawlEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  }
  try {
    const url = new URL(trimmed);
    if (url.pathname && url.pathname !== "/") {
      return url.toString();
    }
    url.pathname = "/v2/scrape";
    return url.toString();
  } catch {
    return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  }
}

export function createWebFetchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
  runtimeFirecrawl?: RuntimeWebFetchFirecrawlMetadata;
}): AnyAgentTool | null {
  const fetch = resolveFetchConfig(options?.config);
  if (!resolveFetchEnabled({ fetch, sandboxed: options?.sandboxed })) {
    return null;
  }
  const readabilityEnabled = resolveFetchReadabilityEnabled(fetch);
  const firecrawl = resolveFirecrawlConfig(fetch);
  const runtimeFirecrawlActive = options?.runtimeFirecrawl?.active;
  const shouldResolveFirecrawlApiKey =
    runtimeFirecrawlActive === undefined ? firecrawl?.enabled !== false : runtimeFirecrawlActive;
  const firecrawlApiKey = shouldResolveFirecrawlApiKey
    ? resolveFirecrawlApiKey(firecrawl)
    : undefined;
  const firecrawlEnabled =
    runtimeFirecrawlActive ?? resolveFirecrawlEnabled({ firecrawl, apiKey: firecrawlApiKey });
  const firecrawlBaseUrl = resolveFirecrawlBaseUrl(firecrawl);
  const firecrawlOnlyMainContent = resolveFirecrawlOnlyMainContent(firecrawl);
  const firecrawlMaxAgeMs = resolveFirecrawlMaxAgeMsOrDefault(firecrawl);
  const firecrawlTimeoutSeconds = resolveTimeoutSeconds(
    firecrawl?.timeoutSeconds ?? fetch?.timeoutSeconds,
    DEFAULT_TIMEOUT_SECONDS,
  );

  // Scrapling stealth scraping backend
  const scraplingConfig = resolveScraplingConfig(fetch);
  const scraplingBaseUrl = resolveScraplingBaseUrl(scraplingConfig);
  const scraplingEnabled = resolveScraplingEnabled({
    scrapling: scraplingConfig,
    baseUrl: scraplingBaseUrl,
  });
  const scraplingTimeoutSeconds = resolveScraplingTimeoutSeconds(scraplingConfig);
  const scraplingStealthDefault = resolveScraplingStealthDefault(scraplingConfig);

  const userAgent =
    (fetch && "userAgent" in fetch && typeof fetch.userAgent === "string" && fetch.userAgent) ||
    DEFAULT_FETCH_USER_AGENT;
  const maxResponseBytes = resolveFetchMaxResponseBytes(fetch);
  return {
    label: "Web Fetch",
    name: "web_fetch",
    description:
      "Fetch and extract readable content from a URL (HTML → markdown/text). Use for lightweight page access without browser automation.",
    parameters: WebFetchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true });
      const extractMode = readStringParam(params, "extractMode") === "text" ? "text" : "markdown";
      const maxChars = readNumberParam(params, "maxChars", { integer: true });
      const maxCharsCap = resolveFetchMaxCharsCap(fetch);
      const result = await runWebFetch({
        url,
        extractMode,
        maxChars: resolveMaxChars(
          maxChars ?? fetch?.maxChars,
          DEFAULT_FETCH_MAX_CHARS,
          maxCharsCap,
        ),
        maxResponseBytes,
        maxRedirects: resolveMaxRedirects(fetch?.maxRedirects, DEFAULT_FETCH_MAX_REDIRECTS),
        timeoutSeconds: resolveTimeoutSeconds(fetch?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(fetch?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        userAgent,
        readabilityEnabled,
        firecrawlEnabled,
        firecrawlApiKey,
        firecrawlBaseUrl,
        firecrawlOnlyMainContent,
        firecrawlMaxAgeMs,
        firecrawlProxy: "auto",
        firecrawlStoreInCache: true,
        firecrawlTimeoutSeconds,
        scraplingEnabled,
        scraplingBaseUrl,
        scraplingTimeoutSeconds,
        scraplingStealthDefault,
      });
      return jsonResult(result);
    },
  };
}
