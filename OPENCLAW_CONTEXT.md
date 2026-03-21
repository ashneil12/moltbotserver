# OPENCLAW_CONTEXT.md — Upstream Sync Reference

Quick reference for preserving MoltBot customizations when merging from `upstream/main`.
For full change history and rationale, see `OPENCLAW_CHANGELOG.md`.
For files with critical local patches that Node.js `fetch()` workarounds, see `LOCAL_PATCHES.md`.

---

## Fully Custom Files (safe from upstream — no merge conflicts)

These files don't exist in upstream. They will never conflict but must not be deleted during sync.

### Core Infrastructure

| File / Directory                  | Feature                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-entrypoint.sh`            | Managed platform guards, Sansa provider, memory template seeding, `allowlist`→`groupAllowFrom` migration, `groupPolicy` validation, stock plugin fix, `root:root` re-chown, device pairing auto-approve, QMD pre-warm, **QMD Gemini embedding patch** (calls `patch-qmd-gemini.sh`), workspace-doc-converter sidecar, backup restore before enforce-config                                                        |
| `enforce-config.mjs`              | Multi-agent `team/` symlinking, Model normalization, 4-tier reflection patching, cron job seeding (`MAIN_ONLY_JOBS`), tool loop detection, `tools.profile = "full"` enforcement, per-agent browser profiles/containers, `browser` in `alsoAllow`, LCM version-aware enforcement, skill-evolution cron, cron schedule redesign (interval→fixed cron), `MAIN_ONLY_JOBS` expansion, **QMD vsearch mode enforcement** |
| `enforce-config-helpers.mjs`      | Shared utilities: `readConfig`, `writeConfig`, `ensure`, `makeId`, `env`, `isTruthy`, `repairConfig` (3-stage), `backupConfig` (3-slot rotation), `resolveReflectionIntervals`                                                                                                                                                                                                                                    |
| `enforce-config-models.mjs`       | `normalizeModelId()` + `CANONICAL_MODEL_IDS` map                                                                                                                                                                                                                                                                                                                                                                  |
| `enforce-config-helpers.test.mjs` | 34 tests for extracted helpers                                                                                                                                                                                                                                                                                                                                                                                    |
| `enforce-config-models.test.mjs`  | 12 tests for model normalization                                                                                                                                                                                                                                                                                                                                                                                  |
| `enforce-config-memory.test.mjs`  | 19 tests for memory/QMD config enforcement (searchMode, limits, hybrid weights, business mode, builtin fallback, idempotency)                                                                                                                                                                                                                                                                                     |
| `safe-config-edit.test.mjs`       | 23 black-box CLI tests                                                                                                                                                                                                                                                                                                                                                                                            |
| `cron/default-jobs.json`          | Default cron jobs — reflection tiers, memory extraction, workspace-doc-converter. Source of truth for cron payloads                                                                                                                                                                                                                                                                                               |

### Browser & Sandbox

| File                                         | Feature                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/gateway/sandbox-browsers.ts`            | Sandbox browser API + noVNC proxy + per-agent static browser discovery + `isSensitiveBrowserPath()` auth gating |
| `scripts/sandbox-browser-entrypoint.sh`      | Custom browser entrypoint — `OPENCLAW_BROWSER_NOVNC_NO_AUTH`, CDP host proxy                                    |
| `scripts/cdp-host-proxy.py`                  | Python HTTP+WS reverse proxy for CDP — rewrites Host header for Chromium 107+ Docker compat                     |
| `Dockerfile.sandbox-browser`                 | Browser container Dockerfile                                                                                    |
| `src/agents/sandbox/browser-sweep.ts`        | Browser startup sweep — pulls latest image, recreates stale containers                                          |
| `src/agents/sandbox/browser-sweep.test.ts`   | 12 tests                                                                                                        |
| `src/browser/stealth-scripts.ts`             | 8 Playwright stealth evasion scripts                                                                            |
| `src/browser/download-workspace-registry.ts` | Per-CDP-URL workspace mapping + `sanitizeAutoDownloadFilename()`                                                |

### Memory & Search

| File                                                              | Feature                                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/memory-unified/index.ts`                              | Unified Memory Plugin — replaces memory-core. Auto-recall, alignment drift scoring, configurable via `autoRecall`/`alignmentCheck`/etc |
| `src/memory/alignment-state.ts`                                   | Alignment state tracker — per-session cooldown + mild-drift escalation                                                                 |
| `src/memory/alignment-scorer.ts`                                  | Alignment drift scorer — structured JSON evaluation via LLM                                                                            |
| `src/memory/alignment-state.test.ts` + `alignment-scorer.test.ts` | 43 tests                                                                                                                               |
| `src/memory/source-boost.ts`                                      | Source-aware ranking — 1.15× boost for agent knowledge files                                                                           |
| `src/memory/source-boost.test.ts`                                 | 26 tests                                                                                                                               |
| `src/memory/knowledge-index.ts`                                   | Knowledge base auto-index builder                                                                                                      |
| `src/memory/knowledge-index.test.ts`                              | Tests                                                                                                                                  |
| `src/memory/memory-file-rotator.ts`                               | Consolidates old daily memory files into monthly archives                                                                              |
| `src/memory/memory-file-rotator.test.ts`                          | 15 tests                                                                                                                               |
| `src/memory/memory-staleness-scanner.ts`                          | Detects dated entries older than threshold (default 90 days)                                                                           |
| `src/memory/memory-staleness-scanner.test.ts`                     | 12 tests                                                                                                                               |
| `src/auto-reply/reply/session-search.ts`                          | SQLite FTS5 session search index with hotness scoring                                                                                  |
| `src/auto-reply/reply/session-search.test.ts`                     | 13 tests                                                                                                                               |
| `src/auto-reply/reply/session-context-summary.ts`                 | Session context carryover — rolling `memory/session-context.md`                                                                        |
| `src/auto-reply/reply/session-context-summary.test.ts`            | 11 tests                                                                                                                               |
| `src/auto-reply/reply/trajectory-compressor.ts`                   | Trajectory compression for session context                                                                                             |
| `src/auto-reply/reply/trajectory-compressor.test.ts`              | 18 tests                                                                                                                               |
| `src/auto-reply/reply/noise-patterns.ts`                          | Shared noise-filtering primitives (17 cron patterns)                                                                                   |
| `src/auto-reply/reply/noise-patterns.test.ts`                     | 41 tests                                                                                                                               |
| `src/auto-reply/reply/tool-stats.ts`                              | Per-tool usage statistics in shared `sessions.db`                                                                                      |
| `src/auto-reply/reply/tool-stats.test.ts`                         | 10 tests                                                                                                                               |

### Security

| File                                       | Feature                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/security/content-scanner.ts`          | Two-stage content scanner (regex + optional model). 48 tests                               |
| `src/security/content-scanner.test.ts`     | Tests                                                                                      |
| `src/security/data-classification.ts`      | Three-tier data classification + PII detection + AgentGuard secret redaction (14 patterns) |
| `src/security/data-classification.test.ts` | 47 tests                                                                                   |
| `src/security/scan-and-log.ts`             | Shared `scanAndLog()` helper                                                               |
| `src/security/scan-and-log.test.ts`        | 10 tests                                                                                   |
| `src/security/security-event-journal.ts`   | AgentGuard security event journal — append-only JSONL                                      |
| `src/logging/event-log.ts`                 | Structured JSONL event logger with PII redaction + rotation. 30 tests                      |
| `src/logging/event-log.test.ts`            | Tests                                                                                      |
| `src/logging/diagnostics-toolkit.ts`       | System health checks. 21 tests                                                             |
| `src/logging/diagnostics-toolkit.test.ts`  | Tests                                                                                      |
| `src/logging/disk-hygiene.ts`              | Disk scanner + cleaner (sessions, browser cache, logs, media). 10 tests                    |
| `src/logging/disk-hygiene.test.ts`         | Tests                                                                                      |
| `skills/prompt-guard/SKILL.md`             | Prompt injection detection skill                                                           |
| `skills/clawscan/SKILL.md`                 | Security scanning skill                                                                    |

### Health & Resilience

| File                                                 | Feature                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `src/logging/health-sentinel.ts`                     | Two-tier self-healing orchestrator. 12 tests              |
| `src/logging/health-sentinel-types.ts`               | Shared types                                              |
| `src/logging/health-sentinel-playbooks.ts`           | `channel-restart` + `disk-cleanup` playbooks              |
| `src/logging/health-sentinel-history.ts`             | JSONL history with trends                                 |
| `src/logging/health-sentinel-incidents.ts`           | Incident writer, inbox, TTL cleanup                       |
| `src/logging/health-sentinel.test.ts`                | Tests                                                     |
| `src/logging/health-sentinel-phase2.test.ts`         | 28 tests                                                  |
| `src/logging/health-sentinel-phase3.test.ts`         | 19 tests                                                  |
| `src/logging/health-sentinel-sidecars.test.ts`       | 7 tests                                                   |
| `src/auto-reply/reply/session-health.ts`             | Session Health Sentinel — circuit breaker                 |
| `src/auto-reply/reply/session-health-integration.ts` | Session Health integration bridge                         |
| `src/auto-reply/reply/session-health.test.ts`        | 18 tests                                                  |
| `src/auto-reply/reply/session-freshness.ts`          | Stale Snapshot Guard — validates workspace freshness      |
| `src/auto-reply/reply/session-freshness.test.ts`     | 8 tests                                                   |
| `src/infra/ephemeral-path.ts`                        | Ephemeral path detection (`/tmp`, `tmpfs`, etc). 15 tests |
| `src/infra/ephemeral-path.test.ts`                   | Tests                                                     |
| `src/infra/atomic-file.ts`                           | Shared crash-safe file utilities. 10 tests                |
| `src/infra/atomic-file.test.ts`                      | Tests                                                     |

### Cron & Self-Healing

| File                                      | Feature                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/cron/idle-gate.ts`                   | Idle-aware cron scheduling. 17 tests                                                                                |
| `src/cron/idle-gate.test.ts`              | Tests                                                                                                               |
| `src/cron/cron-health-probes.ts`          | 4 deterministic probes for scheduler health. 21 tests                                                               |
| `src/cron/cron-health-probes.test.ts`     | Tests                                                                                                               |
| `src/cron/proactive-disk-hygiene.ts`      | Self-throttled disk sweep wrapper. 14 tests                                                                         |
| `src/cron/proactive-disk-hygiene.test.ts` | Tests                                                                                                               |
| `src/cron/pre-reset-flush.ts`             | Pre-reset memory flush cron                                                                                         |
| `src/cron/pre-reset-flush.test.ts`        | Tests                                                                                                               |
| `src/cron/remediation-journal.ts`         | Append-only JSONL log for automated fixes. 23 tests                                                                 |
| `src/cron/remediation-journal.test.ts`    | Tests                                                                                                               |
| `src/cron/remediation-watchdog.ts`        | Timer-tick watchdog — confirms/rollbacks/escalates. 7 tests                                                         |
| `src/cron/remediation-watchdog.test.ts`   | Tests                                                                                                               |
| `src/cron/health-check-seed.ts`           | Auto-seeds `__system_health_check` cron job. 8 tests                                                                |
| `src/cron/health-check-seed.test.ts`      | Tests                                                                                                               |
| `src/cron/auto-heal-journal.ts`           | Auto-heal audit trail — JSONL log, scope enforcement (leaf/trunk nodes), `BACKGROUND_FIXES.md` generation. 17 tests |
| `src/cron/auto-heal-journal.test.ts`      | Tests                                                                                                               |
| `src/cron/pre-idle-flush.ts`              | Pre-idle memory flush sweep — `isHumanSession()` gate, idle eligibility, background timer. 28 tests                 |
| `src/cron/pre-idle-flush.test.ts`         | Tests                                                                                                               |
| `src/cron/session-flush-global.ts`        | Global flush callback singleton — bridges session.ts ↔ server-cron.ts for `/new`/`/reset` memory flush. 5 tests     |
| `src/cron/session-flush-global.test.ts`   | Tests                                                                                                               |
| `src/cron/flush-prompt.ts`                | Shared `buildFlushPrompt(header)` — centralizes memory flush instructions used by pre-reset, pre-idle, and /reset   |
| `src/logging/error-journal.ts`            | Error journal for auto-heal pipeline — deduplication, severity classification, atomic writes. 15 tests              |
| `src/logging/error-journal.test.ts`       | Tests                                                                                                               |

### Agent Tools

| File                                                    | Feature                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/agents/tools/cron-heal-tool.ts`                    | `cron_heal` — 7 actions: diagnose, re-enable, adjust-schedule, force-run, cleanup-disk, rollback, journal              |
| `src/agents/tools/sql-tool.ts`                          | `sql_query` + `sql_execute`. 22 tests                                                                                  |
| `src/agents/tools/sql-tool.test.ts`                     | Tests                                                                                                                  |
| `src/agents/tools/session-search-tool.ts`               | `session_search` — FTS5 search with query rewriting                                                                    |
| `src/agents/tools/session-search-tool.test.ts`          | 14 tests                                                                                                               |
| `src/agents/tools/skill-manage-tool.ts`                 | `skill_manage` — agent skill CRUD. 15 tests                                                                            |
| `src/agents/tools/skill-manage-tool.test.ts`            | Tests                                                                                                                  |
| `src/agents/tools/skill-view-tool.ts`                   | `skill_view` — progressive disclosure                                                                                  |
| `src/agents/tools/workspace-search-tool.ts`             | `workspace_search` — QMD workspace-only search                                                                         |
| `src/agents/tools/skill-generation.ts`                  | Skill generation versioning. 15 tests                                                                                  |
| `src/agents/tools/skill-generation.test.ts`             | Tests                                                                                                                  |
| `src/auto-reply/reply/session-skill-candidates.ts`      | Per-session skill candidate extraction. 11 tests                                                                       |
| `src/auto-reply/reply/session-skill-candidates.test.ts` | Tests                                                                                                                  |
| `src/agents/tools/auto-heal-tool.ts`                    | `auto_heal` — 5 actions: diagnose, attempt-fix, rollback, journal, status. 3-strike limit, scope enforcement. 21 tests |
| `src/agents/tools/auto-heal-tool.test.ts`               | Tests                                                                                                                  |
| `src/agents/tools/auto-heal-escalation.ts`              | Translates auto-heal failures to plain-English messages with fix-first options. 15 tests                               |
| `src/agents/tools/auto-heal-escalation.test.ts`         | Tests                                                                                                                  |

### Templates, Docs & Scripts

| File                                                 | Feature                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/reference/templates/openclaw-human-v1.md`      | Consolidated human voice guide                                               |
| `docs/reference/templates/THE_ART_OF_BEING_FUNNY.md` | Humor training guide                                                         |
| `docs/reference/templates/memory/*`                  | Memory file templates                                                        |
| `docs/reference/templates/MEMORY.md`                 | Top-level MEMORY.md template                                                 |
| `docs/reference/templates/TOOLS.md`                  | Pre-installed CLI Tools reference                                            |
| `memory-hygiene.md`                                  | Memory hygiene documentation                                                 |
| `LOCAL_PATCHES.md`                                   | Critical local patches reference                                             |
| `skills/add-agent/SKILL.md`                          | Agent creation skill                                                         |
| `scripts/backup-upload.sh`                           | Full backup lifecycle (retry, upload, DB insert, notify)                     |
| `scripts/restore-from-backup.sh`                     | Restore from Supabase Storage (integrity verify, path mapping, sanitization) |
| `scripts/workspace-doc-converter.sh`                 | Background sidecar — converts .pdf/.txt/.docx/.csv to .md                    |
| `scripts/patch-qmd-gemini.sh`                        | Runtime QMD patch — replaces local llama.cpp embeddings with Gemini API      |
| `Dockerfile.scrapling`                               | Scrapling HTTP microservice container                                        |
| `scripts/scrapling-server.py`                        | FastAPI wrapper for Scrapling                                                |
| `searxng/settings.yml`                               | SearXNG configuration                                                        |

### Dashboard & Skills

| File                                                                                          | Feature                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260311100000_create_openclaw_backups.sql`                              | Backup tables + RLS + storage bucket                                                                                |
| `src/app/api/instances/[id]/openclaw-backups/`                                                | Backup API routes (upload, list, delete, download, import, restore, config)                                         |
| `src/app/api/instances/[id]/workflows/route.ts`                                               | Workflow management API (GET list, PATCH toggle)                                                                    |
| `src/lib/services/clawflows.ts`                                                               | ClawFlows v2 service — catalog metadata + cron ID logic + `cloud-init` generator                                    |
| `src/app/dashboard/instances/components/WorkflowsTab.tsx`                                     | Unified workflow library UI with agent scoping                                                                      |
| `src/app/api/instances/[id]/alert/route.ts`                                                   | Container → dashboard alert endpoint                                                                                |
| `src/app/api/cron/cleanup-backups/route.ts`                                                   | Paginated expired-backup purge                                                                                      |
| `src/config/config.web-search-provider.test.ts`                                               | SearXNG provider tests (9 total)                                                                                    |
| `src/agents/models-config.providers.sansa.test.ts`                                            | Sansa provider tests                                                                                                |
| `src/browser/chrome.test.ts`                                                                  | Proxy support tests                                                                                                 |
| `src/commands/onboard-interactive.e2e.test.ts`                                                | Onboarding E2E test                                                                                                 |
| `src/auto-reply/reply/typing.test.ts`                                                         | Typing TTL callback tests                                                                                           |
| `src/infra/heartbeat-runner.returns-default-unset.test.ts`                                    | Heartbeat default interval test                                                                                     |
| `scripts/add-cron.mjs`                                                                        | **NEW** — Deterministic cron management (validates, deduplicates, auto-resolves delivery via `--auto-to`)           |
| `scripts/provision-agent.sh`                                                                  | **NEW** — Deterministic agent creation (workspaces, skills, auth, `team/` symlinking)                               |
| `.agents/skills/`                                                                             | **Progressive Disclosure**: 38 skills restructured into thin orchestrators + `instructions/` sub-files.             |
| `.agents/skills/{marketing-psychology,copywriting,social-content,product-marketing-context}/` | Tier 1 (always-on) marketing skills                                                                                 |
| `.agents/skills/{29 business-gated skills}/`                                                  | Tier 2 (business-gated) marketing skills                                                                            |
| `.agents/skills/marketing-tools-registry/`                                                    | 51 zero-dependency Node.js CLI wrappers                                                                             |
| `skills/{pdf,docx,pptx,xlsx,doc-coauthoring}/`                                                | Anthropic document/office skills ([source](https://github.com/anthropics/skills))                                   |
| `skills/frontend-design/`                                                                     | Production-grade UI design methodology ([source](https://github.com/anthropics/skills))                             |
| `skills/{seo-audit-claude,seo-competitor-pages,seo-content,seo-geo,seo-hreflang,seo-images}/` | Claude SEO sub-skills ([source](https://github.com/AgriciDaniel/claude-seo))                                        |
| `skills/{seo-page,seo-plan,seo-programmatic-claude,seo-schema,seo-sitemap,seo-technical}/`    | Claude SEO sub-skills (continued)                                                                                   |
| `skills/{context-compression,context-optimization,hosted-agents}/`                            | Context engineering cherry-picks ([source](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering)) |

### Control UI

| File                               | Feature                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `ui/src/styles/components.css`     | `.exec-approval-command` height cap + overflow scroll |
| `ui/src/ui/views/exec-approval.ts` | Exec approval modal                                   |

---

## Files With Custom Modifications (check on every sync)

These exist in upstream AND have local changes. Conflicts are likely.

### Source Files

| File                                                         | What to preserve                                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods/update.ts`                       | `OPENCLAW_MANAGED_PLATFORM` guard                                                                                                                                                                           |
| `src/cli/update-cli/update-command.ts`                       | `OPENCLAW_MANAGED_PLATFORM` guard                                                                                                                                                                           |
| `src/infra/update-startup.ts`                                | Early return when managed platform                                                                                                                                                                          |
| `src/agents/sandbox/types.ts`                                | `"browser-only"` in `SandboxConfig.mode` union                                                                                                                                                              |
| `src/agents/sandbox/runtime-status.ts`                       | `browser-only` treated like `non-main`                                                                                                                                                                      |
| `src/agents/sandbox/context.ts`                              | `browser-only` skips container+workspace                                                                                                                                                                    |
| `src/agents/sandbox/config.ts`                               | Auto-enable browser for `browser-only` mode                                                                                                                                                                 |
| `src/agents/sandbox/browser.ts`                              | `docker network connect` + named volume                                                                                                                                                                     |
| `src/agents/sandbox/docker.ts`                               | `readDockerImageId()` + `readDockerContainerImageId()` for browser sweep                                                                                                                                    |
| `src/gateway/server-startup.ts`                              | Fire-and-forget `sweepStaleBrowserContainers()`                                                                                                                                                             |
| `src/config/types.agent-defaults.ts`                         | `"browser-only"` in mode type; heartbeat `1h`                                                                                                                                                               |
| `src/config/types.agents.ts`                                 | `"browser-only"` in mode type                                                                                                                                                                               |
| `src/config/zod-schema.agent-runtime.ts`                     | `"browser-only"` + `searxng` provider + `scrapling` config block                                                                                                                                            |
| `src/gateway/control-ui.ts`                                  | Async `createReadStream()` instead of sync `readFileSync`                                                                                                                                                   |
| `src/gateway/control-ui.test.ts`                             | Await for async handlers                                                                                                                                                                                    |
| `src/gateway/control-ui.http.test.ts`                        | Await for async handlers                                                                                                                                                                                    |
| `src/gateway/gateway-misc.test.ts`                           | Await for async handlers                                                                                                                                                                                    |
| `src/gateway/server-http.ts`                                 | `handleSandboxBrowserRequest` + `handleSandboxBrowserUpgrade` integration                                                                                                                                   |
| `src/agents/openclaw-tools.ts`                               | `agentId` for browser tool, `sql_query`/`sql_execute`/`session_search`/`skill_manage`/`skill_view`/`cron_heal` registration                                                                                 |
| `src/agents/models-config.providers.ts`                      | `buildSansaProvider()` + Sansa constants                                                                                                                                                                    |
| `src/agents/model-auth.ts`                                   | `sansa: "SANSA_API_KEY"`                                                                                                                                                                                    |
| `src/gateway/server-cron.ts`                                 | `startPreResetFlushTimer`/`startDiaryArchiveTimer`/`startPreIdleFlushTimer` integration + `SessionFlushCallback` registration for `/new`/`/reset` memory flush                                              |
| `src/gateway/server-reload-handlers.ts`                      | `stopPreResetFlush()` on cron restart                                                                                                                                                                       |
| `src/config/sessions/types.ts`                               | `preResetFlushAt`, `createdAt`, `healthState` fields                                                                                                                                                        |
| `src/agents/failover-error.ts`                               | `FailoverFixability` type + `resolveFixability()`                                                                                                                                                           |
| `src/lib/services/instance-env.ts`                           | Removal of `CLAWFLOWS_ENABLED` (dashboard side)                                                                                                                                                             |
| `src/agents/pi-embedded-helpers/types.ts`                    | `FailoverFixability` type                                                                                                                                                                                   |
| `src/agents/pi-embedded-helpers.ts`                          | Re-exported `FailoverFixability`                                                                                                                                                                            |
| `src/auto-reply/reply/agent-runner.ts`                       | Session Health Sentinel wiring (`onRunSuccess`/`onRunError`)                                                                                                                                                |
| `src/config/sessions/store.ts`                               | `createdAt`-based dedup preference + `createdAt` stamp on new entries                                                                                                                                       |
| `src/config/sessions/paths.ts`                               | `warnIfEphemeral()` in `resolveStorePath()`                                                                                                                                                                 |
| `src/commands/doctor-state-integrity.ts`                     | Ephemeral path CRITICAL warnings                                                                                                                                                                            |
| `src/auto-reply/reply/session-updates.ts`                    | `validateSessionPathFreshness()` → `shouldForceRefresh`                                                                                                                                                     |
| `src/auto-reply/reply/commands-system-prompt.ts`             | Workspace existence check before skill snapshot                                                                                                                                                             |
| `src/auto-reply/reply/session.ts`                            | `preResetFlushAt` clear, `persistSessionContextOnReset()`, `indexTranscriptForSearch()`, fire-and-forget `requestSessionFlush()` on `/new`/`/reset`                                                         |
| `src/agents/system-prompt.ts`                                | Human voice, humor training, stale IDENTITY.md nudge, tool additions (session_search, skill_manage, cron_heal, workspace_search), Autonomous Problem-Solving, Scrapling guidance, personality/voice section |
| `src/agents/workspace.ts`                                    | `resolveHumanModeEnabled()`, humor guide seeding, `preLoad` callback, `MEMORY.md` seeding, workspace context security scanning, `.agents/skills/` auto-creation                                             |
| `src/cron/service/timer.ts`                                  | `parseNextWakeDuration()`, idle gate, proactive disk hygiene, remediation watchdog                                                                                                                          |
| `src/cron/isolated-agent/run.ts`                             | Content scanning + cron outcome event logging                                                                                                                                                               |
| `src/agents/tools/web-fetch.ts`                              | Scrapling stealth fallback + content scanning                                                                                                                                                               |
| `src/agents/tools/browser-tool.ts`                           | Content scanning via `scanAndLog()`                                                                                                                                                                         |
| `src/logging/diagnostic.ts`                                  | Periodic health check + Health Sentinel integration                                                                                                                                                         |
| `src/browser/chrome.ts`                                      | Proxy support + CDP Host header fix in `fetchChromeVersion`                                                                                                                                                 |
| `src/browser/cdp.helpers.ts`                                 | **⚠️ CDP Host header fix**: `httpRequestWithHostOverride()` — Node.js `fetch()` silently ignores Host header                                                                                                |
| `src/browser/server-context.ts`                              | `Promise.all` parallel profile listing                                                                                                                                                                      |
| `src/browser/client.ts`                                      | `timeoutMs: 5000` (up from 3000)                                                                                                                                                                            |
| `src/browser/pw-session.ts`                                  | `fetchJson` for Host header compat + stealth scripts                                                                                                                                                        |
| `src/browser/pw-tools-core.interactions.ts`                  | Auto-download capture on click                                                                                                                                                                              |
| `src/browser/pw-tools-core.downloads.ts`                     | Shared `sanitizeAutoDownloadFilename()`                                                                                                                                                                     |
| `src/browser/control-service.ts`                             | Per-profile workspace registration for auto-downloads                                                                                                                                                       |
| `src/browser/extension-relay.ts`                             | Explicit type annotation                                                                                                                                                                                    |
| `src/auto-reply/dispatch.ts`                                 | `onTtlExpired` forwarding                                                                                                                                                                                   |
| `src/auto-reply/reply/get-reply.ts`                          | `onTtlExpired` into typing controller                                                                                                                                                                       |
| `src/auto-reply/reply/reply-dispatcher.ts`                   | `onTtlExpired` option + "⏳ Still thinking" message                                                                                                                                                         |
| `src/auto-reply/reply/typing.ts`                             | `onTtlExpired` callback                                                                                                                                                                                     |
| `src/auto-reply/types.ts`                                    | `onTtlExpired` field                                                                                                                                                                                        |
| `src/auto-reply/heartbeat.ts`                                | `DEFAULT_HEARTBEAT_EVERY` → `"1h"`                                                                                                                                                                          |
| `src/agents/auth-profiles/oauth.ts`                          | Per-agent OAuth isolation (removed main-agent fallback)                                                                                                                                                     |
| `src/cli/program/register.onboard.ts`                        | `--agent` and `--sync-all` CLI flags                                                                                                                                                                        |
| `src/commands/auth-choice.apply.openai.ts`                   | `syncSiblingAgents` default → `false`                                                                                                                                                                       |
| `src/commands/configure.gateway-auth.ts`                     | `agentDir` parameter for per-agent scoping                                                                                                                                                                  |
| `src/commands/onboard-types.ts`                              | `syncSiblingAgents` + `targetAgentId` fields                                                                                                                                                                |
| `src/commands/onboard-search.ts`                             | `"searxng"` provider + keyless handling                                                                                                                                                                     |
| `src/wizard/onboarding.finalize.ts`                          | Keyless provider handling for SearXNG                                                                                                                                                                       |
| `src/telegram/bot-handlers.ts`                               | 15s media download timeout                                                                                                                                                                                  |
| `src/discord/send.components.ts`                             | Removed unused import (lint)                                                                                                                                                                                |
| `src/agents/tools/recall-message-tool.ts`                    | Removed redundant type assertion (lint)                                                                                                                                                                     |
| `src/channels/plugins/actions/discord/handle-action.test.ts` | Preserved 2/3-arg signature handling for messaging vs admin actions.                                                                                                                                        |
| `src/channels/plugins/actions/telegram.test.ts`              | Preserved 3-arg signature for `handleTelegramAction` calls.                                                                                                                                                 |
| `src/security/audit.ts`                                      | Integrated OC deployment checks; removed redundant duplicate rate-limit check.                                                                                                                              |
| `extensions/history-import/...`                              | Secure UUID generation (`randomUUID()`) in ChatGPT/Claude parsers.                                                                                                                                          |
| `src/agents/tool-catalog.ts`                                 | `sql_query`/`sql_execute`/`session_search`/`skill_manage`/`workspace_search` entries; browser `profiles: ["coding"]`                                                                                        |
| `src/memory/types.ts`                                        | `"workspace"` in `MemorySource` union                                                                                                                                                                       |
| `src/memory/qmd-manager.ts`                                  | `bootstrapCollections` workspace mapping, `addCollectionWithRetry()`, `warnIfWorkspaceCollectionsEmpty()`                                                                                                   |
| `src/memory/backend-config.ts`                               | `"workspace"` kind + `resolveDefaultWorkspaceCollection()`                                                                                                                                                  |
| `src/memory/manager-sync-ops.ts`                             | `"workspace"` in source guards                                                                                                                                                                              |
| `src/config/types.memory.ts`                                 | `workspacePaths` on `MemoryQmdConfig`                                                                                                                                                                       |
| `src/memory/hybrid.ts`                                       | Source-aware ranking integration                                                                                                                                                                            |
| `src/agents/memory-search.ts`                                | Temporal decay defaults → `true` / `14` days                                                                                                                                                                |
| `src/memory/temporal-decay.ts`                               | Updated defaults                                                                                                                                                                                            |
| `src/config/schema.help.ts`                                  | Updated help text                                                                                                                                                                                           |
| `src/config/types.tools.ts`                                  | `"searxng"` provider + config; `scrapling` config block                                                                                                                                                     |
| `src/agents/tools/web-search.ts`                             | SearXNG provider + `runSearxngSearch()` + engine resolver                                                                                                                                                   |
| `src/config/schema.field-metadata.ts`                        | SearXNG + Scrapling field metadata                                                                                                                                                                          |
| `src/config/schema.labels.ts`                                | SearXNG + Scrapling labels                                                                                                                                                                                  |
| `docker-compose.yml`                                         | SearXNG + Scrapling sidecars                                                                                                                                                                                |
| `src/security/data-classification.ts`                        | AgentGuard: 14 `SECRET_PATTERNS`, `redactSecrets()`, precomputed `globalRegex`                                                                                                                              |
| `src/auto-reply/reply/normalize-reply.ts`                    | `redactSecrets()` before channel delivery                                                                                                                                                                   |
| `src/security/audit-extra.sync.ts`                           | 5 OC deployment audit collectors                                                                                                                                                                            |
| `src/security/audit-extra.ts`                                | Re-exported collectors                                                                                                                                                                                      |
| `src/security/audit.ts`                                      | Integrated OC deployment checks                                                                                                                                                                             |
| `src/cron/diary-archive.ts`                                  | Evidence counters + problematic rule flagging + continuity-pending signal file                                                                                                                              |
| `src/cron/isolated-agent/reflection-artifacts.ts`            | Evidence counter wiring + structured change-log                                                                                                                                                             |
| `src/config/types.cron.ts`                                   | Remediation/watchdog/seed config fields                                                                                                                                                                     |
| `src/secrets/runtime-web-tools.ts`                           | SearXNG in providers + auto-detection                                                                                                                                                                       |
| `src/secrets/runtime-web-tools.test.ts`                      | SearXNG tests                                                                                                                                                                                               |
| `ui/src/ui/chat/message-normalizer.ts`                       | `[SYSTEM: ...]` stripping                                                                                                                                                                                   |
| `ui/src/ui/chat/message-normalizer.test.ts`                  | Tests for system message stripping                                                                                                                                                                          |

### Template & Doc Files

| File                                     | What to preserve                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SOUL.md`                                | Complete rewrite (actionable framework); "Exhaust Before Escalating"                       |
| `IDENTITY.md`                            | Resilience bullet under "How You Work"                                                     |
| `AGENTS.md`                              | "Multi-Account Channels" section                                                           |
| `OPERATIONS.md`                          | Heartbeat step 4 + System Updates; 3-tier reflection; Self-Delegation guidance             |
| `Dockerfile`                             | LCM pre-bake (soft-fail), agent CLI tooling (`python3`, `ffmpeg`, `pandoc`, `yt-dlp`, etc) |
| `docs/reference/templates/SOUL.md`       | Ouroboros framing, 3 axes, Ship of Theseus, 7 Biblical principles                          |
| `docs/reference/templates/AGENTS.md`     | "Multi-Account Channels"                                                                   |
| `docs/reference/templates/HEARTBEAT.md`  | Proactive Presence section                                                                 |
| `docs/reference/templates/BOOT.md`       | Startup state verification example                                                         |
| `docs/reference/templates/OPERATIONS.md` | 3-tier reflection + `NEXT_WAKE:` docs; "First-failure surrender" detector                  |
| `docs/reference/templates/IDENTITY.md`   | Resilience bullet                                                                          |
| `docs/zh-CN/reference/templates/SOUL.md` | Custom rewrite (sync from EN)                                                              |
| `cron/default-jobs.json`                 | 3-tier reflection + nightly-innovation + morning-briefing + self-audit-21                  |

### CI Workflows

| File                                         | What to preserve                      |
| -------------------------------------------- | ------------------------------------- |
| `.github/workflows/ci.yml`                   | `ubuntu-latest` (not `blacksmith-*`)  |
| `.github/workflows/docker-release.yml`       | `ubuntu-latest`; slim variant removed |
| `.github/workflows/install-smoke.yml`        | `ubuntu-latest`                       |
| `.github/workflows/workflow-sanity.yml`      | `ubuntu-latest`                       |
| `.github/workflows/sandbox-common-smoke.yml` | `ubuntu-latest`                       |
| `.github/workflows/labeler.yml`              | `ubuntu-latest`                       |
| `.github/workflows/stale.yml`                | `ubuntu-latest`                       |
| `.github/workflows/auto-response.yml`        | `ubuntu-latest`                       |
| `.github/workflows/docker-build.yml`         | Custom `build-browser` job            |

---

## Post-Sync Checklist

Run these after every merge from upstream. Grouped by area.

### Critical Patches

1. **CDP Host header fix** — `grep -c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts` ≥ 1. Without this, `http://browser:9222` fails. See `LOCAL_PATCHES.md`.
2. **Browser tool agent routing** — `grep -c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts` ≥ 1. Without this, agents use main browser.
3. **Per-agent OAuth isolation** — `grep -c 'Per-agent isolation' src/agents/auth-profiles/oauth.ts` ≥ 2.
4. **IDENTITY.md health nudge** — `grep -c 'path.resolve' src/agents/system-prompt.ts` ≥ 1. (Bug-fix: relative path in `statSync`)

### Managed Platform & Updates

5. **Managed-platform gating** — `grep -c 'OPENCLAW_MANAGED_PLATFORM' docker-entrypoint.sh` ≥ 3, `enforce-config.mjs` ≥ 2.
6. **Blacksmith runners** — `grep -r "blacksmith" .github/workflows/` → replace with `ubuntu-latest`/`windows-latest`

### Browser & Sandbox

7. **Sandbox browser wiring** — `grep -c 'handleSandboxBrowserRequest' src/gateway/server-http.ts` ≥ 1.
8. **noVNC auth** — verify `sandbox-browser-entrypoint.sh` has `OPENCLAW_BROWSER_NOVNC_NO_AUTH`
9. **Browser startup sweep** — `grep -c 'sweepStaleBrowserContainers' src/gateway/server-startup.ts` ≥ 1 and `grep -c 'readDockerImageId' src/agents/sandbox/docker.ts` ≥ 1.
10. **Parallel profile listing** — `grep -c 'Promise.all' src/browser/server-context.ts` ≥ 1.
11. **Browser profiles timeout** — `grep 'timeoutMs: 5000' src/browser/client.ts` must match.
12. **Auto-download wiring** — `grep -c 'downloadWorkspaceForCdp' src/browser/control-service.ts` ≥ 1.

### Tools & Plugins

13. **SQL tool registration** — `grep -c 'createSqlQueryTool' src/agents/openclaw-tools.ts` ≥ 1.
14. **Full tool profile enforcement** — `grep -c 'tools.profile = "full"' enforce-config.mjs` ≥ 1 and browser in `profiles: ["coding"]`.
15. **LCM pre-bake** — `grep -c 'lossless-claw' Dockerfile` ≥ 1 and `grep -c 'contextEngine' enforce-config.mjs` ≥ 1. Soft-fail subshell (`|| echo`).
16. **Skill-evolution cron** — `grep -c 'skill-evolution' enforce-config.mjs` ≥ 1. NOT in `MAIN_ONLY_JOBS`.
17. **Progressive disclosure** — `grep -c 'progressiveDisclosure' src/config/types.skills.ts` ≥ 1 and `grep -c 'createSkillViewTool' src/agents/openclaw-tools.ts` ≥ 1.
18. **Cron self-healing** — `grep -c 'cron_heal' src/agents/system-prompt.ts` ≥ 2, `test -f src/agents/tools/cron-heal-tool.ts`, `test -f src/cron/remediation-journal.ts`.
19. **Team Coordination** — `grep -c 'team-sync' cron/default-jobs.json` ≥ 1. `grep -c 'symlinkSync' enforce-config.mjs` ≥ 1.

### SearXNG & Scrapling

19. **SearXNG search provider** — `grep -c 'runSearxngSearch' src/agents/tools/web-search.ts` ≥ 1 and `grep -c 'SEARXNG_BASE_URL' docker-compose.yml` ≥ 1.
20. **SearXNG runtime resolver** — `grep -c '"searxng"' src/secrets/runtime-web-tools.ts` ≥ 3 and `grep -c 'SEARXNG_BASE_URL' src/secrets/runtime-web-tools.ts` ≥ 1.
21. **SearXNG engine selection** — `grep -c 'resolveSearxngEngines' src/agents/tools/web-search.ts` ≥ 1 and `grep -c 'slice().sort()' src/agents/tools/web-search.ts` ≥ 1.
22. **Scrapling backend** — `grep -c 'fetchScraplingContent' src/agents/tools/web-fetch.ts` ≥ 1, `test -f Dockerfile.scrapling`, `test -f scripts/scrapling-server.py`.
23. **Scrapling + SearXNG Zod schemas** — `grep -c 'scrapling' src/config/zod-schema.agent-runtime.ts` ≥ 1 and `grep -c 'searxng' src/config/zod-schema.agent-runtime.ts` ≥ 1.
24. **GEMINI_API_KEY wiring** — `grep -c 'GEMINI_API_KEY' enforce-config.mjs` ≥ 1. **Video auto-enable**: `grep -c 'OPENCLAW_VIDEO_ENABLED' enforce-config.mjs` ≥ 1.

### Memory & Workspace

25. **Workspace auto-indexing** — `grep -c '"workspace"' src/memory/types.ts` ≥ 1 and `grep -c 'resolveDefaultWorkspaceCollection' src/memory/backend-config.ts` ≥ 1.
26. **workspace_search tool** — `grep -c 'createWorkspaceSearchTool' src/agents/tool-catalog.ts` ≥ 1. QMD-gated only (business mode gate removed).
27. **QMD find path** — `grep -c '/proc/\*' Dockerfile` ≥ 1.
28. **QMD pre-warm** — `grep -c 'qmd pre-warm' docker-entrypoint.sh` ≥ 1.
29. **QMD retry** — `grep -c 'addCollectionWithRetry' src/memory/qmd-manager.ts` ≥ 1.
30. **Workspace doc converter** — `grep -c 'workspace-doc-converter' docker-entrypoint.sh` ≥ 1.
31. **scanMemoryFiles bounds** — `grep -c 'MAX_FILES' src/brainx/advisory-warnings.ts` ≥ 1.
32. **QMD Gemini embedding patch** — `grep -c 'patch-qmd-gemini' docker-entrypoint.sh` ≥ 1 and `test -f scripts/patch-qmd-gemini.sh`.
33. **QMD vsearch mode** — `grep -c 'vsearch' enforce-config.mjs` ≥ 1. Required for hybrid vector+BM25 search with Gemini embeddings.
34. **Flush prompt dedup** — `grep -c 'buildFlushPrompt' src/cron/flush-prompt.ts` ≥ 1 and `grep -c 'buildFlushPrompt' src/cron/pre-reset-flush.ts` ≥ 1 and `grep -c 'buildFlushPrompt' src/cron/pre-idle-flush.ts` ≥ 1.

### Security

32. **AgentGuard secret redaction** — `grep -c 'redactSecrets' src/auto-reply/reply/normalize-reply.ts` ≥ 1 and `grep -c 'SECRET_PATTERNS' src/security/data-classification.ts` ≥ 1.
33. **Security event journal** — `grep -c 'logSecurityEvent' src/security/security-event-journal.ts` ≥ 1.
34. **Workspace context scanning** — `grep -c 'scanAndLog' src/agents/workspace.ts` ≥ 1.
35. **OC deployment audit** — `grep -c 'collectSearxngExposureFindings' src/security/audit-extra.sync.ts` ≥ 1.

### Agent Behavior

### Tests & Security Hardening

41. **Channel action test signatures** — `grep -c 'expectFirstWhatsAppAction' src/channels/plugins/actions/actions.test.ts` ≥ 1. Ensures all core channel actions (Discord/Slack/WhatsApp) are verified for the 3-arg signature.
    41a. **Channel tool signatures (3-arg)** — `grep -c 'mediaLocalRoots' src/agents/tools/whatsapp-actions.ts` ≥ 1 and `grep -c 'mediaLocalRoots' src/agents/tools/matrix-actions.ts` ≥ 1. Ensures core tools support the standardized 3rd options argument.
42. **Deduplicated audit rate-limit** — `grep -c 'gateway.auth_no_rate_limit' src/security/audit.ts` should be exactly 1.
43. **Secure history import IDs** — `grep -c 'randomUUID' extensions/history-import/src/parsers/chatgpt.ts` ≥ 1.
44. **soul-evil** — `rm -rf src/hooks/bundled/soul-evil src/hooks/soul-evil.ts` if re-introduced
45. **Typing TTL** — `grep -c 'onTtlExpired' src/auto-reply/reply/typing.ts` ≥ 1.
46. **Heartbeat default** — `grep 'DEFAULT_HEARTBEAT_EVERY' src/auto-reply/heartbeat.ts` should show `"1h"`.
47. **Telegram media timeout** — `grep -c 'MEDIA_DOWNLOAD_TIMEOUT_MS' src/telegram/bot-handlers.ts` ≥ 1.
48. **Backup scripts** — `grep -c 'notify_failure' scripts/backup-upload.sh` ≥ 1 and `grep -c 'restore-complete' scripts/restore-from-backup.sh` ≥ 1.
49. **Agent CLI tooling** — `grep -c 'yt-dlp' Dockerfile` ≥ 1.
50. **Build verification** — `npm install && npm run build`
