import type { Duplex } from "node:stream";
/**
 * Gateway handler for sandbox browser management:
 *   - GET  /api/sandbox-browsers   → list active sandbox browser containers
 *   - ANY  /sbx-browser/:id/*      → reverse-proxy HTTP/WS to the container's noVNC
 *
 * Auth: requires a valid gateway token (Bearer or ?token= query param).
 */
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { readBrowserRegistry } from "../agents/sandbox/registry.js";
import { loadConfig } from "../config/config.js";
import {
  authorizeGatewayConnect,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

// ── Constants ──────────────────────────────────────────────────────────

const API_PATH = "/api/sandbox-browsers";
const PROXY_PREFIX = "/sbx-browser/";
/** Default noVNC port inside sandbox browser containers. */
const NOVNC_INTERNAL_PORT = 6080;

// ── Types ──────────────────────────────────────────────────────────────

export interface SandboxBrowserEntry {
  /** Unique identifier (e.g. agent scope key or "main") */
  id: string;
  /** Human-readable label */
  label: string;
  /** "host" for the shared browser, "sandbox" for per-agent */
  type: "host" | "sandbox";
  /** URL path prefix for noVNC access */
  path: string;
  /** Docker container name (sandbox only) */
  containerName?: string;
}

// ── Auth helper ────────────────────────────────────────────────────────

async function authorizeRequest(
  req: IncomingMessage,
  auth: ResolvedGatewayAuth,
  rateLimiter?: AuthRateLimiter,
): Promise<GatewayAuthResult> {
  // Accept token from Authorization header or ?token= query param
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token");
  const bearerToken = getBearerToken(req);
  const token = bearerToken || queryToken || undefined;

  if (!token) {
    return { ok: false, reason: "unauthorized" };
  }

  const configSnapshot = loadConfig();
  const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
  return authorizeGatewayConnect({
    auth,
    connectAuth: { token, password: token },
    req,
    trustedProxies,
    rateLimiter,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

function deriveLabel(sessionKey: string): string {
  // Session keys are often like "agent:dan" or just "dan"
  const name = sessionKey.includes(":") ? sessionKey.split(":").pop()! : sessionKey;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Parse "/sbx-browser/{id}/some/path" into { id, subPath }.
 * Returns null if the URL doesn't match the prefix.
 */
function parseSbxBrowserPath(pathname: string): { id: string; subPath: string } | null {
  if (!pathname.startsWith(PROXY_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(PROXY_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) {
    return { id: rest, subPath: "/" };
  }
  return {
    id: rest.slice(0, slashIdx),
    subPath: rest.slice(slashIdx) || "/",
  };
}

// ── API: list browsers ─────────────────────────────────────────────────

async function handleListBrowsers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const registry = await readBrowserRegistry();

  const browsers: SandboxBrowserEntry[] = [
    // Main/host browser is always first
    {
      id: "main",
      label: "Main",
      type: "host",
      path: "/browser",
    },
  ];

  for (const entry of registry.entries) {
    // Derive a short id from the container name (e.g. "openclaw-sbx-browser-dan" → "dan")
    const parts = entry.containerName.split("-");
    const shortId = parts.length > 3 ? parts.slice(3).join("-") : entry.sessionKey;

    browsers.push({
      id: shortId,
      label: deriveLabel(entry.sessionKey),
      type: "sandbox",
      path: `${PROXY_PREFIX}${shortId}`,
      containerName: entry.containerName,
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ browsers }));
}

// ── Proxy: forward HTTP to container noVNC ─────────────────────────────

function proxyHttpToContainer(
  containerName: string,
  subPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const proxyReq = httpRequest(
    {
      hostname: containerName,
      port: NOVNC_INTERNAL_PORT,
      path: subPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${containerName}:${NOVNC_INTERNAL_PORT}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: `Browser proxy error: ${err.message}` }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

// ── Proxy: forward WebSocket upgrade to container ──────────────────────

function proxyWsToContainer(
  containerName: string,
  subPath: string,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const proxyReq = httpRequest({
    hostname: containerName,
    port: NOVNC_INTERNAL_PORT,
    path: subPath,
    method: "GET",
    headers: {
      ...req.headers,
      host: `${containerName}:${NOVNC_INTERNAL_PORT}`,
    },
  });

  proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
    // Write upgrade response back to original client
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "\r\n",
    );

    if (proxyHead.length > 0) {
      socket.write(proxyHead);
    }
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // Bidirectional pipe
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
    proxySocket.on("end", () => socket.end());
    socket.on("end", () => proxySocket.end());
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });

  proxyReq.end();
}

// ── Exported handler ───────────────────────────────────────────────────

/**
 * Handles HTTP requests for sandbox browser API and proxy.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleSandboxBrowserRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // API: list sandbox browsers
  if (pathname === API_PATH && req.method === "GET") {
    const authResult = await authorizeRequest(req, opts.auth, opts.rateLimiter);
    if (!authResult.ok) {
      sendGatewayAuthFailure(res, authResult);
      return true;
    }
    await handleListBrowsers(req, res);
    return true;
  }

  // Proxy: forward to sandbox browser container
  const parsed = parseSbxBrowserPath(pathname);
  if (!parsed) {
    return false;
  }

  const authResult = await authorizeRequest(req, opts.auth, opts.rateLimiter);
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return true;
  }

  // Resolve container name from the id
  const registry = await readBrowserRegistry();
  const entry = registry.entries.find((e) => {
    const parts = e.containerName.split("-");
    const shortId = parts.length > 3 ? parts.slice(3).join("-") : e.sessionKey;
    return shortId === parsed.id;
  });

  if (!entry) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: `No sandbox browser found for: ${parsed.id}` }));
    return true;
  }

  proxyHttpToContainer(entry.containerName, parsed.subPath, req, res);
  return true;
}

/**
 * Handles WebSocket upgrade for sandbox browser proxy.
 * Returns true if the upgrade was handled, false otherwise.
 */
export async function handleSandboxBrowserUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: {
    auth: ResolvedGatewayAuth;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parsed = parseSbxBrowserPath(url.pathname);
  if (!parsed) {
    return false;
  }

  const authResult = await authorizeRequest(req, opts.auth, opts.rateLimiter);
  if (!authResult.ok) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  const registry = await readBrowserRegistry();
  const entry = registry.entries.find((e) => {
    const parts = e.containerName.split("-");
    const shortId = parts.length > 3 ? parts.slice(3).join("-") : e.sessionKey;
    return shortId === parsed.id;
  });

  if (!entry) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  proxyWsToContainer(entry.containerName, parsed.subPath, req, socket, head);
  return true;
}
