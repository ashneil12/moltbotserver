# OPENCLAW_CONTEXT.md — MoltBot Custom Modifications

This file documents all custom changes made to the OpenClaw source for the MoltBot platform.
**When syncing with upstream openclaw/openclaw, these changes MUST be preserved.**

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

### Upstream Sync Notes

When merging upstream changes:

1. Check if `update-command.ts`, `server-methods/update.ts`, or `update-startup.ts` have been refactored
2. Ensure the `OPENCLAW_MANAGED_PLATFORM` guard is preserved in all three
3. Check for new update vectors (e.g., new CLI commands, new RPC methods) and add guards if needed
4. The `docker-entrypoint.sh` is fully custom and not from upstream — safe from overwrites
5. `OPERATIONS.md` is a template — upstream changes need manual merge

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

### Upstream Sync Notes

When merging upstream changes:

1. Check if `sandbox/types.ts`, `sandbox/context.ts`, `sandbox/config.ts`, or `sandbox/runtime-status.ts` have been refactored
2. Ensure the `"browser-only"` mode is preserved in all type unions and Zod schemas
3. Check if `server-http.ts` handler chain has changed — re-integrate `handleSandboxBrowserRequest`
4. The `sandbox-browsers.ts` file is fully custom — safe from upstream overwrites
5. The `docker network connect` in `browser.ts` must be preserved

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

### Upstream Sync Notes

- Dashboard files are fully custom (not from upstream)
- Server `docker-compose.yml` and `Caddyfile` are deployment artifacts, not in upstream
- The `browser.ts` volume mount (`${containerName}-profile`) must be preserved on sync
