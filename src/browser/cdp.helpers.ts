import http from "node:http";
import https from "node:https";
import WebSocket from "ws";
import { isLoopbackHost } from "../gateway/net.js";
import { rawDataToString } from "../infra/ws.js";
import { getChromeExtensionRelayAuthHeaders } from "./extension-relay.js";

export { isLoopbackHost };

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

/**
 * Low-level HTTP request that respects custom headers (including Host).
 * Node.js fetch() (undici) auto-overwrites the Host header from the URL,
 * so we fall back to http.request for non-loopback CDP URLs where Chrome
 * rejects Docker service hostnames like "browser:9222".
 */
async function cdpHttpRequest(
  url: string,
  timeoutMs: number,
  init?: { method?: string; body?: string },
): Promise<{ status: number; body: string }> {
  const parsed = new URL(url);
  const headers = getHeadersWithAuth(url);
  const isHttps = parsed.protocol === "https:";
  const requester = isHttps ? https.request : http.request;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);

    const req = requester(
      url,
      {
        method: init?.method ?? "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (init?.body) {
      req.write(init.body);
    }
    req.end();
  });
}

/** Whether a URL needs Host header override (non-loopback CDP target). */
function needsHostOverride(url: string): boolean {
  try {
    return !isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 1500, init?: RequestInit): Promise<T> {
  // For non-loopback URLs, use http.request which respects Host header overrides.
  // Node.js fetch() (undici) auto-overwrites the Host header from the URL,
  // so we fall back to http.request for non-loopback CDP URLs where Chrome
  // rejects Docker service hostnames like "browser:9222".
  if (needsHostOverride(url)) {
    const resp = await cdpHttpRequest(url, timeoutMs, {
      method: (init?.method as string) ?? "GET",
      body: init?.body as string | undefined,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return JSON.parse(resp.body) as T;
  }
  const res = await fetchChecked(url, timeoutMs, init);
  return (await res.json()) as T;
}

async function fetchChecked(url: string, timeoutMs = 1500, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(ctrl.abort.bind(ctrl), timeoutMs);
  try {
    const headers = getHeadersWithAuth(url, (init?.headers as Record<string, string>) || {});
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchOk(url: string, timeoutMs = 1500, init?: RequestInit): Promise<void> {
  // For non-loopback URLs, use http.request which respects Host header overrides.
  if (needsHostOverride(url)) {
    const resp = await cdpHttpRequest(url, timeoutMs, {
      method: (init?.method as string) ?? "GET",
      body: init?.body as string | undefined,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return;
  }
  await fetchChecked(url, timeoutMs, init);
}

export async function withCdpSocket<T>(
  wsUrl: string,
  fn: (send: CdpSendFn) => Promise<T>,
  opts?: { headers?: Record<string, string>; handshakeTimeoutMs?: number },
): Promise<T> {
  const headers = getHeadersWithAuth(wsUrl, opts?.headers ?? {});
  const handshakeTimeoutMs =
    typeof opts?.handshakeTimeoutMs === "number" && Number.isFinite(opts.handshakeTimeoutMs)
      ? Math.max(1, Math.floor(opts.handshakeTimeoutMs))
      : 5000;
  const ws = new WebSocket(wsUrl, {
    handshakeTimeout: handshakeTimeoutMs,
    ...(Object.keys(headers).length ? { headers } : {}),
  });
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
