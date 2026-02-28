# Local Patches (Do Not Overwrite During Upstream Sync)

This file documents files with **critical local modifications** that diverge from
upstream `openclaw/openclaw`. After every `git rebase upstream/main`, you **MUST**
verify these patches are still present.

## Quick Verification

```bash
# Run after every upstream sync to verify patches survived
grep -c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts  # expect ≥ 1
grep -c 'fetchJson<ChromeVersion>' src/browser/chrome.ts          # expect ≥ 1
ls scripts/cdp-host-proxy.py                                      # expect exists
grep -c 'CDP_PROXY_SCRIPT' scripts/sandbox-browser-entrypoint.sh  # expect ≥ 1
grep -c 'cdp-host-proxy' Dockerfile.sandbox-browser                # expect ≥ 1
grep -c 'prebaked-plugins' Dockerfile                              # expect ≥ 1
grep -c 'handleSandboxBrowserRequest' src/gateway/server-http.ts   # expect ≥ 1
```

## Patched Files

### 1. `src/browser/cdp.helpers.ts` — CDP Host Header Fix

**Why**: Node.js `fetch()` silently ignores the `Host` header (forbidden per Fetch spec).
Chrome 107+ rejects CDP requests with non-localhost/non-IP Host headers. Docker service
hostnames like `http://browser:9222` fail without this fix.

**What**: Added `httpRequestWithHostOverride()` function that uses `http.request()` instead
of `fetch()` when a `Host` header override is needed. Modified `fetchChecked()` to use it.

**How to verify**: `grep -c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts`

### 2. `src/browser/chrome.ts` — fetchChromeVersion Fix

**Why**: `fetchChromeVersion` called `fetch()` directly, bypassing the Host header fix.

**What**: Changed to use `fetchJson` from `cdp.helpers.ts` which routes through the fixed
`fetchChecked` → `httpRequestWithHostOverride`.

**How to verify**: `grep -c 'fetchJson<ChromeVersion>' src/browser/chrome.ts`

### 3. `scripts/cdp-host-proxy.py` — Container-Level CDP Proxy (NEW file)

**Why**: Belt-and-suspenders. Rewrites Host header at the container level so any client works.

**What**: Python HTTP+WebSocket reverse proxy that rewrites Host to `localhost`.

### 4. `scripts/sandbox-browser-entrypoint.sh` — Uses CDP Proxy

**Why**: Replaces socat TCP proxy with the Python proxy that rewrites the Host header.

**What**: Added `CDP_PROXY_SCRIPT` block with socat fallback for older images.

### 5. `Dockerfile.sandbox-browser` — Copies CDP Proxy Script

**Why**: Needs to copy `cdp-host-proxy.py` into the container image.

**What**: Added `COPY scripts/cdp-host-proxy.py /usr/local/bin/openclaw-cdp-host-proxy`.

### 6. `Dockerfile` — Honcho Plugin Pre-Bake

**Why**: The Honcho plugin must have `root` (uid=0) ownership to pass the OpenClaw plugin
scanner's ownership check. Runtime installation creates files as uid=1000 which Docker UID
remapping prevents from being chowned to root. Pre-baking during the image build ensures
correct ownership from the build layer.

**What**: Added section at lines 70–82: `npm pack @honcho-ai/openclaw-honcho` → extract →
move to `/app/prebaked-plugins/openclaw-honcho` → `npm install --omit=dev`. The entrypoint
copies this with `cp -a` to the data volume, preserving root ownership.

**How to verify**: `grep -c 'prebaked-plugins' Dockerfile`

### 7. `src/gateway/server-http.ts` — Sandbox Browser Handler Wiring

**Why**: `handleSandboxBrowserRequest` and `handleSandboxBrowserUpgrade` were defined in
`sandbox-browsers.ts` but never imported or called. The gateway served SPA HTML at
`/api/sandbox-browsers` instead of the browser list JSON. Per-agent browser noVNC was
unreachable via WebSocket.

**What**: Imported both handlers and wired them into:

- HTTP chain: after `handleToolsInvokeHttpRequest`, before `handleSlackHttpRequest`
- WebSocket upgrade chain: before the general WebSocket server handler

**How to verify**: `grep -c 'handleSandboxBrowserRequest' src/gateway/server-http.ts`

### 8. `src/agents/openclaw-tools.ts` — Browser Tool Agent Routing

**Why**: `createBrowserTool()` was called without `agentId`, so the auto-routing code at
`browser-tool.ts:300` never fired. Agents always used the default `openclaw` profile (main
browser) instead of their dedicated container.

**What**: Added `agentId: resolveSessionAgentId({ sessionKey, config })` to the
`createBrowserTool()` call, matching the pattern already used in `moltbot-tools.ts`.

**How to verify**: `grep -c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts`
