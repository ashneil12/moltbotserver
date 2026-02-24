import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
/**
 * Gateway handler for sandbox browser management:
 *   - GET  /api/sandbox-browsers   → list active sandbox browser containers
 *   - ANY  /sbx-browser/:id/*      → reverse-proxy HTTP/WS to the container's noVNC
 *
 * Auth: requires a valid gateway token (Bearer or ?token= query param).
 */
import type { Duplex } from "node:stream";
import {
  readBrowserRegistry,
  type SandboxBrowserRegistryEntry,
} from "../agents/sandbox/registry.js";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
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
/** Maximum allowed agent ID length to prevent abuse. */
const MAX_AGENT_ID_LENGTH = 64;
/** Characters allowed in agent IDs (alphanumeric + hyphens). */
const VALID_AGENT_ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

// ── Types ──────────────────────────────────────────────────────────────

export interface SandboxBrowserInfo {
  /** Unique short identifier derived from the container name */
  id: string;
  /** Human-readable label */
  label: string;
  /** "host" for the shared browser, "sandbox" for dynamic per-agent, "agent" for static per-agent */
  type: "host" | "sandbox" | "agent";
  /** URL path prefix for noVNC access */
  path: string;
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

// ── ID derivation (single source of truth) ─────────────────────────────

/**
 * Derive a short, URL-safe identifier from a registry entry.
 * Container names follow the pattern `openclaw-sbx-browser-{agentId}`.
 * Falls back to the session key for non-standard names.
 */
function deriveShortId(entry: SandboxBrowserRegistryEntry): string {
  const parts = entry.containerName.split("-");
  // "openclaw-sbx-browser-dan" → ["openclaw", "sbx", "browser", "dan"]
  if (parts.length > 3) {
    return parts.slice(3).join("-");
  }
  // Fallback: use session key, strip "agent:" prefix if present
  const key = entry.sessionKey;
  return key.startsWith("agent:") ? key.slice(6) : key;
}

/**
 * Derive a human-readable label from a session key.
 */
function deriveLabel(sessionKey: string): string {
  const name = sessionKey.startsWith("agent:") ? sessionKey.slice(6) : sessionKey;
  if (!name) {
    return "Unknown";
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Path parsing ───────────────────────────────────────────────────────

/**
 * Parse "/sbx-browser/{id}/some/path" into { id, subPath }.
 * Returns null if the URL doesn't match the prefix or if the id is invalid.
 */
function parseSbxBrowserPath(pathname: string): { id: string; subPath: string } | null {
  if (!pathname.startsWith(PROXY_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(PROXY_PREFIX.length);
  if (!rest) {
    return null;
  }

  const slashIdx = rest.indexOf("/");
  const id = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const subPath = slashIdx === -1 ? "/" : rest.slice(slashIdx) || "/";

  // Validate ID to prevent path traversal and injection
  if (!id || id.length > MAX_AGENT_ID_LENGTH || !VALID_AGENT_ID_RE.test(id)) {
    return null;
  }

  return { id, subPath };
}

// ── Registry lookup ────────────────────────────────────────────────────

/**
 * Find a registry entry by short ID. Uses `deriveShortId` for consistent matching.
 */
function findEntryByShortId(
  entries: SandboxBrowserRegistryEntry[],
  targetId: string,
): SandboxBrowserRegistryEntry | undefined {
  return entries.find((e) => deriveShortId(e) === targetId);
}

// ── API: list browsers ─────────────────────────────────────────────────

async function handleListBrowsers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const registry = await readBrowserRegistry();
  const config = loadConfig();

  const browsers: SandboxBrowserInfo[] = [
    // Main/host browser is always first
    { id: "main", label: "Main", type: "host", path: "/browser" },
  ];

  // Include per-agent static browsers from config.browser.profiles
  // These are dedicated browser containers with Caddy noVNC routes
  const profiles = config.browser?.profiles ?? {};
  for (const [name, profile] of Object.entries(profiles)) {
    // Skip the default "openclaw" profile (that's the main browser above)
    if (name === "openclaw" || name === "chrome") {
      continue;
    }
    // Only include profiles pointing to a browser-<name> container
    const cdpUrl = (profile as { cdpUrl?: string }).cdpUrl ?? "";
    if (cdpUrl.includes(`browser-${name}:`)) {
      browsers.push({
        id: name,
        label: name.charAt(0).toUpperCase() + name.slice(1),
        type: "agent",
        path: `/browser-${name}`,
      });
    }
  }

  // Track IDs already listed (main + static profiles) to avoid duplicates
  const listedIds = new Set(browsers.map((b) => b.id));

  // Include dynamic sandbox browsers from the registry
  for (const entry of registry.entries) {
    const shortId = deriveShortId(entry);
    // Skip if already listed as a static agent browser profile
    if (listedIds.has(shortId)) {
      continue;
    }
    browsers.push({
      id: shortId,
      label: deriveLabel(entry.sessionKey),
      type: "sandbox",
      path: `${PROXY_PREFIX}${shortId}`,
      // containerName intentionally omitted — no need to expose Docker internals
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
  // Strip hop-by-hop headers that shouldn't be forwarded
  const {
    connection: _connection,
    upgrade: _upgrade,
    "keep-alive": _ka,
    ...forwardHeaders
  } = req.headers;

  const proxyReq = httpRequest(
    {
      hostname: containerName,
      port: NOVNC_INTERNAL_PORT,
      path: subPath,
      method: req.method,
      headers: {
        ...forwardHeaders,
        host: `${containerName}:${NOVNC_INTERNAL_PORT}`,
      },
      timeout: 10_000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.statusCode = 504;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Browser proxy timeout" }));
    }
  });

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
    timeout: 10_000,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    // Relay the upstream 101 response including any extra headers from noVNC
    const headerLines = [`HTTP/1.1 101 ${proxyRes.statusMessage ?? "Switching Protocols"}`];
    const rawHeaders = proxyRes.rawHeaders;
    for (let i = 0; i < rawHeaders.length; i += 2) {
      headerLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
    }
    headerLines.push("", "");
    socket.write(headerLines.join("\r\n"));

    if (proxyHead.length > 0) {
      socket.write(proxyHead);
    }
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // Bidirectional pipe
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    const cleanup = () => {
      proxySocket.destroy();
      socket.destroy();
    };
    proxySocket.on("error", cleanup);
    socket.on("error", cleanup);
    proxySocket.on("end", () => socket.end());
    socket.on("end", () => proxySocket.end());
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    socket.destroy();
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });

  // If the upstream responds with a non-upgrade HTTP response (e.g. 400/404),
  // relay it back and close
  proxyReq.on("response", (proxyRes) => {
    const status = proxyRes.statusCode ?? 502;
    socket.write(
      `HTTP/1.1 ${status} ${proxyRes.statusMessage ?? "Error"}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
    proxyRes.resume(); // Drain to avoid backpressure
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

  const registry = await readBrowserRegistry();
  const entry = findEntryByShortId(registry.entries, parsed.id);

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
  const entry = findEntryByShortId(registry.entries, parsed.id);

  if (!entry) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  proxyWsToContainer(entry.containerName, parsed.subPath, req, socket, head);
  return true;
}
