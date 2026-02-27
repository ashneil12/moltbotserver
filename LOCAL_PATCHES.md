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
