# Local Patches (Do Not Overwrite During Upstream Sync)

This file documents files with **critical local modifications** that diverge from
upstream `openclaw/openclaw`. After every `git rebase upstream/main`, you **MUST**
verify these patches are still present.

> Run the `/verify-sync` workflow for full automated verification (Gate 2 runs all these checks).

## Quick Verification Script

```bash
# Copy-paste this block — runs all checks, exits 1 on any failure.
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
FAIL=0
c() { r=$(grep -c "$1" "$2" 2>/dev/null || echo 0); [ "$r" -ge "$3" ] && echo "✅ $4" || { echo "❌ $4 (got $r, need ≥$3)"; FAIL=1; }; }
e() { [ -e "$1" ] && echo "✅ $2" || { echo "❌ $2 ($1 missing)"; FAIL=1; }; }

echo "=== Browser ==="
c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts 1 "CDP Host header fix"
c 'fetchJson<ChromeVersion>' src/browser/chrome.ts 1 "fetchChromeVersion fix"
e scripts/cdp-host-proxy.py "CDP proxy script"
c 'CDP_PROXY_SCRIPT' scripts/sandbox-browser-entrypoint.sh 1 "Entrypoint CDP proxy"
c 'cdp-host-proxy' Dockerfile.sandbox-browser 1 "Dockerfile CDP copy"
c 'handleSandboxBrowserRequest' src/gateway/server-http.ts 1 "Sandbox browser wiring"
c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts 1 "Browser agent routing"
c 'Promise.all' src/browser/server-context.ts 1 "Parallel profile listing"
c 'timeoutMs: 5000' src/browser/client.ts 1 "Profile timeout bump"
c 'sweepStaleBrowserContainers' src/gateway/server-startup.ts 1 "Browser startup sweep"
c 'readDockerImageId' src/agents/sandbox/docker.ts 1 "Docker image digest"
c 'downloadWorkspaceForCdp' src/browser/control-service.ts 1 "Auto-download wiring"

echo "=== Security ==="
c 'redactSecrets' src/auto-reply/reply/normalize-reply.ts 1 "Secret redaction in reply"
c 'SECRET_PATTERNS' src/security/data-classification.ts 1 "Secret patterns defined"
c 'globalRegex' src/security/data-classification.ts 2 "Precomputed globalRegex"
c 'logSecurityEvent' src/security/security-event-journal.ts 1 "Security event journal"
c 'logSecurityEvent' src/auto-reply/reply/normalize-reply.ts 1 "Journal wired in reply"
c 'collectSearxngExposureFindings' src/security/audit-extra.sync.ts 1 "SearXNG audit"
c 'collectGatewayBindCorsFindings' src/security/audit-extra.sync.ts 1 "Gateway CORS audit"
c 'scanAndLog' src/agents/workspace.ts 1 "Workspace context scanning"

echo "=== Memory & Search ==="
c '"workspace"' src/memory/types.ts 1 "Workspace memory source"
c 'resolveDefaultWorkspaceCollection' src/memory/backend-config.ts 1 "Workspace collection"
c 'addCollectionWithRetry' src/memory/qmd-manager.ts 1 "QMD retry logic"
c 'warnIfWorkspaceCollectionsEmpty' src/memory/qmd-manager.ts 1 "QMD empty warning"
c 'createWorkspaceSearchTool' src/agents/tool-catalog.ts 1 "workspace_search tool"
c 'createSqlQueryTool' src/agents/openclaw-tools.ts 1 "SQL tool registration"
c 'applySourceBoostToResults' src/memory/hybrid.ts 1 "Source-aware boost"
c 'runSearxngSearch' src/agents/tools/web-search.ts 1 "SearXNG provider"
c 'resolveSearxngEngines' src/agents/tools/web-search.ts 1 "SearXNG engine resolver"
c 'slice().sort()' src/agents/tools/web-search.ts 1 "Cache key immutability"
c 'fetchScraplingContent' src/agents/tools/web-fetch.ts 1 "Scrapling fallback"

echo "=== Sessions ==="
c 'isEphemeralPath' src/infra/ephemeral-path.ts 1 "Ephemeral path guard"
c 'validateSessionPathFreshness' src/auto-reply/reply/session-freshness.ts 1 "Session freshness"
c 'createdAt' src/config/sessions/types.ts 1 "Session createdAt field"
c 'shouldForceRefresh' src/auto-reply/reply/session-updates.ts 1 "Stale refresh trigger"
c 'onTtlExpired' src/auto-reply/reply/typing.ts 1 "Typing TTL callback"

echo "=== Cron & Reflection ==="
c 'parseNextWakeDuration' src/cron/service/timer.ts 1 "NEXT_WAKE parser"
c 'parseEvidenceCounters' src/cron/diary-archive.ts 1 "Evidence counters"
c 'flagProblematicRules' src/cron/isolated-agent/reflection-artifacts.ts 1 "Problematic rules"
c 'appendReflectionChangeLog' src/cron/isolated-agent/reflection-artifacts.ts 1 "Reflection log"
c 'skill-evolution' enforce-config.mjs 1 "Skill-evolution cron"
c 'progressiveDisclosure' src/config/types.skills.ts 1 "Progressive disclosure"
c 'createSkillViewTool' src/agents/openclaw-tools.ts 1 "Skill view tool"

echo "=== Auto-Heal ==="
c 'createAutoHealTool' src/agents/tools/moltbot-tools.ts 1 "Auto-heal tool (moltbot)"
c 'createAutoHealTool' src/agents/tools/openclaw-tools.ts 1 "Auto-heal tool (openclaw)"
c 'auto_heal' src/logging/health-sentinel.ts 1 "Sentinel auto-heal guidance"
e src/logging/error-journal.ts "Error journal module"
e src/cron/auto-heal-journal.ts "Auto-heal journal module"
e src/agents/tools/auto-heal-tool.ts "Auto-heal tool module"
e src/agents/tools/auto-heal-escalation.ts "Auto-heal escalation module"

echo "=== Multi-Agent Team Coordination ==="
c 'symlinkSync' enforce-config.mjs 1 "Team directory symlink"
c 'team-sync' cron/default-jobs.json 1 "team-sync cron job"
e scripts/provision-agent.sh "Deterministic provisioning script"

echo "=== Infrastructure ==="
c 'OPENCLAW_MANAGED_PLATFORM' docker-entrypoint.sh 3 "Managed platform guards"
c 'OPENCLAW_MANAGED_PLATFORM' enforce-config.mjs 2 "Managed platform enforce"
c 'tools.profile = "full"' enforce-config.mjs 1 "Full tool profile"
c 'lossless-claw' Dockerfile 1 "LCM pre-bake"
c 'contextEngine' enforce-config.mjs 1 "LCM slot assignment"
c 'yt-dlp' Dockerfile 1 "Agent CLI tooling"
c 'MEDIA_DOWNLOAD_TIMEOUT_MS' src/telegram/bot-handlers.ts 1 "Telegram media timeout"
c 'qmd pre-warm' docker-entrypoint.sh 1 "QMD pre-warm"
c 'workspace-doc-converter' docker-entrypoint.sh 1 "Doc converter sidecar"
c 'patch-qmd-gemini' docker-entrypoint.sh 1 "QMD Gemini embedding patch"
e scripts/patch-qmd-gemini.sh "QMD Gemini patch script"
e scripts/workspace-doc-converter.sh "Doc converter script"
e Dockerfile.scrapling "Scrapling Dockerfile"
e scripts/scrapling-server.py "Scrapling server"

echo "=== Agent Behavior ==="
c 'Autonomous Problem-Solving' src/agents/system-prompt.ts 1 "Autonomous problem-solving"
c 'Exhaust Before Escalating' SOUL.md 1 "Exhaust before escalating"
c 'path.resolve' src/agents/system-prompt.ts 1 "IDENTITY.md health nudge fix"

echo ""
[ "$FAIL" -eq 0 ] && echo "✅ ALL CHECKS PASSED" || { echo "❌ SOME CHECKS FAILED"; exit 1; }
```

---

## Patched Files — Browser

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

### 6. `src/gateway/server-http.ts` — Sandbox Browser Handler Wiring

**Why**: `handleSandboxBrowserRequest` and `handleSandboxBrowserUpgrade` were defined in
`sandbox-browsers.ts` but never imported or called. The gateway served SPA HTML at
`/api/sandbox-browsers` instead of the browser list JSON. Per-agent browser noVNC was
unreachable via WebSocket.

**What**: Imported both handlers and wired them into HTTP chain and WebSocket upgrade chain.

**How to verify**: `grep -c 'handleSandboxBrowserRequest' src/gateway/server-http.ts`

### 7. `src/agents/openclaw-tools.ts` — Browser Tool Agent Routing

**Why**: `createBrowserTool()` was called without `agentId`, so the auto-routing code at
`browser-tool.ts:300` never fired. Agents always used the default `openclaw` profile (main
browser) instead of their dedicated container.

**What**: Added `agentId: resolveSessionAgentId({ sessionKey, config })` to the
`createBrowserTool()` call, matching the pattern already used in `moltbot-tools.ts`.

**How to verify**: `grep -c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts`

### 8. `src/browser/server-context.ts` — Parallel Profile Listing

**Why**: `listProfiles()` iterated all browser profiles serially, making CDP reachability checks
one-by-one. With 7 remote profiles × ~500ms per check, total time exceeded the client-side
3000ms timeout, causing "Can't reach the OpenClaw browser control service" errors.

**What**: Replaced the serial `for` loop with `Promise.all` + `.map()` pattern. All profile
checks now run in parallel, reducing total time from O(n × timeout) to O(timeout).

**How to verify**: `grep -c 'Promise.all' src/browser/server-context.ts`

### 9. `src/browser/client.ts` — Browser Profiles Timeout Bump

**Why**: The `browserProfiles` client call used a 3000ms timeout that was too tight for 7
remote profiles, even with parallel checks and potential network latency.

**What**: Increased `timeoutMs` from `3000` to `5000` for the `/profiles` endpoint.

**How to verify**: `grep -c 'timeoutMs: 5000' src/browser/client.ts`

### 10. `src/gateway/server-startup.ts` — Browser Startup Sweep

**Why**: After a Docker image update, existing browser containers run the old image. Without
auto-recreation, agents get stale browsers until manually restarted.

**What**: Added fire-and-forget `sweepStaleBrowserContainers()` call in `startGatewaySidecars()`.

**How to verify**: `grep -c 'sweepStaleBrowserContainers' src/gateway/server-startup.ts`

### 11. `src/agents/sandbox/docker.ts` — Docker Image Digest Utilities

**Why**: Browser sweep needs to compare running container image vs latest pulled image.

**What**: Added `readDockerImageId()` and `readDockerContainerImageId()`.

**How to verify**: `grep -c 'readDockerImageId' src/agents/sandbox/docker.ts`

### 12. `src/browser/control-service.ts` — Auto-Download Workspace Registration

**Why**: Browser downloads had no per-agent routing — all downloads went to a single location.

**What**: Per-profile workspace registration for auto-downloads (`setDownloadWorkspaceForCdp`).

**How to verify**: `grep -c 'downloadWorkspaceForCdp' src/browser/control-service.ts`

---

## Patched Files — Security

### 13. `src/security/data-classification.ts` — AgentGuard Secret Redaction

**Why**: Agent outputs can accidentally include API keys, tokens, and connection strings.

**What**: 14 `SECRET_PATTERNS` (OpenAI, GitHub, Slack, Stripe, Google, AWS, Telegram, Discord,
Groq/npm/Anthropic, connection strings, Bearer tokens, PEM keys). `redactSecrets()`,
`containsSecrets()`. Precomputed `globalRegex` on both `PiiPattern` and `SecretPattern`.

**How to verify**: `grep -c 'SECRET_PATTERNS' src/security/data-classification.ts`

### 14. `src/auto-reply/reply/normalize-reply.ts` — Secret Redaction Wiring

**Why**: Redaction must happen in the reply pipeline, after all other text sanitization.

**What**: `redactSecrets()` called after `sanitizeUserFacingText()`, logs `secret_redacted` events.

**How to verify**: `grep -c 'redactSecrets' src/auto-reply/reply/normalize-reply.ts`

### 15. `src/security/security-event-journal.ts` — Security Event Journal

**Why**: Security-relevant events need structured, queryable logging.

**What**: Append-only log for `secret_redacted`, `content_quarantined`, `injection_detected`,
`audit_finding` events. Fire-and-forget API.

**How to verify**: `grep -c 'logSecurityEvent' src/security/security-event-journal.ts`

### 16. `src/security/audit-extra.sync.ts` — OC Deployment Audit

**Why**: Deployment-specific security checks (SearXNG exposure, gateway CORS, etc.).

**What**: 5 collectors for deployment audit checks.

**How to verify**: `grep -c 'collectSearxngExposureFindings' src/security/audit-extra.sync.ts`

### 17. `src/agents/workspace.ts` — Workspace Context Security Scanning

**Why**: Workspace context files (SOUL.md, OPERATIONS.md) could contain injections.

**What**: `scanAndLog()` with `source: "workspace_context"` before system prompt injection.

**How to verify**: `grep -c 'scanAndLog' src/agents/workspace.ts`

---

## Patched Files — Memory & Search

### 18. `src/memory/types.ts` — Workspace Memory Source

**Why**: Auto-indexing workspace documents requires a new memory source type.

**What**: Added `"workspace"` to `MemorySource` union.

**How to verify**: `grep -c '"workspace"' src/memory/types.ts`

### 19. `src/memory/qmd-manager.ts` — QMD Initialization Hardening

**Why**: Single QMD timeout permanently breaks `workspace_search` for the container lifetime.

**What**: `addCollectionWithRetry()` (3 attempts, 5s delay), `warnIfWorkspaceCollectionsEmpty()`.

**How to verify**: `grep -c 'addCollectionWithRetry' src/memory/qmd-manager.ts`

### 20. `src/memory/hybrid.ts` — Source-Aware Ranking

**Why**: Agent knowledge files (`MEMORY.md`, `IDENTITY.md`) should rank higher in search results.

**What**: `applySourceBoostToResults()` called after score merge, before temporal decay.

**How to verify**: `grep -c 'applySourceBoostToResults' src/memory/hybrid.ts`

### 21. `src/agents/tools/web-search.ts` — SearXNG Search Provider

**Why**: Self-hosted, keyless metasearch engine.

**What**: `runSearxngSearch()`, `resolveSearxngEngines()`, engine selection via `SEARXNG_ENGINES`.
Bug fix: `slice().sort()` prevents cache key mutation.

**How to verify**: `grep -c 'runSearxngSearch' src/agents/tools/web-search.ts`

### 22. `src/agents/tools/web-fetch.ts` — Scrapling Stealth Fallback

**Why**: Bot-protected sites block direct fetch. Scrapling uses browser fingerprint evasion.

**What**: `fetchScraplingContent()`, fallback chain: direct → Scrapling → Firecrawl.

**How to verify**: `grep -c 'fetchScraplingContent' src/agents/tools/web-fetch.ts`

---

## Patched Files — Session Stability

### 23. `src/infra/ephemeral-path.ts` — Stale Snapshot Guard 1

**Why**: Sessions pointing at tmpfs paths lose data on reboot.

**What**: `isEphemeralPath()` detects `/tmp`, `os.tmpdir()`, macOS `/private/tmp`, Linux `tmpfs`/`ramfs`.

**How to verify**: `grep -c 'isEphemeralPath' src/infra/ephemeral-path.ts`

### 24. `src/auto-reply/reply/session-freshness.ts` — Stale Snapshot Guard 2

**Why**: Long-lived LCM sessions can operate with stale workspace paths.

**What**: `validateSessionPathFreshness()` checks workspace dir exists + matches session report.

**How to verify**: `grep -c 'validateSessionPathFreshness' src/auto-reply/reply/session-freshness.ts`

### 25. `src/config/sessions/types.ts` — Session Unification Guard

**Why**: Session dedup needs to prefer newer entries by creation time, not last-modified time.

**What**: `createdAt?: number` field, `healthState?` for circuit-breaker state.

**How to verify**: `grep -c 'createdAt' src/config/sessions/types.ts`

### 26. `src/auto-reply/reply/typing.ts` — Typing TTL Callback

**Why**: Users get no feedback when LLM runs exceed the typing indicator TTL.

**What**: `onTtlExpired` callback fired when typing TTL expires while LLM run is still active.

**How to verify**: `grep -c 'onTtlExpired' src/auto-reply/reply/typing.ts`

---

## Patched Files — Cron & Reflection

### 27. `src/cron/service/timer.ts` — NEXT_WAKE Dynamic Scheduling

**Why**: Cron jobs need to dynamically adjust their next run based on output.

**What**: `parseNextWakeDuration()` parses `NEXT_WAKE: <duration>` from full output text.

**How to verify**: `grep -c 'parseNextWakeDuration' src/cron/service/timer.ts`

### 28. `src/cron/diary-archive.ts` — Evidence Counters

**Why**: Promoted CRITICAL rules need effectiveness tracking.

**What**: `parseEvidenceCounters()`, `correlateHitMissWithRules()`, `updateEvidenceCounters()`, `flagProblematicRules()`.

**How to verify**: `grep -c 'parseEvidenceCounters' src/cron/diary-archive.ts`

### 29. `src/cron/isolated-agent/reflection-artifacts.ts` — Structured Reflection Log

**Why**: Reflection changes need a structured, queryable audit trail.

**What**: `appendReflectionChangeLog()` writes JSONL to `memory/reflection-change-log.jsonl` (200-entry cap).

**How to verify**: `grep -c 'appendReflectionChangeLog' src/cron/isolated-agent/reflection-artifacts.ts`

---

## Patched Files — Infrastructure

### 30. `docker-entrypoint.sh` — Managed Platform Guards

**Why**: Community deployments must not get SaaS-mode bypasses (auto-onboard, auto-approve).

**What**: `OPENCLAW_MANAGED_PLATFORM` guards (≥3 occurrences), QMD pre-warm, doc converter sidecar.

**How to verify**: `grep -c 'OPENCLAW_MANAGED_PLATFORM' docker-entrypoint.sh` (expect ≥ 3)

### 31. `enforce-config.mjs` — Tool Profile & Cron Enforcement

**Why**: Stale configs from previous boots must be overwritten to prevent missing tools.

**What**: `tools.profile = "full"` enforcement, 4-tier reflection patching, skill-evolution cron,
cron schedule redesign, LCM context engine slot, `MAIN_ONLY_JOBS` filtering.

**How to verify**: `grep -c 'tools.profile = "full"' enforce-config.mjs` (expect ≥ 1)

### 32. `Dockerfile` — Agent CLI Tooling & LCM Pre-bake

**Why**: Agents need CLI tools and the LCM plugin available on first boot.

**What**: `yt-dlp`, `ffmpeg`, `pandoc`, etc.; `npm pack @martian-engineering/lossless-claw` (soft-fail).

**How to verify**: `grep -c 'yt-dlp' Dockerfile` and `grep -c 'lossless-claw' Dockerfile`

### 33. `src/telegram/bot-handlers.ts` — Media Download Timeout

**Why**: Hung media downloads block entire message groups.

**What**: 15s `MEDIA_DOWNLOAD_TIMEOUT_MS` on `resolveMedia` calls.

**How to verify**: `grep -c 'MEDIA_DOWNLOAD_TIMEOUT_MS' src/telegram/bot-handlers.ts`

### 34. `src/auto-reply/heartbeat.ts` — Heartbeat Default

**Why**: 30m heartbeats fire too frequently for multi-agent deployments.

**What**: `DEFAULT_HEARTBEAT_EVERY` changed from `"30m"` to `"1h"`.

**How to verify**: `grep 'DEFAULT_HEARTBEAT_EVERY' src/auto-reply/heartbeat.ts` (expect `"1h"`)

### 35. `src/agents/system-prompt.ts` — Agent Behavior Patches

**Why**: Multiple behavior improvements must survive upstream rewrites.

**What**: `Autonomous Problem-Solving` section, `Operating Discipline step 5 (Document)`,
`path.resolve` fix for IDENTITY.md health nudge, model-alias consolidation.

**How to verify**: `grep -c 'Autonomous Problem-Solving' src/agents/system-prompt.ts` (expect ≥ 1)
