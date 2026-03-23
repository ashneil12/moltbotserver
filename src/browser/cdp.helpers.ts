import http from "node:http";
import https from "node:https";
import WebSocket from "ws";
import { isLoopbackHost } from "../gateway/net.js";
import { rawDataToString } from "../infra/ws.js";
import { getDirectAgentForCdp, withNoProxyForCdpUrl } from "./cdp-proxy-bypass.js";
import { CDP_HTTP_REQUEST_TIMEOUT_MS, CDP_WS_HANDSHAKE_TIMEOUT_MS } from "./cdp-timeouts.js";
import { resolveBrowserRateLimitMessage } from "./client-fetch.js";
import { getChromeExtensionRelayAuthHeaders } from "./extension-relay.js";

export { isLoopbackHost };

/**
 * Returns true when the URL uses a WebSocket protocol (ws: or wss:).
 * Used to distinguish direct-WebSocket CDP endpoints
 * from HTTP(S) endpoints that require /json/version discovery.
 */
export function isWebSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

/**
 * Redact sensitive parts of a CDP URL (credentials, tokens) for safe logging.
 */
export function redactCdpUrl(cdpUrl: string | null | undefined): string | null | undefined {
  if (typeof cdpUrl !== "string") {
    return cdpUrl;
  }
  const trimmed = cdpUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

type CdpResponse = {
  id: number;
  result?: unknown;
  error?: { message?: string };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type CdpSendFn = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<unknown>;

export function getHeadersWithAuth(url: string, headers: Record<string, string> = {}) {
  const relayHeaders = getChromeExtensionRelayAuthHeaders(url);
  const mergedHeaders = { ...relayHeaders, ...headers };
  try {
    const parsed = new URL(url);

    // Chrome 107+ rejects CDP HTTP requests when the Host header isn't an IP
    // or "localhost".  In Docker networking the gateway connects via service
    // hostname (e.g. "browser"), which Chrome blocks.  Override Host to
    // "localhost" for non-loopback targets so Chrome accepts the request.
    // This is safe because socat/the proxy forwards TCP transparently.
    const hasHostHeader = Object.keys(mergedHeaders).some((key) => key.toLowerCase() === "host");
    if (!hasHostHeader && !isLoopbackHost(parsed.hostname)) {
      mergedHeaders["Host"] = "localhost";
    }

    const hasAuthHeader = Object.keys(mergedHeaders).some(
      (key) => key.toLowerCase() === "authorization",
    );
    if (hasAuthHeader) {
      return mergedHeaders;
    }
    if (parsed.username || parsed.password) {
      const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64");
      return { ...mergedHeaders, Authorization: `Basic ${auth}` };
    }
  } catch {
    // ignore
  }
  return mergedHeaders;
}

export function appendCdpPath(cdpUrl: string, path: string): string {
  const url = new URL(cdpUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  url.pathname = `${basePath}${suffix}`;
  return url.toString();
}

function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  const normalized = new Headers(headers ?? {});
  const record: Record<string, string> = {};
  normalized.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function hasExplicitHostHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "host");
}

function createAbortError(message = "The operation was aborted"): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function withAbortTimeout<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | null | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = () => {
    ctrl.abort(externalSignal?.reason ?? createAbortError());
  };

  if (externalSignal?.aborted) {
    ctrl.abort(externalSignal.reason ?? createAbortError());
  } else {
    externalSignal?.addEventListener("abort", onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    ctrl.abort(createAbortError(`CDP request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function readRequestBody(body: RequestInit["body"]): string | Buffer | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error("Unsupported CDP request body type");
}

function appendResponseHeader(headers: Headers, key: string, value: string | string[] | undefined) {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      headers.append(key, entry);
    }
    return;
  }
  headers.set(key, value);
}

async function httpRequestWithHostOverride(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const requestBody = readRequestBody(init?.body);

  return await withAbortTimeout(timeoutMs, init?.signal, async (signal) => {
    return await withNoProxyForCdpUrl(
      url,
      async () =>
        await new Promise<Response>((resolve, reject) => {
          const parsed = new URL(url);
          const request =
            parsed.protocol === "https:"
              ? https.request
              : parsed.protocol === "http:"
                ? http.request
                : null;
          if (!request) {
            reject(new Error(`Unsupported protocol for CDP request: ${parsed.protocol}`));
            return;
          }

          const req = request(
            parsed,
            {
              method: init?.method ?? "GET",
              headers,
              signal,
              agent: getDirectAgentForCdp(url),
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              res.on("end", () => {
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                  appendResponseHeader(responseHeaders, key, value);
                }
                const response = new Response(Buffer.concat(chunks), {
                  status: res.statusCode ?? 500,
                  statusText: res.statusMessage ?? "",
                  headers: responseHeaders,
                });
                if (!response.ok) {
                  reject(new Error(`HTTP ${response.status}`));
                  return;
                }
                resolve(response);
              });
            },
          );

          req.on("error", (err) => {
            reject(err instanceof Error ? err : new Error(String(err)));
          });

          if (requestBody !== undefined) {
            req.write(requestBody);
          }
          req.end();
        }),
    );
  });
}

export function normalizeCdpHttpBaseForJsonEndpoints(cdpUrl: string): string {
  try {
    const url = new URL(cdpUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = url.pathname.replace(/\/devtools\/browser\/.*$/, "");
    url.pathname = url.pathname.replace(/\/cdp$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    // Best-effort fallback for non-URL-ish inputs.
    return cdpUrl
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:")
      .replace(/\/devtools\/browser\/.*$/, "")
      .replace(/\/cdp$/, "")
      .replace(/\/$/, "");
  }
}

function createCdpSender(ws: WebSocket) {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const send: CdpSendFn = (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ) => {
    const id = nextId++;
    const msg = { id, method, params, sessionId };
    ws.send(JSON.stringify(msg));
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const closeWithError = (err: Error) => {
    for (const [, p] of pending) {
      p.reject(err);
    }
    pending.clear();
    try {
      ws.close();
    } catch {
      // ignore
    }
  };

  ws.on("error", (err) => {
    closeWithError(err instanceof Error ? err : new Error(String(err)));
  });

  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(rawDataToString(data)) as CdpResponse;
      if (typeof parsed.id !== "number") {
        return;
      }
      const p = pending.get(parsed.id);
      if (!p) {
        return;
      }
      pending.delete(parsed.id);
      if (parsed.error?.message) {
        p.reject(new Error(parsed.error.message));
        return;
      }
      p.resolve(parsed.result);
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    closeWithError(new Error("CDP socket closed"));
  });

  return { send, closeWithError };
}

export async function fetchJson<T>(
  url: string,
  timeoutMs = CDP_HTTP_REQUEST_TIMEOUT_MS,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchCdpChecked(url, timeoutMs, init);
  return (await res.json()) as T;
}

export async function fetchCdpChecked(
  url: string,
  timeoutMs = CDP_HTTP_REQUEST_TIMEOUT_MS,
  init?: RequestInit,
): Promise<Response> {
  const headers = getHeadersWithAuth(url, headersInitToRecord(init?.headers));
  if (hasExplicitHostHeader(headers)) {
    return await httpRequestWithHostOverride(url, headers, timeoutMs, init);
  }
  return await withAbortTimeout(timeoutMs, init?.signal, async (signal) => {
    const res = await withNoProxyForCdpUrl(url, () => fetch(url, { ...init, headers, signal }));
    if (!res.ok) {
      if (res.status === 429) {
        // Do not reflect upstream response text into the error surface (log/agent injection risk)
        throw new Error(`${resolveBrowserRateLimitMessage(url)} Do NOT retry the browser tool.`);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  });
}

export async function fetchOk(
  url: string,
  timeoutMs = CDP_HTTP_REQUEST_TIMEOUT_MS,
  init?: RequestInit,
): Promise<void> {
  await fetchCdpChecked(url, timeoutMs, init);
}

export function openCdpWebSocket(
  wsUrl: string,
  opts?: { headers?: Record<string, string>; handshakeTimeoutMs?: number },
): WebSocket {
  const headers = getHeadersWithAuth(wsUrl, opts?.headers ?? {});
  const handshakeTimeoutMs =
    typeof opts?.handshakeTimeoutMs === "number" && Number.isFinite(opts.handshakeTimeoutMs)
      ? Math.max(1, Math.floor(opts.handshakeTimeoutMs))
      : CDP_WS_HANDSHAKE_TIMEOUT_MS;
  const agent = getDirectAgentForCdp(wsUrl);
  return new WebSocket(wsUrl, {
    handshakeTimeout: handshakeTimeoutMs,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(agent ? { agent } : {}),
  });
}

export async function withCdpSocket<T>(
  wsUrl: string,
  fn: (send: CdpSendFn) => Promise<T>,
  opts?: { headers?: Record<string, string>; handshakeTimeoutMs?: number },
): Promise<T> {
  const ws = openCdpWebSocket(wsUrl, opts);
  const { send, closeWithError } = createCdpSender(ws);

  const openPromise = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
    ws.once("close", () => reject(new Error("CDP socket closed")));
  });

  try {
    await openPromise;
  } catch (err) {
    closeWithError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  try {
    return await fn(send);
  } catch (err) {
    closeWithError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}
