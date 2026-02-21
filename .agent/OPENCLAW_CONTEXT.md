# OpenClaw Local Customizations

This document tracks customizations made to this fork compared to upstream `openclaw/openclaw`.

> [!IMPORTANT]
> Reference this file when updating from upstream to ensure these changes are preserved.

---

## Security Hardening

### Removed Features

- **SoulEvil persona**: Removed for safety/security reasons (upstream has also removed it as of v2026.2.17)

### Security Files

| File | Purpose |
|------|---------|
| `ACIP_SECURITY.md` | Full ACIP security rules, deployed as read-only to workspace |
| `scripts/security-audit.sh` | Comprehensive security audit script |
| `scripts/check-errors.sh` | Error checking utility |

### Security Measures

- **ACIP integration** — `docker-entrypoint.sh` fetches `Dicklesworthstone/acip` when `ACIP_ENABLED=true`
- **Trust-tiered security model** — SOUL.md + ACIP_SECURITY.md define layered security
- **Plugin Safety Protocol** — Mandatory backup of `$OPENCLAW_STATE_DIR/openclaw.json` before any plugin/skill install
- **Config path**: `$OPENCLAW_STATE_DIR/openclaw.json` (resolves to `/home/node/data/openclaw.json` inside container)
- **Gateway token security** — Brave search proxy, gateway auth hardening
- **Env var scrubbing** — `scrub_secrets()` in entrypoint redirects provider baseUrls through gateway

---

## SOUL / OPERATIONS Split

> **Date:** 2026-02-19

The original `SOUL.md` was split into two files:

| File | Purpose | Writability |
|------|---------|:-----------:|
| `SOUL.md` | Philosophical guidelines, identity, personality | Read-only |
| `OPERATIONS.md` | Operational rules, workflows, tool usage | Read-only |

### Related Changes

- `src/agents/workspace.ts` — Updated to load both SOUL.md and OPERATIONS.md
- `src/agents/system-prompt.ts` — Updated bootstrap blurbs for split files
- `src/agents/bootstrap-files.ts` — Subagent allowlist updated
- `docs/reference/templates/` — Updated template copies

---

## Bootstrap Files System

Custom markdown files deployed to agent workspace at startup:

| File | Purpose | Loaded In |
|------|---------|-----------|
| `SOUL.md` | Philosophy & identity | System prompt (main agent) |
| `OPERATIONS.md` | Operational rules | System prompt (main agent) |
| `AGENTS.md` | Sub-agent delegation rules | System prompt (main agent) |
| `HEARTBEAT.md` | Lean heartbeat with OTA check | System prompt (main agent) |
| `IDENTITY.md` | Writable self-evolution file | System prompt (main agent) |
| `WORKING.md` | Persistent task state template | System prompt (main agent) |
| `PRACTICAL.md` | Practical guidelines | System prompt (main agent) |
| `memory-hygiene.md` | Memory hygiene checks | System prompt (main agent) |
| `ACIP_SECURITY.md` | Full ACIP security rules | Subagent-only |
| `ralph-loops.md` | Ralph Loops pattern | Deployed, not in main prompt |
| `howtobehuman.md` | Human mode template | Deployed, optional |
| `writelikeahuman.md` | Human writing style | Deployed, optional |

### Source Files Modified

- `src/agents/workspace.ts` — Bootstrap file loading order, type definitions, conditional Honcho markers
- `src/agents/system-prompt.ts` — Instructional blurbs for each bootstrap file
- `src/agents/bootstrap-files.ts` — Subagent allowlist configuration
- `docker-entrypoint.sh` — Deploys files from `/app/` to workspace with template variable replacement + read-only perms

---

## Honcho Integration

> **Date:** 2026-02-17–19

Deep integration with Honcho memory plugin:

- **Additive design** — When Honcho is enabled, it supplements (not replaces) file-based memory
- **Conditional markers** — `HONCHO_DISABLED_START/END` and `HONCHO_ENABLED_START/END` in AGENTS.md and OPERATIONS.md
- `src/agents/workspace.ts` — Processes conditional markers based on Honcho plugin presence
- `docker-entrypoint.sh` — Honcho plugin installed at runtime (not build time) to avoid Docker layer issues

---

## Memory & Intelligence Features

### Memory Templates

| File | Purpose |
|------|---------|
| `templates/memory/diary.md` | Diary entries template |
| `templates/memory/identity-scratchpad.md` | Identity evolution scratchpad |
| `templates/memory/open-loops.md` | Open tasks/loops tracker |
| `templates/memory/self-review.md` | Self-review template |
| `templates/progress.md` | Progress tracking template |

### Memory Source Files

| File | Purpose |
|------|---------|
| `src/auto-reply/reply/commands-context-memory.ts` | Memory context for command replies |
| `src/agents/tools/recall-message-tool.ts` | Message recall tool |

### Config Enforcement

| File | Purpose |
|------|---------|
| `enforce-config.mjs` | CLI tool to enforce `openclaw.json` configuration at runtime |
| `moltbot.mjs` | MoltBot launcher script |
| `src/config/defaults.ts` | Modified defaults for memoryFlush, sessionMemory |

---

## Context Pruning

> **Date:** 2026-02-19

- `src/agents/pi-extensions/context-pruning/pruner.ts` — Modified for `cache-ttl` mode
- `src/config/defaults.ts` — Context pruning defaults (mode: `cache-ttl`, TTL: `6h`, preserve last 3 assistant responses)

---

## Cron Jobs

| File | Purpose |
|------|---------|
| `cron/default-jobs.json` | Default cron job definitions (memory hygiene check every 24h) |
| `src/cron/trigger-runner.ts` | Cron trigger execution runner |
| `skills/cron-trigger/SKILL.md` | Cron trigger skill documentation |
| `docker-entrypoint.sh` | Seeds cron jobs on container startup |

---

## Browser Sidecar

Custom visual browser sidecar for agent browsing:

| File | Purpose |
|------|---------|
| `Dockerfile.sandbox-browser` | Chromium + VNC + proxy Docker image |
| `scripts/sandbox-browser-entrypoint.sh` | Entrypoint for browser sidecar |
| `src/agents/sandbox/browser.ts` | Browser sandbox configuration |
| `src/browser/cdp.helpers.ts` | CDP helpers (static imports, `http.request` for Host header bypass) |
| `src/browser/chrome.ts` | Chrome launcher config |
| `src/browser/client-fetch.ts` | Browser client fetch |

### Key changes

- Chrome extensions and component updates re-enabled
- Chromium performance flags added
- noVNC UI and CDP reachability fixes
- `shm_size` configuration
- Xvfb lock cleanup
- noVNC static auth bypass

---

## Gateway & BYOK

| File | Purpose |
|------|---------|
| `src/gateway/control-ui.ts` | Control UI bypass for scoped connections |
| `src/gateway/net.ts` | Network configuration |
| `src/gateway/session-utils.ts` | Session utilities |
| `src/gateway/server-methods/agents.ts` | Agent server methods |
| `src/gateway/server/ws-connection/message-handler.ts` | WebSocket message handler |
| `src/agents/minimax-vlm.ts` | MiniMax VLM integration |
| `src/media-understanding/providers/image.ts` | Image provider for VLM |

### Key changes

- Gateway proxy for VLM removed (BYOK pivot)
- MiniMax baseUrl scrubbing through gateway
- Brave search proxy integration

---

## Docker & CI

### Docker

| File | What Changed |
|------|-------------|
| `Dockerfile` | Hardened container, baked-in camofox plugin, clawdhub CLI pre-installed, QMD global install, bootstrap file COPY commands |
| `docker-compose.coolify.yml` | Coolify deployment config (port 18789, env vars, volumes) |
| `docker-entrypoint.sh` | ACIP fetching, config generation, routing rules, cron seed, template deployment, log dir creation, gateway symlinks |

### CI

| File | What Changed |
|------|-------------|
| `.github/workflows/ci.yml` | Replaced defunct Blacksmith runners with GitHub-hosted |
| `.github/workflows/docker-release.yml` | Optimized for amd64-only (dropped arm64 QEMU) |
| `.github/workflows/docker-build.yml` | **NEW** — GHCR image push workflow |

---

## Skills & Plugins

| Directory/File | Purpose |
|---------|---------|
| `skills/clawdhub/SKILL.md` | Clawdhub CLI skill |
| `skills/cron-trigger/SKILL.md` | Cron trigger skill |
| `skills/local-places/` | Local places MCP server (Google Places integration) |
| `extensions/` | Plugin manifests for various platforms (Discord, Telegram, Slack, etc.) |

---

## Source Code Modifications

### Core Agent

| File | What Changed |
|------|-------------|
| `src/agents/system-prompt.ts` | Bootstrap file blurbs, runtime environment info |
| `src/agents/workspace.ts` | Bootstrap file loading, Honcho conditional markers, file ordering |
| `src/agents/cli-runner.ts` | CLI runner modifications |
| `src/agents/pi-embedded-helpers/bootstrap.ts` | Bootstrap helper changes |
| `src/agents/pi-embedded-runner/compact.ts` | Compaction event handling |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Run attempt modifications |
| `src/agents/pi-embedded-subscribe.handlers.messages.ts` | Message handler updates |
| `src/agents/pi-tools.ts` | Tool definitions |
| `src/agents/moltbot-tools.ts` | **NEW** — MoltBot-specific tools |
| `src/agents/tools/web-search.ts` | Web search markup improvements |

### Infrastructure

| File | What Changed |
|------|-------------|
| `src/entry.ts` | Entry point modifications |
| `src/infra/moltbot-root.ts` | **NEW** — MoltBot root infrastructure |
| `src/security/scheduler.ts` | **NEW** — Security scheduler |
| `src/context/index.ts` | **NEW** — Context module |
| `src/config/schema.field-metadata.ts` | **NEW** — Config field metadata |
| `src/config/types.clawdbot.ts` | **NEW** — ClawdBot config types |
| `src/config/types.feishu.ts` | **NEW** — Feishu config types |
| `src/daemon/legacy.ts` | **NEW** — Legacy daemon support |

### Feishu Plugin

| File | Purpose |
|------|---------|
| `src/feishu/*.ts` | **NEW** — Full Feishu (Lark) messaging integration (12 files: access, accounts, bot, client, config, domain, download, format, index, message, monitor, pairing-store, probe, send, streaming-card, types) |
| `extensions/feishu/README.md` | Feishu plugin documentation |

---

## Mobile Apps (Local Only)

> These are local scaffolds, not deployed via Docker.

| Directory | Purpose |
|-----------|---------|
| `apps/android/` | Android app (Kotlin) — MoltBot mobile client |
| `apps/shared/MoltbotKit/` | Shared Swift framework — iOS/macOS client (chat UI, gateway protocol, TTS, canvas, camera) |

---

## UI Customizations

| File | What Changed |
|------|-------------|
| `ui/src/ui/views/overview.ts` | Overview page modifications |
| `ui/src/styles/chat/sidebar.css` | Mobile sidebar styles |
| `ui/src/styles/layout.mobile.css` | Mobile layout styles |

---

## Miscellaneous Scripts & Files

| File | Purpose |
|------|---------|
| `scripts/check-open-loops.py` | Open loops checker |
| `scripts/format-staged.js` | Pre-commit formatting |
| `scripts/postinstall.js` | Post-install script |
| `scripts/setup-git-hooks.js` | Git hooks setup |
| `scripts/systemd/clawdbot-auth-monitor.*` | Auth monitor systemd service + timer |
| `docs/CREDIT_SYSTEM.md` | Credit system documentation |
| `docs/start/clawd.md` | Getting started guide |
| `docs/tools/clawdhub.md` | Clawdhub documentation |

---

## Critical Files (Do Not Overwrite)

Files that should always keep local version during updates:

| File | Reason |
|------|--------|
| `docker-compose.coolify.yml` | Coolify deployment configuration |
| `docker-entrypoint.sh` | Custom initialization logic (ACIP, config gen, cron seed, template deploy) |
| `Dockerfile` | Hardened container (camofox, clawdhub, QMD, bootstrap files) |
| `Dockerfile.sandbox-browser` | Custom browser sidecar |
| `SOUL.md` | MoltBot philosophical identity |
| `OPERATIONS.md` | MoltBot operational rules |
| `AGENTS.md` | Sub-agent delegation rules with Honcho conditionals |
| `ACIP_SECURITY.md` | Full ACIP security rules |
| `IDENTITY.md` | Writable self-evolution file |
| `WORKING.md` | Persistent task state template |
| `HEARTBEAT.md` | Lean heartbeat instructions with OTA check |
| `PRACTICAL.md` | Practical guidelines |
| `memory-hygiene.md` | Memory hygiene checks |
| `ralph-loops.md` | Ralph Loops pattern |
| `templates/` | Memory templates (self-review, open-loops, diary, identity-scratchpad, progress) |
| `scripts/check-open-loops.py` | Open loops checker |
| `scripts/security-audit.sh` | Security audit |
| `enforce-config.mjs` | Config enforcement CLI |
| `moltbot.mjs` | MoltBot launcher |
| `cron/default-jobs.json` | Default cron job definitions |
| `skills/` | Custom skills (clawdhub, cron-trigger, local-places) |
| `src/agents/moltbot-tools.ts` | MoltBot-specific tools |
| `src/infra/moltbot-root.ts` | MoltBot root infrastructure |
| `src/feishu/` | Feishu plugin (entire directory) |
| `.github/workflows/docker-build.yml` | GHCR push workflow |

---

## Safe to Update

Files that can generally take upstream version:

- `README.md`
- `CHANGELOG.md`
- Documentation in `docs/` (except our custom docs listed above)
- Dependencies in `package.json` (review carefully)
- Test files (upstream test improvements generally supersede ours)

---

## Orchestrator Pattern (Sub-Agent Delegation)

> **Date Added:** 2026-02-04
> **Status:** Config-only (no source code changes)

### Purpose

Enable the main agent to act as an orchestrator that delegates tasks to sub-agents using task-type-based model routing.

### Config Injected into `openclaw.json`

```json
"routing": {
  "rules": [
    { "match": { "taskType": "coding" }, "model": "codex/codex-1.5" },
    { "match": { "taskType": "search" }, "model": "google/gemini-2.5-flash" },
    { "match": { "taskType": "analysis" }, "model": "deepseek/deepseek-v3" },
    { "match": { "taskType": "default" }, "model": "kimi/k2.5" }
  ]
},
"subagent": {
  "useRouting": true,
  "defaultModel": "kimi/k2.5",
  "logToFile": true,
  "logPath": "subagent-logs/"
}
```

### ⚠️ Important Notes

1. **Config is aspirational**: The `routing` and `subagent` config keys are injected but **OpenClaw does not natively read them**.
2. **No source changes**: Sub-agent spawning uses explicit `model` parameter specified by the agent.
3. **Log directory**: Created at startup but file logging requires source modifications.

---

## Dashboard Customizations (Token Economy)

> **Location:** `/Users/ash/Documents/MoltBotServers/dashboard/`

These changes are in the **dashboard** repo, not the OpenClaw source. Documented here for completeness.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/constants/presets.ts` | Token Economy preset definitions (Cost-Saving, Power modes) |
| `src/lib/types/instance.ts` | ModelRoutingConfig with image support, HeartbeatInterval type |
| `src/lib/services/instance-env.ts` | Instance environment configuration |

### Preset Definitions

| Preset | Models | Cost Est |
|--------|--------|----------|
| Cost-Saving | Kimi K2.5, Minimax 2.1, DeepSeek V3, Gemini Flash, Haiku | ~$25-80/mo |
| Power | Claude Opus 4.5, Codex GPT 5.2, Haiku | ~$500-1000/mo |

---

## Update History

| Date | Upstream Commit | Notes |
|------|-----------------|-------|
| 2026-02-21 | `upstream/main` @ `ddcb2d79b` (v2026.2.21) | Merge 285 upstream commits. 20+ security fixes (command gating, sandbox browser, WhatsApp auth, compaction limits). New: Gemini 3.1, Volcengine/Byteplus provider, thread-bound Discord subagents. MiniMax M2.5 pricing fix. Massive dead-code cleanup (-82K lines). ACIP preserved. Soul-evil confirmed absent. |
| 2026-02-19 | `upstream/main` @ `87d833115` | Merge 1,074 upstream commits. Soul-evil already removed upstream. ACIP preserved. |
| 2026-02-19 | — | SOUL/OPERATIONS split, bootstrap files (PRACTICAL.md, memory-hygiene.md), context pruning (cache-ttl 6h), cron jobs (24h memory hygiene), Honcho additive mode |
| 2026-02-17 | — | Deep Honcho integration, SOUL.md overhaul, memory flush, compaction events |
| 2026-02-15 | — | Browser sidecar (Chromium+VNC), CDP fixes, gateway proxy, VLM integration |
| 2026-02-14 | — | Enforce-config CLI, web search markup, clawdhub CLI, Brave search proxy |
| 2026-02-13 | — | Plugin Safety Protocol, config path correction, context pruning, OTA protocol, Ralph Loops |
| 2026-02-12 | — | OTA update system, clean-slate context rebuild, soul-evil scorched earth |
| 2026-02-11 | — | Persistent storage fix, ACIP, QMD memory, model routing |
| 2026-02-04 | — | Token Economy dashboard, orchestrator pattern |
