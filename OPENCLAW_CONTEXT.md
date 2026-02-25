# OPENCLAW_CONTEXT.md — Upstream Sync Reference

Quick reference for preserving MoltBot customizations when merging from `upstream/main`.
For full change history and rationale, see `OPENCLAW_CHANGELOG.md`.

---

## Fully Custom Files (safe from upstream — no merge conflicts)

These files don't exist in upstream. They will never conflict but must not be deleted during sync.

| File / Directory                                   | Feature                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker-entrypoint.sh`                             | Managed platform guards, Sansa provider, memory template seeding, `allowlist`→`groupAllowFrom` migration, `groupPolicy` validation, stock plugin discovery fix, per-agent browser profile enforcement (`enforce_browser_profiles()`) |
| `enforce-config.mjs`                               | Model normalization, reflection intervals, cron job seeding                                                                                                                                                                          |
| `cron/default-jobs.json`                           | Default cron job definitions                                                                                                                                                                                                         |
| `src/gateway/sandbox-browsers.ts`                  | Sandbox browser API + noVNC proxy + per-agent static browser discovery from `config.browser.profiles`                                                                                                                                |
| `src/cron/pre-reset-flush.ts`                      | Pre-reset memory flush cron                                                                                                                                                                                                          |
| `src/cron/pre-reset-flush.test.ts`                 | Tests for above                                                                                                                                                                                                                      |
| `src/agents/models-config.providers.sansa.test.ts` | Sansa provider tests                                                                                                                                                                                                                 |
| `src/browser/chrome.test.ts`                       | Proxy support unit tests                                                                                                                                                                                                             |
| `src/commands/onboard-interactive.e2e.test.ts`     | Onboarding E2E test                                                                                                                                                                                                                  |
| `scripts/sandbox-browser-entrypoint.sh`            | Custom browser container entrypoint                                                                                                                                                                                                  |
| `Dockerfile.sandbox-browser`                       | Browser container Dockerfile                                                                                                                                                                                                         |
| `skills/add-agent/SKILL.md`                        | Agent creation skill                                                                                                                                                                                                                 |
| `docs/reference/templates/howtobehuman.md`         | Human voice philosophy template                                                                                                                                                                                                      |
| `docs/reference/templates/writelikeahuman.md`      | Human voice writing patterns template                                                                                                                                                                                                |
| `docs/reference/templates/memory/*`                | Memory file templates                                                                                                                                                                                                                |
| `src/memory/knowledge-index.ts`                    | Knowledge base auto-index builder — scans `memory/knowledge/*.md`, extracts summaries, writes `_index.md`                                                                                                                            |
| `src/memory/knowledge-index.test.ts`               | Tests for knowledge-index builder                                                                                                                                                                                                    |
| `src/cron/service/timer.next-wake.test.ts`         | Tests for `parseNextWakeDuration` (dynamic `NEXT_WAKE:` scheduling)                                                                                                                                                                  |

---

## Files With Custom Modifications (check on every sync)

These exist in upstream AND have local changes. Conflicts are likely.

### Source Files

| File                                      | What to preserve                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods/update.ts`    | `OPENCLAW_MANAGED_PLATFORM` guard at top of `update.run`                                                                                                                                                                     |
| `src/cli/update-cli/update-command.ts`    | `OPENCLAW_MANAGED_PLATFORM` guard at top of `updateCommand()`                                                                                                                                                                |
| `src/infra/update-startup.ts`             | Early return in `runGatewayUpdateCheck()` when managed platform                                                                                                                                                              |
| `src/agents/sandbox/types.ts`             | `"browser-only"` in `SandboxConfig.mode` union                                                                                                                                                                               |
| `src/agents/sandbox/runtime-status.ts`    | `browser-only` treated like `non-main`                                                                                                                                                                                       |
| `src/agents/sandbox/context.ts`           | `browser-only` skips container+workspace                                                                                                                                                                                     |
| `src/agents/sandbox/config.ts`            | Auto-enable browser for `browser-only` mode                                                                                                                                                                                  |
| `src/agents/sandbox/browser.ts`           | `docker network connect` + `${containerName}-profile` named volume                                                                                                                                                           |
| `src/config/types.agent-defaults.ts`      | `"browser-only"` in mode type                                                                                                                                                                                                |
| `src/config/types.agents.ts`              | `"browser-only"` in mode type                                                                                                                                                                                                |
| `src/config/zod-schema.agent-runtime.ts`  | `"browser-only"` in Zod schema                                                                                                                                                                                               |
| `src/gateway/control-ui.ts`               | Replaced synchronous `fs.readFileSync` with async `fs.createReadStream()` + pipeline for performance                                                                                                                         |
| `src/gateway/control-ui.test.ts`          | Await added to refactored async route handlers                                                                                                                                                                               |
| `src/gateway/control-ui.http.test.ts`     | Await added to refactored async route handlers                                                                                                                                                                               |
| `src/gateway/gateway-misc.test.ts`        | Await added to refactored async route handlers                                                                                                                                                                               |
| `src/gateway/server-http.ts`              | `handleSandboxBrowserRequest` integration; await added to async Control UI and Avatar requests                                                                                                                               |
| `src/agents/models-config.providers.ts`   | `buildSansaProvider()` + Sansa constants                                                                                                                                                                                     |
| `src/agents/model-auth.ts`                | `sansa: "SANSA_API_KEY"` in env key map                                                                                                                                                                                      |
| `src/gateway/server-cron.ts`              | `startPreResetFlushTimer` / `stopPreResetFlush` integration                                                                                                                                                                  |
| `src/gateway/server-reload-handlers.ts`   | `stopPreResetFlush()` call on cron restart                                                                                                                                                                                   |
| `src/config/sessions/types.ts`            | `preResetFlushAt?: number` field on `SessionEntry`                                                                                                                                                                           |
| `src/auto-reply/reply/session.ts`         | `preResetFlushAt = undefined` clear on init/reset                                                                                                                                                                            |
| `src/agents/system-prompt.ts`             | Removed `hasPracticalFile`; `howtobehuman.md`/`writelikeahuman.md` detection; updated voice prompt; stale `IDENTITY.md` health nudge (72h mtime check)                                                                       |
| `src/agents/workspace.ts`                 | `resolveHumanModeEnabled()`, `resolveHonchoEnabled()`, Honcho conditionals, `stripHonchoConditionals()`, `removeHumanModeSectionFromSoul()`; `preLoad` callback on `WorkspaceBootstrapFile` for `rebuildKnowledgeIndex` hook |
| `src/cron/service/timer.ts`               | `parseNextWakeDuration()` — parses `NEXT_WAKE: <duration>` directive from agent responses; dynamic schedule override in `applyJobResult`; `nextRunAfterMs` field forwarded through entire outcome chain                      |
| `src/browser/chrome.ts`                   | `resolveProxyServer()`, `generateProxyAuthExtension()`, proxy args in `launchChrome()`                                                                                                                                       |
| `src/discord/send.components.ts`          | Removed unused `APIChannel` type import (lint fix)                                                                                                                                                                           |
| `src/agents/tools/recall-message-tool.ts` | Removed redundant type assertion on `source` variable (lint fix)                                                                                                                                                             |

### Template & Doc Files

| File                                     | What to preserve                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOUL.md`                                | Complete rewrite (actionable framework, not philosophical essay)                                                                            |
| `AGENTS.md`                              | No "Read PRACTICAL.md" step; "Multi-Account Channels" section                                                                               |
| `OPERATIONS.md`                          | Heartbeat step 4 + System Updates section (no self-update); 3-tier reflection system description                                            |
| `Dockerfile`                             | No `COPY PRACTICAL.md` line                                                                                                                 |
| `docs/reference/templates/SOUL.md`       | Full rewrite — Ouroboros ontological framing, 3 axes of becoming, Ship of Theseus protection, 7 Biblical principles woven throughout        |
| `docs/reference/templates/AGENTS.md`     | No "Read PRACTICAL.md" step; "Multi-Account Channels" section                                                                               |
| `docs/reference/templates/HEARTBEAT.md`  | Proactive Presence section (agent-initiated outreach); updated self-reflection cadence                                                      |
| `docs/reference/templates/BOOT.md`       | Startup state verification example (read IDENTITY.md, WORKING.md, open-loops on boot)                                                       |
| `docs/reference/templates/OPERATIONS.md` | 3-tier reflection system (Self-Review/Consciousness Loop/Deep Review) + `NEXT_WAKE:` directive docs                                         |
| `docs/zh-CN/reference/templates/SOUL.md` | Custom rewrite (sync from EN version when updating)                                                                                         |
| `cron/default-jobs.json`                 | 3-tier reflection jobs: `self-review` (6h), `consciousness` (2h dynamic via `NEXT_WAKE:`), `deep-review` (48h + Phase 0 constitution check) |

### CI Workflows

| File                                         | What to preserve                                        |
| -------------------------------------------- | ------------------------------------------------------- |
| `.github/workflows/ci.yml`                   | `ubuntu-latest` / `windows-latest` (not `blacksmith-*`) |
| `.github/workflows/docker-release.yml`       | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/install-smoke.yml`        | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/workflow-sanity.yml`      | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/sandbox-common-smoke.yml` | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/labeler.yml`              | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/stale.yml`                | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/auto-response.yml`        | `ubuntu-latest` (not `blacksmith-*`)                    |
| `.github/workflows/docker-build.yml`         | Custom `build-browser` job                              |

---

## Post-Sync Checklist

1. **Blacksmith runners** — `grep -r "blacksmith" .github/workflows/` → replace with `ubuntu-latest` / `windows-latest`
2. **soul-evil** — `rm -rf src/hooks/bundled/soul-evil src/hooks/soul-evil.ts src/hooks/soul-evil.test.ts docs/hooks/soul-evil.md docs/zh-CN/hooks/soul-evil.md` → strip references from docs
3. **PRACTICAL.md** — if re-introduced by upstream, delete it and remove any references
4. **New update vectors** — check for new CLI commands or RPC methods that could trigger self-update; add `OPENCLAW_MANAGED_PLATFORM` guards
5. **Build verification** — `npm install && npm run build`
