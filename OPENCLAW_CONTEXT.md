# OPENCLAW_CONTEXT.md — Upstream Sync Reference

Quick reference for preserving MoltBot customizations when merging from `upstream/main`.
For full change history and rationale, see `OPENCLAW_CHANGELOG.md`.

---

## Fully Custom Files (safe from upstream — no merge conflicts)

These files don't exist in upstream. They will never conflict but must not be deleted during sync.

| File / Directory                                   | Feature                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `docker-entrypoint.sh`                             | Managed platform guards, Sansa provider, memory template seeding, `allowlist`→`groupAllowFrom` migration, `groupPolicy` validation |
| `enforce-config.mjs`                               | Model normalization, reflection intervals, cron job seeding                                                                        |
| `cron/default-jobs.json`                           | Default cron job definitions                                                                                                       |
| `src/gateway/sandbox-browsers.ts`                  | Sandbox browser API + noVNC proxy                                                                                                  |
| `src/cron/pre-reset-flush.ts`                      | Pre-reset memory flush cron                                                                                                        |
| `src/cron/pre-reset-flush.test.ts`                 | Tests for above                                                                                                                    |
| `src/agents/models-config.providers.sansa.test.ts` | Sansa provider tests                                                                                                               |
| `src/commands/onboard-interactive.e2e.test.ts`     | Onboarding E2E test                                                                                                                |
| `scripts/sandbox-browser-entrypoint.sh`            | Custom browser container entrypoint                                                                                                |
| `Dockerfile.sandbox-browser`                       | Browser container Dockerfile                                                                                                       |
| `skills/add-agent/SKILL.md`                        | Agent creation skill                                                                                                               |
| `docs/reference/templates/howtobehuman.md`         | Human voice philosophy template                                                                                                    |
| `docs/reference/templates/writelikeahuman.md`      | Human voice writing patterns template                                                                                              |
| `docs/reference/templates/memory/*`                | Memory file templates                                                                                                              |

---

## Files With Custom Modifications (check on every sync)

These exist in upstream AND have local changes. Conflicts are likely.

### Source Files

| File                                     | What to preserve                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods/update.ts`   | `OPENCLAW_MANAGED_PLATFORM` guard at top of `update.run`                                                                                    |
| `src/cli/update-cli/update-command.ts`   | `OPENCLAW_MANAGED_PLATFORM` guard at top of `updateCommand()`                                                                               |
| `src/infra/update-startup.ts`            | Early return in `runGatewayUpdateCheck()` when managed platform                                                                             |
| `src/agents/sandbox/types.ts`            | `"browser-only"` in `SandboxConfig.mode` union                                                                                              |
| `src/agents/sandbox/runtime-status.ts`   | `browser-only` treated like `non-main`                                                                                                      |
| `src/agents/sandbox/context.ts`          | `browser-only` skips container+workspace                                                                                                    |
| `src/agents/sandbox/config.ts`           | Auto-enable browser for `browser-only` mode                                                                                                 |
| `src/agents/sandbox/browser.ts`          | `docker network connect` + `${containerName}-profile` named volume                                                                          |
| `src/config/types.agent-defaults.ts`     | `"browser-only"` in mode type                                                                                                               |
| `src/config/types.agents.ts`             | `"browser-only"` in mode type                                                                                                               |
| `src/config/zod-schema.agent-runtime.ts` | `"browser-only"` in Zod schema                                                                                                              |
| `src/gateway/server-http.ts`             | `handleSandboxBrowserRequest` integration                                                                                                   |
| `src/agents/models-config.providers.ts`  | `buildSansaProvider()` + Sansa constants                                                                                                    |
| `src/agents/model-auth.ts`               | `sansa: "SANSA_API_KEY"` in env key map                                                                                                     |
| `src/gateway/server-cron.ts`             | `startPreResetFlushTimer` / `stopPreResetFlush` integration                                                                                 |
| `src/gateway/server-reload-handlers.ts`  | `stopPreResetFlush()` call on cron restart                                                                                                  |
| `src/config/sessions/types.ts`           | `preResetFlushAt?: number` field on `SessionEntry`                                                                                          |
| `src/auto-reply/reply/session.ts`        | `preResetFlushAt = undefined` clear on init/reset                                                                                           |
| `src/agents/system-prompt.ts`            | Removed `hasPracticalFile`; `howtobehuman.md`/`writelikeahuman.md` detection; updated voice prompt                                          |
| `src/agents/workspace.ts`                | `resolveHumanModeEnabled()`, `resolveHonchoEnabled()`, Honcho conditionals, `stripHonchoConditionals()`, `removeHumanModeSectionFromSoul()` |

### Template & Doc Files

| File                                     | What to preserve                                                 |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `SOUL.md`                                | Complete rewrite (actionable framework, not philosophical essay) |
| `AGENTS.md`                              | No "Read PRACTICAL.md" step; "Multi-Account Channels" section    |
| `OPERATIONS.md`                          | Heartbeat step 4 + System Updates section (no self-update)       |
| `Dockerfile`                             | No `COPY PRACTICAL.md` line                                      |
| `docs/reference/templates/SOUL.md`       | Custom rewrite                                                   |
| `docs/reference/templates/AGENTS.md`     | Same as above                                                    |
| `docs/zh-CN/reference/templates/SOUL.md` | Custom rewrite                                                   |

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
