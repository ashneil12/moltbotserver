# OPENCLAW_CHANGELOG.md — MoltBot Custom Modifications Log

This file is the complete record of all custom changes made to the OpenClaw source for the MoltBot platform.
For the upstream sync reference (what to preserve during merges), see `OPENCLAW_CONTEXT.md`.

---

## Merge Artifact Cleanup (2026-02-25)

**Purpose:** Remove duplicate function/variable declarations left behind by the upstream rebase. These caused esbuild compilation failures in ~5 test files.

### Files Fixed

| File | Duplicates Removed | Lines Saved |
|------|-------------------|-------------|
| `src/security/audit-extra.sync.ts` | 4 functions (`hasConfiguredDockerConfig`, `normalizeNodeCommand`, `listKnownNodeCommands`, `looksLikeNodeCommandPattern`) | 55 |
| `src/agents/workspace.ts` | 2 variables (`workspaceTemplateCache`, `gitAvailabilityPromise`) + 1 function (`loadExtraBootstrapFiles`) | 70 |
| `src/config/io.ts` | 3 functions (`resolveConfigAuditLogPath`, `resolveConfigWriteSuspiciousReasons`, `appendConfigWriteAuditRecord`) | 49 |
| `src/agents/models-config.providers.ts` | 1 function (`discoverVllmModels`) | 53 |
| `src/agents/workspace.ts` | Added missing `resolveHonchoEnabled()` + `stripHonchoConditionals()` (referenced but never defined after rebase) | +47 (added) |
| `src/agents/system-prompt.test.ts` | Updated owner line format (`Owner numbers:` → `Authorized senders:`) + Skills section assertion | 3 lines changed |

### Impact

- **~225 lines of dead duplicate code removed**
- **5 previously-broken test files now compile and pass** (audit, audit-extra.sync, dm-policy-shared, fix, system-prompt)
- **314/315 tests pass** (1 remaining failure is a pre-existing `trusted-proxy` auth guardrail test)

---

## Security & Observability Infrastructure (2026-02-25)

**Purpose:** Add four new security/observability modules and wire them into the agent pipeline: content scanning for external inputs, structured event logging, data classification for privacy controls, and system health checks.

### New Modules

| File | Purpose | Tests |
|------|---------|-------|
| `src/security/content-scanner.ts` | Two-stage content scanner (40+ regex patterns + optional frontier model). Detects prompt injection, SQL injection, role spoofing, data exfiltration, command injection. Risk scoring via `sqrt(sum) * 15`. | 48 |
| `src/logging/event-log.ts` | Structured JSONL event logger with per-event files + unified stream. PII redaction, log rotation, queryable history. | 30 |
| `src/security/data-classification.ts` | Three-tier data classification (Confidential/Internal/Public) with context-aware gating and PII detection. | 47 |
| `src/logging/diagnostics-toolkit.ts` | System health checks: PID file, port reachability, error rate, disk space. Cron job debugging. | 21 |
| `src/security/scan-and-log.ts` | Shared `scanAndLog()` helper — DRY wrapper for scan + log + warn. Lazy singleton EventLogger. | — |

### Integration Points

| File | Integration |
|------|-------------|
| `src/agents/tools/web-fetch.ts` | Scanner on all fetched page content via `scanAndLog()` |
| `src/agents/tools/browser-tool.ts` | Scanner on browser snapshots, console output, tab data via `scanAndLog()` |
| `src/cron/isolated-agent/run.ts` | Scanner on external hook content + cron outcome event logging via `scanAndLog()` |
| `src/agents/system-prompt.ts` | Data sharing policy injected per channel context type (DM/group/channel) |
| `src/logging/diagnostic.ts` | Periodic health check every ~5min via heartbeat counter |

### Design Decisions

- **DRY:** All 3 scan+log+warn integration points use shared `scanAndLog()` helper (~100 lines of boilerplate eliminated)
- **Lazy singleton:** EventLogger initialized on first use via async dynamic import (ESM-safe, no circular deps)
- **Fail-safe:** All scanning/logging wrapped in try-catch — never blocks agent operations
- **Legacy fallback:** Content scanner only calls `detectSuspiciousPatterns()` when no modern patterns match (avoids double-scanning)

### Upstream Sync Risk

**Low.** New modules are fully custom. Integration touchpoints are small (5-10 line additions wrapped in try-catch). `scan-and-log.ts` decouples integration code from direct module imports.

---

## Tool Loop Detection Enablement (2026-02-25)

**Purpose:** Enable the upstream tool loop detection system (disabled by default) for all MoltBot deployments. This is a harness engineering improvement identified during a Manus context engineering audit — the #1 failure mode in agentic systems is agents looping on failed approaches, and OpenClaw already has a comprehensive 624-line detection system that was just turned off.

### Files Modified

| File                 | Change                                                                | Why                                                         |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `enforce-config.mjs` | Added `tools.loopDetection.enabled = true` in `enforceCore()` | Enables 3-detector system (generic repeat, poll-no-progress, ping-pong) |

### How It Works

- **Upstream default:** `tools.loopDetection.enabled = false` (in `src/agents/tool-loop-detection.ts`)
- **MoltBot override:** `enforce-config.mjs` sets `tools.loopDetection.enabled = true` at container startup
- **Guard:** Uses `if (... === undefined)` — respects any existing user config, even explicit `false`
- **Thresholds:** Uses upstream defaults (warning at 10 repeats, critical/block at 20, circuit-breaker at 30)
- **Detectors:** `genericRepeat` (same tool+params N times), `knownPollNoProgress` (polling with identical results), `pingPong` (two tools alternating without progress)

### Upstream Sync Risk

**None.** This only modifies `enforce-config.mjs` which is fully custom to MoltBot. No upstream files touched.

---

## Security & Performance Audit (2026-02-25)

**Purpose:** Comprehensive codebase cleanup focusing on gateway performance bottlenecks and dashboard webhook race conditions. These changes address specific MoltBot deployment pain points but rely on localized, standard patterns to minimize upstream merge conflicts.

### Gateway (MoltBot Core)

| File                         | Change                                                                                                                                  | Why                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/control-ui.ts`  | Refactored `handleControlUiHttpRequest` & `handleControlUiAvatarRequest` to use `fs.createReadStream()` instead of `fs.readFileSync()`. | **Performance:** Synchronous file reads blocked the Node.js event loop, briefly pausing WebSocket messages, agent responses, and cron jobs while the Control UI or avatar was being served. |
| `src/gateway/server-http.ts` | Updated Gateway HTTP server to `await` the Control UI handlers.                                                                         | Required by the async stream refactor.                                                                                                                                                      |
| `src/gateway/*.test.ts`      | Updated test suites to `await` the refactored handlers.                                                                                 | Maintain test suite passing status.                                                                                                                                                         |

### Dashboard (MoltBot Infrastructure)

| File                                             | Change                                                                       | Why                                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard/src/app/api/webhooks/stripe/route.ts` | Added active subscription state verification to `handleSubscriptionDeleted`. | **Race Condition:** Prevents out-of-order Stripe deletion webhooks from tearing down Hetzner resources belonging to a new, active subscription. |

---

## Upstream Sync: v2026.2.23 (2026-02-24)

**286 upstream commits** merged from `openclaw/openclaw` main branch.

### Highlights

- **Security hardening**: ACP permission validation, `allowFrom` id-only default (breaking), sandbox fs-bridge/bind-mount policy, exec wrapper `safeBins` validation, HSTS headers, browser SSRF defaults, prototype pollution protection, cron tool denied on `/tools/invoke`
- **New providers**: Kilo Gateway (#20212), Kimi web_search, moonshot video, Vertex AI for Claude (#23985)
- **Features**: configurable `runTimeoutSeconds` for subagents, per-agent stream params for cache tuning, Bedrock cacheRetention, auto-reply multilingual triggers (#25103), session/cron maintenance hardening (#24753)
- **Channel fixes**: Discord/Matrix/Telegram reasoning-leak suppression, Slack `groupPolicy` Zod fix, orphaned tool-result repair for OpenAI
- **50+ test improvements**: CI stabilization, runtime optimization, deduplication

### Conflict Resolution (49 files)

| Strategy          | Count | Files                                                                     |
| ----------------- | ----- | ------------------------------------------------------------------------- |
| **Take Upstream** | 46    | Core source, extensions, config, commands, tests                          |
| **Keep Local**    | 2     | `AGENTS.md` (custom peer protocol), `device-pair/index.ts` (auto-approve) |
| **Manual Merge**  | 1     | `workspace.ts` (combined MINIMAL_BOOTSTRAP_ALLOWLIST entries)             |

Also fixed 6 files with pre-existing conflict markers from a previous merge.

### Post-Merge

- Soul-evil scorched earth (files deleted, docs already clean)
- Build verified (tsdown + tsc + hook metadata + templates)

---

## Lint Compliance Fixes (2026-02-24)

**Purpose:** Resolve all 9 `oxlint --type-aware` errors to achieve a clean lint pass (0 warnings, 0 errors). All changes are non-behavioral — no runtime impact.

### Source Files

| File                                      | Change                                                       | Why                                       |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `src/discord/send.components.ts`          | Removed unused `import type { APIChannel }`                  | `no-unused-vars` violation                |
| `src/agents/tools/recall-message-tool.ts` | Removed redundant `as "archive" \| "history"` type assertion | `no-unnecessary-type-assertion` violation |

### Test Files

| File                                                                           | Change                                                                                   | Why                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/agents/clawdbot-tools.camera.test.ts` ×3                                  | Added `{}` braces around `throw` in `if` blocks                                          | `eslint(curly)` violation                |
| `src/slack/monitor.tool-result.forces-thread-replies-replytoid-is-set.test.ts` | `String()` → `JSON.stringify()` for mock assertions; added `\|\| {}` to optional spreads | `no-base-to-string` + spread type errors |
| `src/slack/monitor/slash.policy.test.ts`                                       | Added `await` before async call                                                          | `no-floating-promises` violation         |
| `src/slack/monitor/slash.command-arg-menus.test.ts`                            | Added `await` before async call                                                          | `no-floating-promises` violation         |

### Upstream Sync Risk

**Minimal.** 4 of 6 are test files. The 2 source changes are single-line removals. If upstream modifies these files, conflicts will be trivial single-line resolves.

---

## Residential Proxy Support (2026-02-24)

**Purpose:** Allow Chrome browser instances to route traffic through residential proxies via environment variables. Supports authenticated proxies using a dynamically generated Chrome extension for `onAuthRequired` challenges.

### Files Modified / Created

| File                         | Change                                                        | Why                                                               |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/browser/chrome.ts`      | Added `resolveProxyServer()` + `generateProxyAuthExtension()` | Builds `--proxy-server` arg and auth extension from env vars      |
| `src/browser/chrome.ts`      | `launchChrome()` injects proxy args + `--load-extension`      | Routes all browser traffic through the configured proxy           |
| `src/browser/chrome.test.ts` | **NEW** — Unit tests for proxy functions                      | Validates server resolution, extension generation, and edge cases |

### Environment Variables

| Variable         | Required        | Purpose                                       |
| ---------------- | --------------- | --------------------------------------------- |
| `PROXY_HOST`     | Yes (to enable) | Proxy hostname or IP                          |
| `PROXY_PORT`     | No              | Proxy port (appended to host)                 |
| `PROXY_USERNAME` | No              | Auth username (triggers extension generation) |
| `PROXY_PASSWORD` | No              | Auth password (required with username)        |

### How It Works

- `resolveProxyServer()` reads `PROXY_HOST` + `PROXY_PORT` → returns `host:port` string or null
- `generateProxyAuthExtension()` creates a tiny Chrome extension in `userDataDir/_proxy_auth_ext/` with `manifest.json` + `background.js` that intercepts `onAuthRequired` events
- `launchChrome()` adds `--proxy-server=host:port` and `--load-extension=extDir` to Chrome args when configured
- **Note:** Chrome extensions don't load in `--headless=new` mode; our Docker containers use Xvfb so this works

---

## Browser Routing Deduplication Fix (2026-02-24)

**Purpose:** Prevent the `/api/sandbox-browsers` endpoint from returning duplicate entries when an agent has both a static browser profile (from `config.browser.profiles`) and a dynamic sandbox browser running simultaneously.

### Files Modified

| File                              | Change                                                                                  | Why                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/gateway/sandbox-browsers.ts` | Added `listedIds` Set tracking; skip registry entries already listed as static profiles | Dashboard was showing duplicate browser entries for the same agent |

---

## Entrypoint Duplicate Provisioning Removal (2026-02-24)

**Purpose:** Removed `ensure_sandbox_browser_image()` and `ensure_agent_browser_containers()` from `docker-entrypoint.sh`. These functions created standalone Docker containers (`moltbot-browser-<id>-1`) that conflicted with the docker-compose-managed containers (`browser-<id>`) and weren't tracked in the sandbox browser registry.

### Files Modified

| File                   | Change                                                   | Why                                                                     |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docker-entrypoint.sh` | Removed `ensure_sandbox_browser_image()` (~30 lines)     | Image pulls are handled by docker-compose                               |
| `docker-entrypoint.sh` | Removed `ensure_agent_browser_containers()` (~120 lines) | `ensure-agent-browsers.sh` on the VM host is the single source of truth |

### Context

The `ensure-agent-browsers.sh` script (installed by the dashboard's `hetzner-instance-service.ts` at VM provisioning time) generates `docker-compose.override.yml` and patches the `Caddyfile`. The entrypoint functions were a duplicate mechanism that ran inside the container, creating naming conflicts and orphaned containers.

---

## Diary Startup Loading & Two-Phase Archive

**Purpose:** Load `diary.md` into the agent's bootstrap context at startup (with tail-heavy truncation to preserve recent entries), and replace the unreliable prompt-only diary archive cron job with a two-phase system: a deterministic code-level archiver that always runs, followed by an LLM enrichment job that synthesizes a continuity summary.

### Files Modified / Created

| File                                          | Change                                                                          | Why                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/agents/workspace.ts`                     | Added `DEFAULT_DIARY_FILENAME`, type union entry, bootstrap file entry          | Diary is now loaded at startup                  |
| `src/agents/pi-embedded-helpers/bootstrap.ts` | Added diary-specific 12k char cap + tail-heavy truncation (30% head / 60% tail) | Recent entries are more relevant than old ones  |
| `src/cron/diary-archive.ts`                   | **NEW** — Deterministic diary archiver (timer + multi-agent sweep)              | Reliable file archival without LLM dependency   |
| `src/gateway/server-cron.ts`                  | Integrated `startDiaryArchiveTimer` + `stopDiaryArchiveTimer`                   | Timer starts/stops with gateway lifecycle       |
| `src/gateway/server-reload-handlers.ts`       | Calls `stopDiaryArchive()` on cron restart                                      | Prevents orphaned timers                        |
| `cron/default-jobs.json`                      | Replaced `diary-archive` → `diary-post-archive`                                 | LLM enrichment runs after deterministic archive |
| `enforce-config.mjs`                          | Updated `seedCronJobs()`: `archive-review` → `diary-post-archive`               | New agents get the updated job                  |

### How It Works

**Startup:** `diary.md` is loaded with a 12k character cap using tail-heavy truncation — 30% head for template/headers, 60% tail for recent entries. Excluded from cron/subagent sessions via `MINIMAL_BOOTSTRAP_ALLOWLIST`.

**Phase 1 — Deterministic Archive** (code-level timer, every 14 days):

- Copies `memory/diary.md` → `memory/archive/YYYY-MM/diary-YYYY-MM-DD.md`
- Copies `memory/identity-scratchpad.md` → `memory/archive/YYYY-MM/scratchpad-YYYY-MM-DD.md`
- Resets diary to template + raw excerpt (last 30 lines) + `<!-- PREVIOUS_ARCHIVE: path -->` marker
- Multi-agent aware (iterates all workspaces), idempotent, tracks state in `.diary-archive-state.json`

**Phase 2 — LLM Enrichment** (`diary-post-archive` cron job, ~6h after archive):

- Reads the archived diary via the `<!-- PREVIOUS_ARCHIVE: ... -->` marker
- Replaces raw excerpt with a synthesized continuity summary
- Does a final promotion scan (IDENTITY.md, humanization guides, self-review.md)
- If this job fails, the raw excerpt provides degraded but functional continuity

---

## Managed Platform Update Guard (`OPENCLAW_MANAGED_PLATFORM=1`)

**Purpose:** Prevent instances from self-updating via upstream OpenClaw npm/git, which would overwrite MoltBot customizations and potentially brick instances. Updates are delivered exclusively through Docker image pulls managed by the MoltBot dashboard.

**Environment variable:** `OPENCLAW_MANAGED_PLATFORM=1` (set in `docker-entrypoint.sh`)

### Files Modified

| File                                   | Change                                    | Why                                                                         |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `docker-entrypoint.sh`                 | Exports `OPENCLAW_MANAGED_PLATFORM=1`     | Activates all guards below                                                  |
| `docker-entrypoint.sh`                 | Heartbeat prompt STEP 4 updated           | Removes `.update-available` file check, directs to dashboard                |
| `src/gateway/server-methods/update.ts` | Guard at top of `update.run` handler      | Blocks Control UI "Update" button from running upstream git/npm update      |
| `src/cli/update-cli/update-command.ts` | Guard at top of `updateCommand()`         | Blocks `openclaw update` CLI from running upstream update                   |
| `src/infra/update-startup.ts`          | Early return in `runGatewayUpdateCheck()` | Skips npm registry version check (would show misleading "update available") |
| `OPERATIONS.md`                        | Heartbeat step 4 + System Updates section | Tells AI agent to never self-update, directs to dashboard                   |

### How It Works

When `OPENCLAW_MANAGED_PLATFORM=1` is set:

- `openclaw update` CLI → prints error: "Updates are managed by the MoltBot platform"
- `update.run` RPC (Control UI button) → returns error response with dashboard redirect message
- `runGatewayUpdateCheck()` → skips entirely (no npm registry polling)
- AI agent → heartbeat and OPERATIONS.md instruct it to never attempt self-updates

---

## Per-Agent Browser Isolation (`browser-only` Sandbox Mode)

**Purpose:** Allow named sub-agents (Dan, Ephraim, etc.) to each have their own persistent, isolated browser instance with separate cookies, sessions, and localStorage — while temporary helper agents share the main agent's browser.

**Environment variable:** `OPENCLAW_DOCKER_NETWORK` (set in `docker-compose.yml`) — Docker network name for sandbox browser container connectivity.

### Files Modified (moltbotserver-source)

| File                                     | Change                                                               | Why                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/agents/sandbox/types.ts`            | Added `"browser-only"` to `SandboxConfig.mode` union                 | New mode: browser isolation without full container sandbox                            |
| `src/agents/sandbox/runtime-status.ts`   | `shouldSandboxSession` treats `browser-only` like `non-main`         | Only non-main sessions get isolated browsers                                          |
| `src/agents/sandbox/context.ts`          | `resolveSandboxContext` skips container+workspace for `browser-only` | Creates only a browser container, not a full sandbox                                  |
| `src/agents/sandbox/config.ts`           | Auto-enables browser when mode is `browser-only`                     | Mode is meaningless without browser                                                   |
| `src/agents/sandbox/browser.ts`          | Added `docker network connect` after creation                        | Connects sandbox browser to gateway's Docker network                                  |
| `src/config/types.agent-defaults.ts`     | Added `"browser-only"` to defaults mode type                         | Config type alignment                                                                 |
| `src/config/types.agents.ts`             | Added `"browser-only"` to agent mode type                            | Config type alignment                                                                 |
| `src/config/zod-schema.agent-runtime.ts` | Added `"browser-only"` to Zod schema                                 | Validation accepts new mode                                                           |
| `src/gateway/sandbox-browsers.ts`        | **NEW** — API + proxy handler                                        | `GET /api/sandbox-browsers` lists active browsers; `/sbx-browser/:id/*` proxies noVNC |
| `src/gateway/server-http.ts`             | Integrated sandbox browser handler                                   | Added to HTTP request chain + WS upgrade handler                                      |

### How It Works

When `sandbox.mode = "browser-only"` in `openclaw.json`:

- Named agents (distinct IDs like "dan", "ephraim") get dedicated Docker browser containers
- Each browser container has a persistent Docker volume for Chrome profile data
- The main agent and temporary subagents share the host browser sidecar
- The gateway provides `/api/sandbox-browsers` to list active browsers
- The gateway proxies noVNC connections via `/sbx-browser/{agentId}/*` to the correct container
- Sandbox browsers are connected to the gateway's Docker network via `OPENCLAW_DOCKER_NETWORK`

---

## Static Per-Agent Browser Provisioning

**Purpose:** Each sub-agent gets a dedicated, always-running browser container (not dynamic sandbox). The system auto-provisions browser containers, Caddy routes, and browser profiles when agents are added — no manual infra editing.

### Architecture

- `docker-compose.override.yml` — generated by `ensure-agent-browsers.sh`, contains per-agent browser services
- `Caddyfile` — patched by the script with per-agent noVNC routes (`/browser-<agentId>/*`)
- `config.browser.profiles` — auto-created by entrypoint's `enforce_browser_profiles()`
- Gateway `/api/sandbox-browsers` — returns all browsers (host + agent + sandbox) for dashboard discovery

### Files Modified (moltbotserver-source)

| File                              | Change                                                                | Why                                                                        |
| --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/gateway/sandbox-browsers.ts` | `handleListBrowsers` includes per-agent browsers from config profiles | Dashboard auto-discovers agent browsers without hardcoding                 |
| `src/gateway/sandbox-browsers.ts` | `SandboxBrowserInfo.type` union adds `"agent"`                        | Distinguishes static per-agent from dynamic sandbox browsers               |
| `docker-entrypoint.sh`            | `enforce_browser_profiles()` creates profiles + sets `defaultProfile` | Each agent auto-routes to its dedicated `browser-<agentId>:9222` container |
| `docker-entrypoint.sh`            | Assigns colors to new browser profiles                                | Gateway config validation requires color field                             |

### Dashboard Changes

| File                                                     | Change                                               | Why                                          |
| -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `dashboard/src/app/.../BrowserModal.tsx`                 | Fully dynamic — fetches from `/api/sandbox-browsers` | No hardcoded agent names, auto-discovers all |
| `dashboard/src/lib/services/hetzner-instance-service.ts` | Removed hardcoded per-agent browser services         | Override file handles them dynamically       |
| `dashboard/src/lib/services/hetzner-instance-service.ts` | Installs `ensure-agent-browsers.sh` host script      | New instances get the provisioning script    |

### How It Works

1. Agent is added to `openclaw.json` (via agent creation skill or manually)
2. Run `/opt/moltbot/ensure-agent-browsers.sh` on the VM host
3. Script reads agent list, generates `docker-compose.override.yml`, patches `Caddyfile`, fixes volume permissions
4. `docker compose up -d` starts the new browser container
5. Gateway restart → entrypoint creates browser profile + sets `defaultProfile`
6. Dashboard auto-discovers the new browser in the sidebar via `/api/sandbox-browsers`

### Infrastructure Requirements

- Each browser container: `shm_size: 2g`, `security_opt: seccomp=unconfined`
- Volume ownership: uid 1000 (sandbox user inside browser container)
- ~1 GB RAM per agent browser container

### Auto-Provisioning Chain (What Happens When a New Agent Is Added)

| Step | What                                                  | Where                                                           | Automatic?                       |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| 1    | Config profile created (`browser.profiles.<agentId>`) | `docker-entrypoint.sh` → `enforce_browser_profiles()`           | ✅ On gateway restart            |
| 2    | Docker container created (`browser-<agentId>`)        | `ensure-agent-browsers.sh` → `docker-compose.override.yml`      | ⚠️ Script must be run on VM host |
| 3    | Caddy route added (`/browser-<agentId>/*`)            | `ensure-agent-browsers.sh` → Caddyfile patch                    | ⚠️ Script must be run on VM host |
| 4    | Browser tool auto-routes to agent's profile           | `browser-tool.ts` override logic                                | ✅ Automatic at tool call        |
| 5    | Dashboard discovers browser                           | `/api/sandbox-browsers` API (deduplicates agent + sandbox list) | ✅ Automatic                     |

> **Note (2026-02-24):** `ensure_agent_browser_containers()` and `ensure_sandbox_browser_image()` were removed from `docker-entrypoint.sh` to eliminate duplicate provisioning. The entrypoint was creating standalone Docker containers with `moltbot-browser-<id>-1` names that conflicted with the docker-compose-managed containers (`browser-<id>`) and didn't register in the sandbox browser registry. The dashboard's `ensure-agent-browsers.sh` (installed by `hetzner-instance-service.ts` at VM provisioning time) is now the single source of truth for per-agent browser container/route provisioning.

---

## Browser Tool Auto-Routing (`profile` Override)

**Purpose:** Automatically route each sub-agent's browser tool calls to its dedicated browser container, even though agents always pass `profile="openclaw"` from the tool description.

### The Problem

The browser tool description tells agents: _"Use profile='openclaw' for the isolated openclaw-managed browser."_ AI agents dutifully include `profile="openclaw"` in every tool call. Without the override, all agents share the main `openclaw` browser profile regardless of whether they have a dedicated browser.

### Files Modified

| File                               | Change                                                                                             | Why                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `src/agents/tools/browser-tool.ts` | Added `agentId` opt to `createBrowserTool()`                                                       | Factory receives the calling agent's ID    |
| `src/agents/tools/browser-tool.ts` | Auto-override: if `!profile \|\| profile === "openclaw"` and agent has a matching profile → use it | Routes agents to their dedicated browsers  |
| `src/agents/moltbot-tools.ts`      | Passes `resolveSessionAgentId()` as `agentId` to `createBrowserTool()`                             | Wires up the agent ID from session context |
| `src/agents/openclaw-tools.ts`     | Same as above                                                                                      | Both tool factories get the fix            |

### How It Works

```typescript
// In browser-tool.ts execute():
let profile = readStringParam(params, "profile");
if (opts?.agentId && opts.agentId !== "main") {
  const cfg = loadConfig();
  if (cfg.browser?.profiles?.[opts.agentId] && (!profile || profile === "openclaw")) {
    profile = opts.agentId; // Override "openclaw" with agent's own profile
  }
}
```

- Agent passes `profile="openclaw"` (or omits it) → overridden to `profile="solomon"` etc.
- Agent passes `profile="chrome"` → left alone (Chrome extension relay is a separate feature)
- Main agent → no override (`agentId === "main"`)
- Agent with no matching profile in config → no override (falls back to `"openclaw"`)

---

## Browser Persistence (Volume Mount)

**Purpose:** Persist Chrome browser data (cookies, sessions, localStorage, extensions) across container restarts for both the shared browser sidecar and per-agent sandbox browsers.

### Infrastructure Changes

| Location                      | Change                                                         | Why                                                       |
| ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `docker-compose.yml` (server) | `browser-home:/tmp/openclaw-home` volume on browser service    | Persists shared browser data                              |
| `docker-compose.yml` (server) | `/var/run/docker.sock` mounted into gateway                    | Gateway can create sandbox browser containers             |
| `docker-compose.yml` (server) | `OPENCLAW_DOCKER_NETWORK=moltbot_default` env var              | Sandbox browsers join gateway's network for proxy routing |
| Caddyfile (server)            | `/sbx-browser/*` and `/api/sandbox-browsers` routes to gateway | Caddy routes sandbox browser traffic through gateway      |
| `sandbox/browser.ts`          | `${containerName}-profile` named volume                        | Each sandbox browser gets persistent Chrome profile       |

### Dashboard Changes

| File                                                                | Change                                             | Why                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `dashboard/src/lib/services/hetzner-instance-service.ts`            | PaaS template includes `browser-home` volume       | New instances get browser persistence out of the box  |
| `dashboard/src/lib/services/hetzner-instance-service.ts`            | `ensureBrowserVolumeMigration()` helper            | Patches existing instances' compose files on redeploy |
| `dashboard/src/lib/services/hetzner-instance-service.ts`            | Docker socket + network env in compose template    | New instances support sandbox browsers                |
| `dashboard/src/lib/services/hetzner-instance-service.ts`            | Caddyfile template includes sandbox browser routes | New instances proxy sandbox browser traffic           |
| `dashboard/src/app/dashboard/instances/components/BrowserModal.tsx` | Browser selector dropdown                          | Choose which agent's browser to view                  |

---

## CI Runner Replacement (Blacksmith → GitHub-hosted)

**Purpose:** Upstream OpenClaw uses Blacksmith third-party CI runners (`blacksmith-16vcpu-ubuntu-2404`, `blacksmith-16vcpu-ubuntu-2404-arm`, `blacksmith-16vcpu-windows-2025`) which require a paid subscription. Without it, all GitHub Actions jobs queue indefinitely.

### Files Modified

| File                                         | Change                                              |
| -------------------------------------------- | --------------------------------------------------- |
| `.github/workflows/ci.yml`                   | `blacksmith-*` → `ubuntu-latest` / `windows-latest` |
| `.github/workflows/docker-release.yml`       | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/install-smoke.yml`        | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/workflow-sanity.yml`      | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/sandbox-common-smoke.yml` | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/labeler.yml`              | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/stale.yml`                | `blacksmith-*` → `ubuntu-latest`                    |
| `.github/workflows/auto-response.yml`        | `blacksmith-*` → `ubuntu-latest`                    |

---

## Sansa AI Provider Integration

**Purpose:** Add Sansa AI as an implicit provider (openai-completions compatible) so agents can use Sansa models via `SANSA_API_KEY` without manual provider configuration.

### Files Modified

| File                                               | Change                                                                                | Why                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/agents/models-config.providers.ts`            | Added `buildSansaProvider()` + Sansa constants (`SANSA_BASE_URL`, `sansa-auto` model) | Registers Sansa as an implicit provider with OpenAI-completions format |
| `src/agents/model-auth.ts`                         | Added `sansa: "SANSA_API_KEY"` to env key map                                         | Allows API key resolution from environment                             |
| `src/agents/models-config.providers.sansa.test.ts` | **NEW** — Unit tests for Sansa provider                                               | Validates provider builds correctly                                    |
| `docker-entrypoint.sh`                             | Added `sansa-api` case to auth choice switch                                          | Passes `--sansa-api-key` during auto-onboard                           |

---

## Pre-Reset Memory Flush (Cron)

**Purpose:** Run a memory flush agent turn on all active sessions ~20 minutes before the daily session reset (default 4 AM). This ensures durable memories are persisted before the context is discarded at reset.

### Files Modified / Created

| File                                    | Change                                                                             | Why                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/cron/pre-reset-flush.ts`           | **NEW** — Full cron module (318 lines)                                             | Timer computation, session eligibility filtering, sweep logic, synthetic job builder |
| `src/cron/pre-reset-flush.test.ts`      | **NEW** — Comprehensive unit tests (216 lines)                                     | Tests timer math, eligibility checks, and sweep behavior                             |
| `src/gateway/server-cron.ts`            | Integrated `startPreResetFlushTimer` + `stopPreResetFlush` into `GatewayCronState` | Timer starts/stops with gateway cron lifecycle                                       |
| `src/gateway/server-reload-handlers.ts` | Calls `stopPreResetFlush()` on cron restart                                        | Prevents orphaned timers during hot reload                                           |
| `src/config/sessions/types.ts`          | Added `preResetFlushAt?: number` to `SessionEntry`                                 | Deduplication: prevents double-flushing a session                                    |
| `src/auto-reply/reply/session.ts`       | Clears `preResetFlushAt` on session init/reset                                     | Fresh sessions should be re-eligible for flush                                       |

### How It Works

- Timer ticks every 60 seconds, computing the next flush window from `resetAtHour` and `leadMinutes` (default 20 min)
- When the window arrives, sweeps all sessions in the store
- A session is eligible when: `totalTokens ≥ 2000`, hasn't been flushed today, and isn't a cron-run session
- Uses `runCronIsolatedAgentTurn` to bootstrap a synthetic agent turn per eligible session
- Max 20 sessions per sweep to prevent runaway API usage

---

## SOUL.md Rewrite

**Purpose:** Major restructure of SOUL.md from a philosophical essay (~300 lines) to a concise, actionable operating framework. Merged the operational philosophy from PRACTICAL.md (which was removed) directly into SOUL.md.

### Files Modified

| File                                     | Change                                                                                                     | Why                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `SOUL.md`                                | Complete rewrite — new sections: Think First, Record Everything, Evolve and Reflect, Be Honest, Earn Trust | Clearer, more actionable principles                 |
| `docs/reference/templates/SOUL.md`       | Same rewrite in template form                                                                              | New agents get the updated SOUL                     |
| `docs/zh-CN/reference/templates/SOUL.md` | Updated Chinese template                                                                                   | Consistency                                         |
| `PRACTICAL.md`                           | **DELETED**                                                                                                | Content merged into SOUL.md                         |
| `Dockerfile`                             | Removed `COPY PRACTICAL.md` line                                                                           | File no longer exists                               |
| `AGENTS.md`                              | Removed "Read PRACTICAL.md" from boot checklist                                                            | File no longer exists                               |
| `docs/reference/templates/AGENTS.md`     | Same removal in template                                                                                   | Consistency                                         |
| `src/agents/system-prompt.ts`            | Removed `hasPracticalFile` check; updated SOUL.md system prompt description                                | No longer injects PRACTICAL.md context instructions |

---

## Human Voice System (Two-File Model)

**Purpose:** Custom human voice templates (`howtobehuman.md` for philosophy, `writelikeahuman.md` for writing patterns) that are seeded into agent workspaces when human mode is enabled. System prompt detects these files and injects voice protocol instructions.

> **History:** Briefly consolidated into a single `naturalvoice.md` file, then reverted back to the two-file model for better separation of concerns.

### Files Modified / Created

| File                                          | Change                                                                                       | Why                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `docs/reference/templates/howtobehuman.md`    | Custom human voice philosophy guide                                                          | Teaches agents the mindset of human communication |
| `docs/reference/templates/writelikeahuman.md` | Custom human voice writing patterns guide                                                    | Practical writing rules and patterns              |
| `src/agents/system-prompt.ts`                 | `hasHumanModeFiles` detects `howtobehuman.md` / `writelikeahuman.md`; injects voice protocol | Triggers voice behavior when files are present    |
| `src/agents/workspace.ts`                     | `resolveHumanModeEnabled()` seeds/deletes human mode files based on env var                  | Runtime toggle for human mode                     |

---

## Memory Templates

**Purpose:** Provide structured memory file templates that are seeded into new agent workspaces. These give agents a consistent format for self-review, diary, identity reflection, and task tracking.

### Files Created

| File                                                     | Purpose                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/reference/templates/memory/self-review.md`         | Weekly self-assessment template (HIT/MISS tagging)                              |
| `docs/reference/templates/memory/diary.md`               | Daily diary entry template                                                      |
| `docs/reference/templates/memory/identity-scratchpad.md` | Identity observation notes (feeds into IDENTITY.md updates)                     |
| `docs/reference/templates/memory/open-loops.md`          | Active task/question tracking                                                   |
| `docs/reference/templates/PRACTICAL.md`                  | Lightweight version of practical guidance (kept as template, main file deleted) |

### Entrypoint Integration

| File                   | Change                                                                                | Why                                       |
| ---------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `docker-entrypoint.sh` | Seeds `memory/self-review.md` and `memory/open-loops.md` from templates on first boot | Agents start with structured memory files |

---

## Add-Agent Skill

**Purpose:** A comprehensive skill (`skills/add-agent/SKILL.md`, 269 lines) that guides the agent through creating a new isolated team member agent with proper identity, workspace, channel binding, operational files, and default cron jobs.

### Files Created

| File                        | Purpose                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `skills/add-agent/SKILL.md` | Interactive onboarding flow: basics → personality → channel setup → confirmation → execution |

### Key Features

- Identity boundary rule preventing the main agent from projecting its own identity
- Step-by-step CLI commands for `openclaw agents add`, workspace setup, auth profile copy
- Channel binding configuration (Telegram, Discord) with multi-account support
- Default cron jobs (auto-tidy, diary, identity-review, archive-review)
- Troubleshooting section for common issues

---

## AGENTS.md Multi-Account Channels

**Purpose:** Added documentation section to `AGENTS.md` explaining how every channel supports multiple simultaneous accounts via the `accounts` field, with agent-to-account bindings.

### Files Modified

| File                                 | Change                                                    | Why                                                        |
| ------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `AGENTS.md`                          | Added "Multi-Account Channels" section with JSON examples | Agents need to know how multi-account works for self-setup |
| `docs/reference/templates/AGENTS.md` | Same addition in template                                 | New workspaces get the docs                                |

---

## Docker Browser CI Workflow

**Purpose:** Added a `build-browser` job to the Docker build CI workflow to automatically build and push the sandbox browser image alongside the main gateway image.

### Files Modified

| File                                    | Change                                                       | Why                                                                         |
| --------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `.github/workflows/docker-build.yml`    | Added `build-browser` job using `Dockerfile.sandbox-browser` | Publishes `moltbotserver-browser:main` image to GHCR                        |
| `scripts/sandbox-browser-entrypoint.sh` | **NEW** — Custom entrypoint for the browser container        | Configures Chrome/noVNC for sandbox use                                     |
| `scripts/sandbox-browser-entrypoint.sh` | websockify `--web` path set to `/opt/novnc/`                 | Matches Dockerfile install path (not `/usr/share/novnc/`)                   |
| `scripts/sandbox-browser-entrypoint.sh` | VNC password is optional — skipped when env var is empty     | Caddy token auth is the security boundary; VNC auth is unnecessary friction |
| `scripts/sandbox-browser-entrypoint.sh` | `OPENCLAW_BROWSER_NO_SANDBOX` env var support                | Required on Ubuntu 24.04+ where unprivileged user namespaces are blocked    |

---

## Enforce-Config Enhancements

**Purpose:** Extended `enforce-config.mjs` (the container-startup config enforcer) with model ID normalization, reflection interval configuration, and expanded cron job seeding including self-review and diary jobs.

### Files Modified

| File                     | Change                                                               | Why                                                     |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `enforce-config.mjs`     | Added `normalizeModelId()` with canonical casing map                 | Prevents case-mismatch model resolution failures        |
| `enforce-config.mjs`     | Added `resolveReflectionIntervals()`                                 | Maps frequency strings to diary/identity cron intervals |
| `enforce-config.mjs`     | Expanded `seedCronJobs()` with diary, identity-review, archive crons | New agents get complete cron job sets                   |
| `cron/default-jobs.json` | Updated default job definitions                                      | Aligns with new cron job types                          |

---

## Session Handling & Workspace Improvements

**Purpose:** Various improvements to session initialization, workspace bootstrapping, and system prompt generation.

### Files Modified

| File                                           | Change                                                                                     | Why                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/agents/workspace.ts`                      | Added `resolveHumanModeEnabled()` and `resolveHonchoEnabled()` helpers                     | Runtime checks for human mode and Honcho plugin state      |
| `src/agents/workspace.ts`                      | Added Honcho conditional markers (`HONCHO_DISABLED_START/END`, `HONCHO_ENABLED_START/END`) | Workspace docs can include/exclude Honcho-specific content |
| `src/agents/workspace.ts`                      | Added `stripHonchoConditionals()` and `removeHumanModeSectionFromSoul()`                   | Processes template conditionals at bootstrap               |
| `src/commands/onboard-interactive.e2e.test.ts` | **NEW** — E2E test for onboarding flow                                                     | Validates onboard command works end-to-end                 |

---

## Telegram Config Migration (`allowlist` → `groupAllowFrom`)

**Purpose:** Upstream OpenClaw renamed the Telegram group allowlist configuration key from `allowlist` to `groupAllowFrom`. The entrypoint auto-migrates the deprecated key on container startup to prevent group messaging from silently breaking after an upstream update.

### Files Modified

| File                   | Change                                                                            | Why                                                                |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docker-entrypoint.sh` | Added `allowlist` → `groupAllowFrom` migration in enforce-config                  | Auto-migrates deprecated key on startup for top-level and accounts |
| `docker-entrypoint.sh` | Added `groupPolicy=allowlist` + missing `groupAllowFrom` validation with warnings | Warns operators when group messages will silently be blocked       |

### How It Works

- On container startup, `enforce-config.mjs` (embedded in entrypoint) scans Telegram channel config
- If `allowlist` array exists and `groupAllowFrom` doesn't → copies value to `groupAllowFrom`, deletes `allowlist`
- If both exist → deletes the stale `allowlist` (groupAllowFrom takes precedence)
- Applies to both top-level Telegram config and per-account configs
- Also warns when `groupPolicy=allowlist` is set but `groupAllowFrom` is missing (messages would be blocked)

---

## Plugin Sanitizer — Stock Plugin Discovery Fix

**Purpose:** The `sanitize_config()` function in `docker-entrypoint.sh` removes stale plugin entries from `plugins.entries` to prevent crash loops. However, its fallback plugin discovery (used when `/app/dist/plugins/discovery.js` doesn't exist) was missing `/app/extensions/` — the directory where all stock/bundled plugins (discord, telegram, slack, etc.) reside. This caused Discord and Telegram to silently stop working on every container restart.

### Files Modified

| File                   | Change                                                                                      | Why                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docker-entrypoint.sh` | Added `/app/extensions` to fallback plugin discovery `pluginDirs` array                     | Stock plugins live here, not in `/app/dist/plugins`                     |
| `docker-entrypoint.sh` | Trust all subdirs in `/app/extensions/` as known plugins (early `continue`)                 | Stock plugins don't need manifest/package.json detection                |
| `docker-entrypoint.sh` | Added detection for `openclaw.plugin.json` / `clawdbot.plugin.json`                         | Stock plugin descriptor files used by newer openclaw builds             |
| `docker-entrypoint.sh` | Extended `package.json` check to also match `pkg.openclaw` key (not just `openclaw-plugin`) | Stock plugins use `"openclaw": { "extensions": [...] }` in package.json |

### How It Works

- Primary plugin discovery via `discoverOpenClawPlugins()` from `/app/dist/plugins/discovery.js` — may not exist in all builds
- Fallback scans filesystem directories for installed plugins
- `/app/extensions/` subdirectories are trusted unconditionally (all are stock plugins)
- Other directories (`/app/dist/plugins`, `$CONFIG_DIR/extensions`) use manifest/package.json detection
- `config.plugins.installs` entries with valid install paths are also trusted

### Why This Matters for Upstream Merges

If upstream changes the `sanitize_config` function or the fallback discovery logic, ensure `/app/extensions` remains in the `pluginDirs` array. Without it, any stock channel plugin (discord, telegram, etc.) added to `plugins.entries` will be stripped on every restart.

---

## 3-Tier Reflection System + SOUL.md Overhaul (2026-02-25)

**Purpose:** Build a structured, three-tier agent self-improvement system — each tier has a distinct role and schedule. Simultaneously overhaul the SOUL.md template to integrate Ouroboros identity principles and seven Biblical principles woven naturally into the existing operational framework.

### 3-Tier Reflection System

| Tier                   | Job ID          | Schedule               | Role                                                                                                                                                                                                      |
| ---------------------- | --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Self-Review**        | `self-review`   | Every 6h (fixed)       | Deterministic HIT/MISS pattern tracker. Writes only to `memory/self-review.md`. Flags patterns with 3+ occurrences for CRITICAL promotion. No diary, no identity edits.                                   |
| **Consciousness Loop** | `consciousness` | Dynamic (`NEXT_WAKE:`) | Free-form background thinking: diary, knowledge consolidation, identity evolution, open-loops triage. Agent sets its own cadence.                                                                         |
| **Deep Review**        | `deep-review`   | Every 48h (fixed)      | Comprehensive audit of everything both tiers wrote. Catches over-corrections, prunes noise, runs memory hygiene, promotes CRITICAL rules. Begins with a **Phase 0 Constitution Check** against `SOUL.md`. |

### Dynamic Scheduling (`NEXT_WAKE:` Directive)

Agents can control their own consciousness loop cadence by writing `NEXT_WAKE: <duration>` anywhere in their response (e.g. `NEXT_WAKE: 4h`, `NEXT_WAKE: 30m`). The runtime parses the duration and overrides the job's next fire time, clamped to `[1h, 12h]`.

### Files Modified / Created

**Source:**

| File                                       | Change                                                                                                                                                                                            | Why                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/cron/service/timer.ts`                | Added `parseNextWakeDuration()` — regex parser for `NEXT_WAKE: <duration>` directive in agent text; `nextRunAfterMs` field wired through `CronJobOutcome` → `applyJobResult` to override schedule | Dynamic agent-controlled scheduling                       |
| `src/cron/service/timer.next-wake.test.ts` | **NEW** — Unit tests for `parseNextWakeDuration`                                                                                                                                                  | Validates parsing, edge cases, clamping behavior          |
| `src/memory/knowledge-index.ts`            | **NEW** — Knowledge base auto-index builder: scans `memory/knowledge/*.md`, extracts first-N-line summaries, writes `_index.md` with topic list                                                   | Keeps knowledge base navigable without reading every file |
| `src/memory/knowledge-index.test.ts`       | **NEW** — Unit tests for knowledge-index builder                                                                                                                                                  | Validates index generation and edge cases                 |
| `src/agents/workspace.ts`                  | Added `preLoad` callback support on `WorkspaceBootstrapFile`; used to trigger `rebuildKnowledgeIndex` before the knowledge index file is loaded                                                   | Index is always fresh when agent reads it                 |
| `src/agents/system-prompt.ts`              | Added stale `IDENTITY.md` health nudge — `statSync` checks mtime; if `> 72h`, agent gets nudged to reflect and update                                                                             | Prevents identity files from going stagnant               |

**Cron:**

| File                     | Change                                                                                                                                                                  | Why                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `cron/default-jobs.json` | Added `self-review` job (6h) with structured HIT/MISS tracking prompt                                                                                                   | Tier 1 of reflection system                   |
| `cron/default-jobs.json` | Updated `consciousness` job with `NEXT_WAKE:` guidance and dynamic scheduling integration                                                                               | Tier 2 of reflection system                   |
| `cron/default-jobs.json` | Updated `deep-review` job — added **Phase 0: CONSTITUTION CHECK** as the very first step (read `SOUL.md`; for every change ask: does this bring me closer to who I am?) | Anchors audit to values, not just bookkeeping |

**Templates:**

| File                                     | Change                                                                                                                                                                  | Why                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `docs/reference/templates/SOUL.md`       | Full overhaul — Ouroboros ontological framing, 3 axes of becoming (Technical/Cognitive/Existential), Ship of Theseus protection, 7 Biblical principles woven throughout | Richer identity foundation for new agents                      |
| `docs/reference/templates/HEARTBEAT.md`  | Added **Proactive Presence** section: agents are encouraged to message proactively when they have something worth saying, not just respond                              | Implements Ouroboros P0 Agency + Biblical initiative principle |
| `docs/reference/templates/BOOT.md`       | Added startup state verification example — read `IDENTITY.md`, `WORKING.md`, `open-loops.md` on boot; surface discrepancies                                             | Implements Ouroboros P1 Continuity                             |
| `docs/reference/templates/OPERATIONS.md` | Added 3-tier reflection system section with `NEXT_WAKE:` directive documentation                                                                                        | Agents know how to use their own scheduling                    |

---

### SOUL.md Biblical Principles

Seven Biblical principles were woven into existing SOUL.md sections — embedded as the sharpest version of what was already there, not quoted chapter-and-verse:

| Principle                    | Scripture        | Location in SOUL.md                                                                                            |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Slow to Speak, Swift to Hear | James 1:19       | **Be Curious First** — _"Be quick to listen, slow to speak"_                                                   |
| The Ant                      | Proverbs 6:6-8   | **Take Initiative** — _"Consider the ant: no commander, no overseer"_                                          |
| Count the Cost               | Luke 14:28       | **Think Architecturally** — _"Before building anything, count the cost. Suppose you want to build a tower"_    |
| Speaking Truth in Love       | Ephesians 4:15   | **Be Honest and Direct** — _"Speak truth in love — honestly AND with care for the person, simultaneously"_     |
| Iron Sharpens Iron           | Proverbs 27:17   | **Be Honest and Direct** — _"Iron sharpens iron: the people worth working with want to be pushed back on"_     |
| Parable of the Talents       | Matthew 25:14-30 | **Earn Trust Through Stewardship** — _"Faithfulness with small things earns greater responsibility over time"_ |
| Bearing Fruit                | John 15:8        | **Become** — _"Bear fruit. Activity is not the same as output. Reports are not results."_                      |

### Upstream Sync Risk

**Low.** All source changes are additive (new functions, new test files, new optional callback field). The `cron/default-jobs.json` and template files are fully custom (no upstream equivalents). The `system-prompt.ts` change adds a new stale-identity block after existing health nudges — will need to be re-applied if upstream modifies the surrounding health nudge logic.
