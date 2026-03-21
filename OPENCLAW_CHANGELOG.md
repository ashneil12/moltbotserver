# OPENCLAW_CHANGELOG.md — MoltBot Custom Modifications Log

This file is the complete record of all custom changes made to the OpenClaw source for the MoltBot platform.
For the upstream sync reference (what to preserve during merges), see `OPENCLAW_CONTEXT.md`.

---

## Enable QMD Vector+BM25 Hybrid Search (2026-03-22)

**Purpose:** QMD defaulted to `searchMode: "search"` (BM25 keyword-only), which caused `shouldRunEmbed()` to return `false` — embeddings were never generated despite the Gemini embedding proxy being functional. Setting `searchMode: "vsearch"` enables hybrid vector+BM25 search, unlocking semantic recall for the per-turn workspace context sweep.

| File                 | Change                                                                   | Sync Risk     |
| -------------------- | ------------------------------------------------------------------------ | ------------- |
| `enforce-config.mjs` | Added `qmd.searchMode = "vsearch"` in `enforceMemory()` QMD config block | None — custom |

**Context:** The upstream default (`backend-config.ts:79`) is `"search"` to avoid slow local model inference on CPU-only servers. Since embeddings are already proxied to Gemini API via `patch-qmd-gemini.sh`, there is no local CPU cost for vector search — the CPU-only concern doesn't apply.

---

**Purpose:** Two production bugs: (1) `{{PRIMARY_MODEL}}` literal string in cron job payloads caused `FailoverError: Unknown model` on every execution of 7+ cron jobs, wasting a fallback cycle. (2) SOUL.md falsely quarantined (riskScore=100) because its own security documentation section contained text matching scanner prompt injection patterns.

| File                                        | Change                                                                                                                                                                                                                                     | Sync Risk      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `enforce-config.mjs`                        | Replaced 7 `model: "{{PRIMARY_MODEL}}"` → `model: null` in `buildCanonicalJobs()`. Added `{{PRIMARY_MODEL}}` → `null` migration patch in `seedCronJobs()` for existing deployed agents. Updated write condition to include migration flag. | None — custom  |
| `cron/default-jobs.json`                    | Replaced 3 `"model": "{{PRIMARY_MODEL}}"` → `"model": null`                                                                                                                                                                                | None — custom  |
| `src/cron/isolated-agent/run.ts`            | Added defensive guard: skip model override if it contains `{{...}}` (unresolved template variable), log warning and fall back to agent defaults                                                                                            | Low — additive |
| `src/agents/workspace.ts`                   | Bootstrap file quarantine exemption: files in `VALID_BOOTSTRAP_NAMES` are scanned but never quarantined. Findings logged at `info` level instead of `warn`.                                                                                | Low — additive |
| `enforce-config-cron-seed.test.mjs`         | **NEW** — 5 tests: migration correctness, idempotency, non-agentTurn safety, zero remaining `{{PRIMARY_MODEL}}` in seed sources                                                                                                            | None — test    |
| `src/agents/workspace.context-scan.test.ts` | Updated 4 tests + added 2 new tests for bootstrap file quarantine exemption                                                                                                                                                                | None — test    |

> **Sync Risk:** `run.ts` — 10-line defensive guard added to model override block. If upstream restructures the model resolution path, re-apply. `workspace.ts` — 14-line check added to `scanWorkspaceContent()`. Both are additive.

---

**Purpose:** Context was being silently discarded on session resets — only daily resets at 4 AM got a pre-reset memory flush. Now all three reset paths trigger agentic memory flush: daily (existing timer), idle (new background sweep), and `/new`/`/reset` (new fire-and-forget via global callback bridge).

| File                                    | Change                                                                                                                                                                                | Sync Risk      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/cron/pre-idle-flush.ts`            | **NEW** — Background sweep for idle sessions. `isHumanSession()` gate (rejects cron/hook/heartbeat/system), `isEligibleForPreIdleFlush()` (80% threshold), timer lifecycle.           | None — new     |
| `src/cron/pre-idle-flush.test.ts`       | **NEW** — 28 tests covering human session gate, idle eligibility, sweep logic, timer lifecycle.                                                                                       | None — test    |
| `src/cron/session-flush-global.ts`      | **NEW** — Global singleton callback (`Symbol.for` pattern, same as `hook-runner-global.ts`). Bridges session.ts → server-cron.ts for fire-and-forget memory flush on `/new`/`/reset`. | None — new     |
| `src/cron/session-flush-global.test.ts` | **NEW** — 5 tests covering registration, unregistration, fire-and-forget, error swallowing, callback replacement.                                                                     | None — test    |
| `src/cron/pre-reset-flush.ts`           | Exported `MIN_FLUSH_TOKENS` and `MAX_FLUSH_PER_SWEEP` constants for reuse by idle flush module.                                                                                       | Low — additive |
| `src/gateway/server-cron.ts`            | Integrated `startPreIdleFlushTimer`, registered `SessionFlushCallback` (runs isolated agent turn with memory flush prompt), added `stopPreIdleFlush` + `stopSessionFlushCallback`.    | Medium         |
| `src/auto-reply/reply/session.ts`       | Added fire-and-forget `requestSessionFlush()` on `/new`/`/reset` when ≥2000 context tokens. Runs before transcript archival.                                                          | Low — additive |

**Human-session-only filtering:** The idle sweep rejects all system sessions via `isHumanSession()` — session keys containing `:cron:`, `:run:`, `:hook:`, `heartbeat`, `__pre-reset-flush:`, or `__pre-idle-flush:` are skipped. Sessions must also have a valid `chatType` (`direct`, `group`, `channel`) or be a thread session.

> **Sync Risk:** `server-cron.ts` — `buildGatewayCronService()` grows by ~50 lines (callback registration + synthetic job builder). `session.ts` — 15-line fire-and-forget block added to the session reset path. Both are additive blocks unlikely to conflict but check during upstream sync.

---

## QMD Gemini Embedding Patch (2026-03-21)

**Purpose:** Patch QMD v2.0.1 to use the Gemini `gemini-embedding-2-preview` API for embeddings instead of local llama.cpp GGUF models. Solves Vulkan compilation failures and slow CPU-only embedding on Hetzner VMs. Rerank and query expansion still use local llama.cpp models.

| File                          | Change                                                                                                                                                       | Sync Risk     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `scripts/patch-qmd-gemini.sh` | **NEW** — Runtime monkey-patch for QMD's `llm.ts`. Appends `GeminiEmbedProxy extends LlamaCpp` class, replaces `getDefaultLlamaCpp()` singleton. Idempotent. | None — new    |
| `docker-entrypoint.sh`        | Calls `patch-qmd-gemini.sh` after QMD pre-warm, gated on `GEMINI_API_KEY` + `QMD_EMBED_PROVIDER != local`.                                                   | None — custom |

**Environment Variables:**

- `GEMINI_API_KEY` — required; enables the Gemini proxy when set
- `QMD_EMBED_PROVIDER` — set to `local` to disable the patch and use local GGUF models
- `QMD_GEMINI_EMBED_MODEL` — override the default model (default: `gemini-embedding-2-preview`)

**Tested:** 1426 chunks from 83 documents embedded in ~65s via Gemini API on Hetzner CX22.

---

## Auto-Heal Self-Healing Agent System (2026-03-21)

**Purpose:** Autonomous background code repair via a hidden engineering subagent ("Ross"). Follows a strict TDD loop: diagnose errors from the error journal → backup target file → write failing test → apply smallest fix → verify with vitest → commit or rollback. All modifications are strictly scoped to "leaf node" files (tools/, skills/, utils/, cron/) with hard-reject for trunk nodes (system-prompt, security, config, Dockerfile). Escalation presents fix-first options before "disable." Inspired by [Shubham Saboo's autonomous agent team architecture](https://x.com/Saboo_Shubham_).

| File                                            | Change                                                                                                                                                                                             | Sync Risk     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/logging/error-journal.ts`                  | **NEW** — Structured error capture for auto-heal pipeline. Append-only JSONL log with deduplication, severity classification, auto-escalation. Uses atomic writes (tmp → rename) for crash safety. | None — new    |
| `src/logging/error-journal.test.ts`             | **NEW** — 15 tests covering append, dedup, severity classification, status marking, pruning.                                                                                                       | None — test   |
| `src/cron/auto-heal-journal.ts`                 | **NEW** — Audit trail for autonomous code fixes. Records backup paths, test commands, outcomes. Generates `BACKGROUND_FIXES.md`. Enforces leaf/trunk node scope. Atomic writes.                    | None — new    |
| `src/cron/auto-heal-journal.test.ts`            | **NEW** — 17 tests covering scope enforcement, entry creation, attempt counting, pruning, BACKGROUND_FIXES.md generation.                                                                          | None — test   |
| `src/agents/tools/auto-heal-tool.ts`            | **NEW** — Agent-facing tool with 5 actions (diagnose, attempt-fix, rollback, journal, status). 3-strike limit per error, scope enforcement, escalation integration.                                | None — new    |
| `src/agents/tools/auto-heal-tool.test.ts`       | **NEW** — 21 tests covering all actions, scope violations, escalation triggers, backup/rollback, journal queries.                                                                                  | None — test   |
| `src/agents/tools/auto-heal-escalation.ts`      | **NEW** — Translates technical errors into plain-English messages with fix-first options. "Disable" is always the last option.                                                                     | None — new    |
| `src/agents/tools/auto-heal-escalation.test.ts` | **NEW** — 15 tests verifying fix-first option ordering, plain-English translation, recurring error handling.                                                                                       | None — test   |
| `.agents/skills/auto-heal/SKILL.md`             | **NEW** — Protocol instructions for the auto-heal subagent. Documents the TDD loop, scope constraints, and escalation flow.                                                                        | None — custom |
| `src/logging/health-sentinel.ts`                | Added `auto_heal` tool guidance to sentinel escalation text alongside existing `cron_heal` guidance.                                                                                               | Low           |
| `src/agents/tools/moltbot-tools.ts`             | Wired `createAutoHealTool()` into MoltBot tool registry.                                                                                                                                           | Low           |
| `src/agents/tools/openclaw-tools.ts`            | Wired `createAutoHealTool()` into OpenClaw tool registry.                                                                                                                                          | Low           |

---

## Deterministic Agent Provisioning & Cron Configuration (2026-03-21)

**Purpose:** Shift multi-agent team management from hallucination-prone AI commands to deterministic shell/Node scripts. Solves issues with missing auth files, hallucinatory path names, and malformed cron job configurations.

| File                                                      | Change                                                                                                                                           | Sync Risk     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `scripts/provision-agent.sh`                              | **NEW** — Deterministic bash script for copying workspaces, linking auth tokens, and hooking up the `team/` directory.                           | None — new    |
| `scripts/add-cron.mjs`                                    | Added `--prefer-channel` and `--check-delivery` flags. Perfected the `--auto-to` credential resolver logic for reliable, hallucination-free IDs. | None — custom |
| `enforce-config.mjs`                                      | Updated workspace startup to ensure the `team/` directory is symlinked across all agent nodes for shared state.                                  | None — custom |
| `cron/default-jobs.json`                                  | Added `team-sync` job running `cat team/status.md team/decisions.md` every 6 hours.                                                              | None — custom |
| `AGENTS.md`                                               | Updated Global Multi-Agent Rules to strictly forbid manual JSON/workspace hacking, enforcing `add-cron.mjs` and `provision-agent.sh`.            | Low           |
| `docs/reference/templates/TOOLS.md`                       | Pre-installed CLI list updated so new agents discover `provision-agent.sh` and `add-cron.mjs` on boot.                                           | None — custom |
| `.agents/skills/cron-setup/instructions/creating-jobs.md` | Promoted `--auto-to` and documented `--prefer-channel`.                                                                                          | None — custom |

---

## Channel Plugin Action Fixes & Security Hardening (2026-03-21)

**Purpose:** Resolve failing tests in Discord/Telegram plugins caused by signature mismatches, fix incorrect mock paths, and harden security guardrails in new extensions.

| File                                                         | Change                                                                                                               | Sync Risk        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/channels/plugins/actions/discord.test.ts`               | Corrected Discord mock path and updated `handleDiscordAction` mock signature.                                        | None — test      |
| `src/channels/plugins/actions/discord/handle-action.test.ts` | Updated `toHaveBeenCalledWith` to match 3-argument signature for messaging actions and 2-argument for admin.         | None — test      |
| `src/channels/plugins/actions/telegram.test.ts`              | Updated `toHaveBeenCalledWith` to match 3-argument signature.                                                        | None — test      |
| `src/security/audit.ts`                                      | Removed redundant/duplicate rate-limit check that was causing `trusted-proxy` test failures.                         | Low — cleanup    |
| `extensions/history-import/...`                              | Switched from `Math.random()` to `crypto.randomUUID()` in ChatGPT and Claude parsers to satisfy security guardrails. | None — extension |

---

## Channel Action Signature Standardization (2026-03-21)

**Purpose:** Standardize the function signature for all channel action handlers to `(params, cfg, context)` to resolve test mismatches, ensure `mediaLocalRoots` is consistently available, and simplify extension development.

| File                                                          | Change                                                                                                              | Sync Risk                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/agents/tools/whatsapp-actions.ts`                        | Updated `handleWhatsAppAction` to accept 3rd `options` argument with `mediaLocalRoots`.                             | Medium — tool signature change |
| `src/agents/tools/matrix-actions.ts`                          | Updated `handleMatrixAction` to accept 3rd `options` argument with `mediaLocalRoots`.                               | Medium — tool signature change |
| `extensions/whatsapp/src/channel.ts`                          | Updated `handleAction` to pass `ctx.mediaLocalRoots` to `handleWhatsAppAction`.                                     | None — extension               |
| `extensions/matrix/src/actions.ts`                            | Updated all calls to `handleMatrixAction` to pass the `options` object.                                             | None — extension               |
| `extensions/discord/src/actions/handle-action.guild-admin.ts` | Updated all `handleDiscordAction` calls to pass the 3rd `actionOptions` argument for consistency.                   | None — extension               |
| `src/channels/plugins/actions/actions.test.ts`                | Hardened test suite with comprehensive assertions for the 3-argument signature across Discord, Slack, and WhatsApp. | None — test                    |
| `src/channels/plugins/actions/signal.test.ts`                 | Updated `toHaveBeenCalledWith` to match 3rd-argument expectations for Signal mocks.                                 | None — test                    |

---

---

**Purpose:** Complete overhaul of the ClawFlows integration. Replaces the static symlink-based "deploy-time toggle" system with a dynamic, cron-based "always-on" library. Users can now enable/disable 84+ workflows (6 built-in, 78 community) on the fly via the dashboard Settings modal, with support for per-agent scoping.

**Key Changes:**

- **Always-on:** Removed the `CLAWFLOWS_ENABLED` env var and deploy checkbox. ClawFlows is now cloned onto every instance by default via `cloud-init`.
- **Cron-based execution:** Community workflows are no longer symlinked into an `enabled/` directory. Instead, the dashboard creates a `cron.add` job that executes the workflow markdown via the agent.
- **Per-agent support:** Workflows can be enabled for specific agents (e.g., "Main", "Nehemiah"). The `agentId` is encoded into the cron job ID (`clawflow:agent-name:workflow-id`).
- **Enhanced Built-ins:** Integrated 6 core MoltBot crons (Morning Briefing, Consciousness Loop, etc.) into the Workflows UI with an "Enhanced" badge. Toggling these updates the existing cron job via `cron.update`.
- **UI/UX:** New `WorkflowsTab` in `SettingsModal` with search, category filters, and agent selection.

| Component         | Files                                                      | Change                                                                                                              | Sync Risk            |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Dashboard Service | `src/lib/services/clawflows.ts`                            | New service for catalog metadata (78 community + 6 built-in), cron ID builders/parsers, and `cloud-init` generator. | None — custom        |
| Dashboard API     | `src/app/api/instances/[id]/workflows/route.ts`            | New endpoint for toggling workflows. Uses `cron.add/update/remove` RPCs. Added rate limiting.                       | None — custom        |
| Dashboard UI      | `src/app/dashboard/instances/components/WorkflowsTab.tsx`  | New settings tab with unified workflow management.                                                                  | None — custom        |
| Dashboard UI      | `src/app/dashboard/instances/components/SettingsModal.tsx` | Integrated `WorkflowsTab`.                                                                                          | None — custom        |
| Dashboard Lib     | `src/lib/services/instance-env.ts`                         | Removed `CLAWFLOWS_ENABLED` from `InstanceEnv` and `DeployConfig`.                                                  | Low — simple removal |
| Dashboard Tests   | `src/lib/services/clawflows.test.ts`                       | 40 unit tests for the clawflows service.                                                                            | None — custom        |

**Sync Risk:** Very low. Most changes are in new, custom files. The removal of the `CLAWFLOWS_ENABLED` flag in `instance-env.ts` is the only modification to an existing file that might conflict with upstream changes to the deploy process, but it's a simple deletion.

---

## Agent Skills Restructuring — Progressive Disclosure Pattern (2026-03-21)

**Purpose:** Restructure all 38 monolithic `.agents/skills/SKILL.md` files into Anthropic's progressive disclosure pattern — thin orchestrator `SKILL.md` files that delegate details to focused `instructions/` sub-files. Reduces context bloat when the `skill_view` tool loads a skill, and makes skills easier to maintain and extend.

**Pattern applied:**

```
skill-name/
├── SKILL.md               # Thin orchestrator: workflow + delegation refs (34–86 lines)
└── instructions/           # Step-by-step procedural content (loaded on demand)
    ├── step-1.md
    └── step-2.md
```

**Results:** ~81% average SKILL.md size reduction (418→71L Tier 1, 378→68L Tier 2, 236→47L Tier 3). 130+ instruction sub-files created. No content lost — all detail migrated.

| Tier                     | Skills | Avg Before | Avg After | Sub-files |
| ------------------------ | ------ | ---------- | --------- | --------- |
| 1 — Critical operational | 3      | 418L       | 72L       | 15        |
| 2 — Large marketing/ops  | 15     | 378L       | 68L       | 64        |
| 3 — Moderate             | 20     | 236L       | 47L       | 51        |

### Tier 1 — Critical Operational Skills

| Skill                | Before | After | Sub-files |
| -------------------- | ------ | ----- | --------- |
| `create-agent`       | 483L   | 79L   | 5         |
| `cron-setup`         | 398L   | 66L   | 4         |
| `channel-team-setup` | 374L   | 69L   | 6         |

### Tier 2 — Large Marketing/Operational Skills

| Skill                  | Before | After |
| ---------------------- | ------ | ----- |
| `popup-cro`            | 455L   | 75L   |
| `marketing-psychology` | 455L   | 86L   |
| `copy-editing`         | 448L   | 69L   |
| `form-cro`             | 430L   | 79L   |
| `churn-prevention`     | 425L   | 84L   |
| `seo-audit`            | 413L   | 78L   |
| `ai-seo`               | 400L   | 62L   |
| `content-strategy`     | 367L   | 62L   |
| `ad-creative`          | 364L   | 62L   |
| `signup-flow-cro`      | 361L   | 58L   |
| `site-architecture`    | 359L   | 62L   |
| `launch-strategy`      | 355L   | 52L   |
| `sales-enablement`     | 351L   | 68L   |
| `revops`               | 345L   | 68L   |
| `paid-ads`             | 317L   | 62L   |

### Tier 3 — Moderate Skills

| Skill                                                                             | Before | After |
| --------------------------------------------------------------------------------- | ------ | ----- |
| `lead-magnets`, `email-sequence`, `analytics-tracking`, `social-content`          | ~310L  | ~53L  |
| `ab-test-setup`, `competitor-alternatives`, `referral-program`, `copywriting`     | ~260L  | ~50L  |
| `prepare-pr`, `product-marketing-context`, `programmatic-seo`, `pricing-strategy` | ~235L  | ~47L  |
| `review-pr`, `paywall-upgrade-cro`, `onboarding-cro`, `page-cro`                  | ~210L  | ~44L  |
| `schema-markup`, `free-tool-strategy`, `marketing-ideas`, `cold-email`            | ~170L  | ~46L  |

**Skipped (Tier 4 — already well-structured or under 160L):** `merge-pr`, `team-coordination`, `verification-gate`, `systematic-debugging`, `marketing-tools-registry`, `marketing-psychology` (already restructured in Tier 2), `channel-team-setup` (Tier 1).

**Sync Risk:** None — `.agents/skills/` is entirely custom; no upstream equivalent. Safe from any upstream merge.

---

## cron-setup — Promote `add-cron.mjs` as Primary Interface (2026-03-21)

**Purpose:** Update `cron-setup/instructions/creating-jobs.md` to promote `scripts/add-cron.mjs` as the preferred method for creating cron jobs. The script already existed but wasn't prominently documented. It validates inputs, detects duplicates, auto-resolves delivery targets, and supports dry-run — all things that reduce agent errors from hand-crafted JSON.

| File                                                      | Change                                                                                                                                           | Sync Risk     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `.agents/skills/cron-setup/instructions/creating-jobs.md` | Added `add-cron.mjs` as primary section with flags, schedule formats, delivery options. Manual `cron` tool usage moved to "if you must" section. | None — custom |
| `.agents/skills/cron-setup/SKILL.md`                      | Updated Don'ts section to reflect `add-cron.mjs` as preferred; removed `openclaw cron` CLI warning (already addressed internally by the script)  | None — custom |

**Sync Risk:** None — `.agents/` is fully custom.

---

## Skills Expansion — Document Office, Frontend Design, Claude SEO & Context Engineering (2026-03-21)

**Purpose:** Add 21 new skills to the fork's `skills/` directory (64 → 85 total). Covers document processing, frontend design methodology, comprehensive SEO auditing with subagents, and context engineering patterns. All purely additive — no existing code modified.

### Document & Office Skills — [anthropics/skills](https://github.com/anthropics/skills)

| Skill Directory    | Description                                                              | Dependencies                                        |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------- |
| `pdf/`             | PDF processing: read, extract tables, fill forms, merge/split            | `pypdf`, `pdfplumber`, `reportlab`, `poppler-utils` |
| `docx/`            | Word doc creation (docx-js), editing (XML manipulation), tracked changes | `docx` (npm), `pandoc`                              |
| `pptx/`            | Slide decks: pptxgenjs creation, markitdown reading, XML editing         | `pptxgenjs` (npm), `python-pptx`                    |
| `xlsx/`            | Excel: openpyxl/pandas, formula verification, financial formatting       | `openpyxl`, `pandas`                                |
| `doc-coauthoring/` | Pure methodology — 3-stage collaborative writing workflow                | None                                                |

### Design — [anthropics/skills](https://github.com/anthropics/skills)

| Skill Directory    | Description                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `frontend-design/` | Production-grade UI design methodology. Anti-"AI slop" aesthetics, bold typography, cohesive design systems |

### Claude SEO — [AgriciDaniel/claude-seo v1.5.0](https://github.com/AgriciDaniel/claude-seo)

12 sub-skills + 7 subagent definitions + hooks + schema templates. Significantly more powerful than existing individual Corey Haines SEO skills.

| Skill Directory            | Description                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `seo-audit-claude/`        | Full website audit with 7 parallel subagents, health scoring (0-100). Includes `agents/`, `hooks/`, `schema/` |
| `seo-competitor-pages/`    | Competitor comparison page generation                                                                         |
| `seo-content/`             | E-E-A-T analysis, readability, thin content detection                                                         |
| `seo-geo/`                 | AI search optimization for Google AI Overviews, ChatGPT, Perplexity                                           |
| `seo-hreflang/`            | International SEO hreflang implementation                                                                     |
| `seo-images/`              | Image optimization audit (alt text, sizing, format)                                                           |
| `seo-page/`                | Single-page on-page SEO analysis                                                                              |
| `seo-plan/`                | Strategic SEO planning with assets                                                                            |
| `seo-programmatic-claude/` | Programmatic SEO with quality gates (30/50 page thresholds)                                                   |
| `seo-schema/`              | Schema markup detection, validation, generation                                                               |
| `seo-sitemap/`             | Sitemap structure analysis and generation                                                                     |
| `seo-technical/`           | Technical SEO: Core Web Vitals, robots.txt, canonicals, security headers                                      |

> **Note:** `seo-audit-claude` and `seo-programmatic-claude` renamed to avoid conflicts with existing `seo-audit` (Corey Haines) and `programmatic-seo` skills. Both coexist.

### Context Engineering — [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/agent-skills-for-context-engineering)

Cherry-picked 3 of 14 available skills (most relevant to hosted agent deployments).

| Skill Directory         | Description                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `context-compression/`  | Token cost reduction via context compression techniques. Includes `compression_evaluator.py` |
| `context-optimization/` | Operational context optimization patterns. Includes `compaction.py`                          |
| `hosted-agents/`        | Infrastructure patterns for hosted agent deployments. Includes `sandbox_manager.py`          |

**Sync Risk:** None — all changes are purely additive (`skills/` directory new files only). No existing code modified.

---

## Workspace Skills Auto-Creation & Diary Continuity Hardening (2026-03-21)

**Purpose:** Auto-create `.agents/skills/` directory in workspace setup so deployed agents can write procedural skills without manual mkdir. Fix race condition between deterministic diary archiver and post-archive cron job. Gitignore cleanup.

| File                             | Change                                                                                                                                                                                                                                                            | Sync Risk      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/agents/workspace.ts`        | `ensureAgentWorkspace()` now creates `.agents/skills/` alongside `memory/`                                                                                                                                                                                        | Low — additive |
| `src/agents/workspace.test.ts`   | +1 test verifying `.agents/skills/` directory creation                                                                                                                                                                                                            | None — test    |
| `src/cron/diary-archive.ts`      | Exported `CONTINUITY_PENDING_FILENAME` constant; writes `.diary-continuity-pending` signal file after diary archive completes ([diary-archive.ts#L900-L914](file:///Users/ash/Documents/MoltBotServers/moltbotserver-source/src/cron/diary-archive.ts#L900-L914)) | None — custom  |
| `src/cron/diary-archive.test.ts` | +9 tests for `buildNewDiary()`, `extractTailExcerpt()`, `CONTINUITY_PENDING_FILENAME`                                                                                                                                                                             | None — test    |
| `enforce-config.mjs`             | diary-post-archive cron prompt rewritten: Phase 0 (verify archive marker) + Phase 3 (cleanup signal file) + Phase 4 (final promotion scan)                                                                                                                        | None — custom  |
| `cron/default-jobs.json`         | Updated `diary-post-archive` message to match enforce-config.mjs                                                                                                                                                                                                  | None — custom  |
| `.gitignore`                     | Added `data/logs/` (test output was incorrectly tracked)                                                                                                                                                                                                          | None — hygiene |

---

## SearXNG Runtime Resolver, Gemini API Key & Codebase Cleanup (2026-03-21)

**Purpose:** Fix SearXNG not being selected as web search provider (`unsupported_country` errors), wire `GEMINI_API_KEY` from dashboard, auto-enable video understanding with Gemini key, close Zod schema gaps, and perform code quality cleanup.

| File                                     | Change                                                                                                                                | Sync Risk      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/secrets/runtime-web-tools.ts`       | Added `"searxng"` to `WEB_SEARCH_PROVIDERS`, `normalizeProvider()`, `envVarsForProvider()`, and auto-detection via `SEARXNG_BASE_URL` | Low — additive |
| `src/secrets/runtime-web-tools.test.ts`  | +4 tests for SearXNG selection paths                                                                                                  | None — test    |
| `src/agents/tools/web-search.ts`         | `runWebSearch` now passes `country` to SearXNG; `runSearxngSearch` builds region-aware locale codes                                   | Low — additive |
| `src/config/zod-schema.agent-runtime.ts` | Added `z.literal("searxng")` to provider union, `searxng` config block, `scrapling` config block to `ToolsWebFetchSchema`             | Low — additive |
| `enforce-config.mjs`                     | Wires `OPENCLAW_SEARCH_PROVIDER` and `SEARXNG_BASE_URL` into `openclaw.json`; auto-enables video with Gemini key                      | None — custom  |

### Dashboard (moltbot-dashboard)

| File                                      | Change                                                                                 | Sync Risk     |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------- |
| `src/lib/services/instance-env.ts`        | Sets `GEMINI_API_KEY` from `byteroverGeminiKey`; auto-enables `OPENCLAW_VIDEO_ENABLED` | None — custom |
| `src/app/.../CredentialVault.tsx`         | Deduplicated identical error/cancelled JSX blocks                                      | None — custom |
| `src/components/.../InlineDeployCard.tsx` | Model dropdown visible for all providers; resets model on provider switch              | None — custom |

---

## Dashboard UI Refinements & SearXNG Engine Audit (2026-03-21)

**Purpose:** UI polish for the deployment flow and correction of SearXNG engine IDs for the 2026.3.x engine line.

| File | Change                        |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| +    | `SearxngEngineSelector.tsx`   | **Engine Audit**: Updated `stackoverflow` → `stackexchange`, `youtube` → `youtube_noapi`, and fixed `apple maps` (no underscore). |
| +    | `NaturalVoiceToggle.tsx`      | Removed "Experimental" tag; simplified labels; improved layout.                                                                   |
| +    | `InlineDeployCard.tsx`        | Provider pills switched from 4-col to 2x2 grid for better mobile/desktop balance.                                                 |
| +    | `hetzner-instance-service.ts` | Model dropdown visible for all providers; resets model on provider switch.                                                        |
| +    | `agent-env.ts`                | Wires `byteroverGeminiKey` to `GEMINI_API_KEY`; auto-enables `OPENCLAW_VIDEO_ENABLED`.                                            |

---

## Dashboard UI Improvements (2026-03-20)

| File                                      | Change                                                                       | Sync Risk       |
| ----------------------------------------- | ---------------------------------------------------------------------------- | --------------- |
| `src/components/.../InlineDeployCard.tsx` | Model dropdown visible for all providers; model reset on provider switch     | None — custom   |
| `src/app/.../CredentialVault.tsx`         | Added `restartFlow` callback + Restart Flow button on error/cancelled states | None — custom   |
| `ui/src/ui/chat/message-normalizer.ts`    | `[SYSTEM: ...]` messages stripped from rendered chat                         | Low — custom UI |

---

## Personality, Voice & Humor Enhancements + Codebase Hardening (2026-03-20)

**Purpose:** Integrate humor training guide, enhance business mode voice, add Natural Voice system, fix IDENTITY.md detection bug, harden Zod schemas, bridge config env vars.

| File                                                 | Change                                                                                                                                                                                                   | Sync Risk       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `src/agents/system-prompt.ts`                        | Business mode SOUL guidance rewritten with voice/personality language. IDENTITY.md precedence over SOUL.md. Natural Voice section includes humor guide. Bug fix: case-insensitive IDENTITY.md detection. | Medium          |
| `src/agents/workspace.ts`                            | Added `DEFAULT_HUMOR_GUIDE_FILENAME` + `THE_ART_OF_BEING_FUNNY.md` to bootstrap pipeline                                                                                                                 | Medium          |
| `docs/reference/templates/THE_ART_OF_BEING_FUNNY.md` | **NEW** — Humor training guide (joke mechanics, comedy types, AI failure modes)                                                                                                                          | None — new      |
| `docs/reference/templates/openclaw-human-v1.md`      | Expanded human voice patterns (+97 lines)                                                                                                                                                                | None — template |
| `docs/reference/templates/openclaw-business-v1.md`   | Rebalanced: reduced dry operational text, added personality guidance (+142/−95)                                                                                                                          | None — template |
| `ui/src/ui/chat/message-normalizer.ts`               | Enhanced `stripMetadata()` for `[SYSTEM: ...]` prefixed messages                                                                                                                                         | Low — custom UI |
| `src/agents/system-prompt.test.ts`                   | +5 tests for personality features                                                                                                                                                                        | None — test     |

> **Sync Risk:** `workspace.ts` and `system-prompt.ts` are the highest risk — additive blocks in existing functions. Zod schema changes are additive. Template/config/UI files are custom.

---

## Memory Maintenance Cleanup (2026-03-20)

**Purpose:** Performance, correctness, and test coverage fixes for memory maintenance.

| File                                      | Change                                                                                      | Sync Risk     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- |
| `src/cron/proactive-disk-hygiene.ts`      | Hoisted `discoverAgentWorkspaceDirs()` to run once (was called twice). Combined phases 2/3. | None — custom |
| `src/memory/memory-file-rotator.ts`       | Removed duplicate log prefix; added `Number.isNaN` guard for invalid dates                  | None — custom |
| `src/cron/proactive-disk-hygiene.test.ts` | +1 test for stale memory entries                                                            | None — test   |
| `src/memory/memory-file-rotator.test.ts`  | +2 tests for mixed empty/non-empty files, invalid date filenames                            | None — test   |

---

## Cron Defense — Self-Healing Agent Tool, Remediation Journal & Watchdog (2026-03-20)

**Purpose:** Agents can autonomously diagnose, fix, and monitor cron issues via `cron_heal` tool. All actions auditable via append-only remediation journal, with automatic rollback and human escalation.

### Remediation Infrastructure

| File                               | Change                                                                                                                   | Sync Risk      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `src/cron/remediation-journal.ts`  | **NEW** — Append-only JSONL journal with entry CRUD, pruning, history filtering                                          | None — new     |
| `src/cron/remediation-watchdog.ts` | **NEW** — Timer-tick watchdog (5-min throttle). Confirms fixes, rolls back re-failed jobs, escalates after max attempts. | None — new     |
| `src/config/types.cron.ts`         | Added `remediationRetentionDays`, `remediationWatchdogMinutes`, `remediationMaxAttempts`, `seedSystemJobs`               | Low — additive |
| `src/cron/service/timer.ts`        | Integrated `runRemediationWatchdog()` in `finally` block after disk hygiene sweep                                        | Medium         |

> **Sync Risk:** `timer.ts` — static import + 40-line watchdog integration in `finally` block. May need manual re-application if upstream modifies the maintenance section.

### Agent Self-Healing Tool

| File                                 | Change                                                                                                                                    | Sync Risk      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/agents/tools/cron-heal-tool.ts` | **NEW** — `cron_heal` tool with 7 actions: `diagnose`, `re-enable`, `adjust-schedule`, `force-run`, `cleanup-disk`, `rollback`, `journal` | None — new     |
| `src/agents/openclaw-tools.ts`       | Registered `createCronHealTool()`                                                                                                         | Low — additive |
| `src/agents/moltbot-tools.ts`        | Registered `createCronHealTool()`                                                                                                         | Low — additive |
| `src/agents/system-prompt.ts`        | Added `cron_heal` to `coreToolSummaries` and `toolOrder`                                                                                  | Low — additive |

### Proactive Disk Hygiene & Health Probes

| File                                 | Change                                                                                 | Sync Risk     |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------- |
| `src/cron/proactive-disk-hygiene.ts` | **NEW** — Memory file rotation, stale memory detection, workspace disk scan            | None — new    |
| `src/memory/memory-file-rotator.ts`  | **NEW** — Archives dated memory entries (>3 months), handles malformed dates           | None — new    |
| `src/cron/cron-health-probe.ts`      | **NEW** — Detects disabled/broken/stale cron jobs, generates structured health reports | None — new    |
| `src/cron/service/timer.ts`          | Integrated `runDiskHygieneSweep()` + `runCronHealthProbe()` in timer tick              | Medium        |
| `enforce-config.mjs`                 | Added `cron-health` system job to auto-seed; seed control via `seedSystemJobs` config  | None — custom |

> **Sync Risk:** `timer.ts` — 30-line addition to `collectRunnableJobs()` with new import. May need manual re-application if upstream modifies this function.

---

## Diary Continuity Fix (2026-03-20)

**Purpose:** Fix race condition between deterministic diary archiver and cron-based continuity summary generation. Archive marker was missing when the post-archive job ran.

| File                        | Change                                                                            | Sync Risk     |
| --------------------------- | --------------------------------------------------------------------------------- | ------------- |
| `src/cron/diary-archive.ts` | Fixed archive marker timing to ensure it's written before post-archive cron fires | None — custom |

---

## Codebase Cleanup & Audit (2026-03-20)

**Purpose:** Comprehensive audit of all modified files — performance, security, refactoring, and test coverage improvements.

| File                                  | Change                                                              | Sync Risk     |
| ------------------------------------- | ------------------------------------------------------------------- | ------------- |
| `src/agents/sandbox/browser-sweep.ts` | Extracted `pullBrowserImage()` as reusable; improved error messages | None — custom |
| `src/cron/pre-reset-flush.ts`         | Tightened eligibility guard, improved logging                       | None — custom |
| `src/security/content-scanner.ts`     | Optimized regex compilation (lazy init)                             | None — custom |
| `src/logging/event-log.ts`            | Added rotation cap, fixed file handle leak                          | None — custom |

---

## Idle-Aware Cron Scheduling & Frequency Override (2026-03-19)

**Purpose:** Cron jobs skip execution when the agent has been idle (no user messages for configurable duration). Agents can override their own schedule via `NEXT_WAKE:` directives.

| File                        | Change                                                                    | Sync Risk      |
| --------------------------- | ------------------------------------------------------------------------- | -------------- |
| `src/cron/service/timer.ts` | Added idle-awareness check before job execution; `idleThresholdMs` config | Medium         |
| `src/config/types.cron.ts`  | Added `idleThresholdMinutes` config field                                 | Low — additive |
| `enforce-config.mjs`        | Default idle threshold wired from env var                                 | None — custom  |

> **Sync Risk:** `timer.ts` — idle-awareness adds a check in `collectRunnableJobs()`. If upstream restructures job eligibility logic, re-apply.

---

## Memory-Unified Search Upgrade — Source-Aware Ranking & Temporal Decay (2026-03-19)

**Purpose:** Enhanced `memory_search` with source-type ranking (diary > identity > general), temporal decay scoring, and configurable result limits.

| File                                     | Change                                                                                          | Sync Risk      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `src/memory/search.ts`                   | Source-aware ranking with configurable weights; temporal decay function; result limit parameter | Medium         |
| `src/memory/search.test.ts`              | Tests for ranking, decay, limits                                                                | None — test    |
| `src/agents/tools/memory-search-tool.ts` | Exposed `limit` and `sourceFilter` parameters                                                   | Low — additive |

---

## MetaClaw Integration & Alignment Drift Scoring (2026-03-19)

**Purpose:** Self-monitoring system that tracks how well the agent's behavior aligns with its SOUL.md principles over time. Generates alignment scores and drift alerts.

| File                          | Change                                                                             | Sync Risk      |
| ----------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| `src/agents/metaclaw.ts`      | **NEW** — Alignment drift scorer with principle extraction and behavioral analysis | None — new     |
| `src/agents/metaclaw.test.ts` | **NEW** — Tests for scoring, drift detection                                       | None — test    |
| `src/agents/system-prompt.ts` | MetaClaw status injected into prompt when enabled                                  | Low — additive |

---

## Lossless Claw Context Engine — v0.4.0 Auto-Update (2026-03-19)

**Purpose:** Auto-update LCM plugin to latest version from prebaked image. `enforceLCM()` is now version-aware.

| File                 | Change                                                            | Sync Risk     |
| -------------------- | ----------------------------------------------------------------- | ------------- |
| `enforce-config.mjs` | `enforceLCM()` checks version, auto-upgrades from prebaked source | None — custom |

---

## SearXNG & Scrapling Sidecar Integration (2026-03-19)

**Purpose:** Add SearXNG (meta-search) and Scrapling (stealth web scraping) as Docker sidecars. SearXNG replaces API-based search; Scrapling provides anti-detection web fetching.

| File                             | Change                                                                            | Sync Risk      |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| `src/agents/tools/web-search.ts` | Added `runSearxngSearch()` provider with category/engine routing                  | Low — additive |
| `src/agents/tools/web-fetch.ts`  | Added `fetchWithScrapling()` with stealth mode, timeout, fallback to native fetch | Low — additive |
| `src/config/types.tools-web.ts`  | Added `searxng` and `scrapling` config types                                      | Low — additive |
| `enforce-config.mjs`             | Wires `SEARXNG_BASE_URL` and `SCRAPLING_BASE_URL` from env into config            | None — custom  |
| `docker-compose.yml`             | Added `searxng` and `scrapling` services                                          | None — custom  |

---

## Security Skills — Prompt Guard, ClawScan & AgentGuard (2026-03-19)

**Purpose:** Three security modules: prompt injection scanning on all inputs, workspace file scanning for secrets/malware patterns, and deployment security auditing.

| File                           | Change                                                                | Sync Risk      |
| ------------------------------ | --------------------------------------------------------------------- | -------------- |
| `src/security/prompt-guard.ts` | **NEW** — Prompt injection scanner (40+ patterns, risk scoring)       | None — new     |
| `src/security/claw-scan.ts`    | **NEW** — File-level secret detection, PII scanning                   | None — new     |
| `src/security/agent-guard.ts`  | **NEW** — Deployment audit (secret redaction, security event journal) | None — new     |
| `src/agents/system-prompt.ts`  | Security policy injected per channel context type                     | Low — additive |

---

## Memory Maintenance Automation (2026-03-19)

**Purpose:** Automated memory file management: rotation of dated entries, stale content detection, and proactive disk hygiene.

| File                                 | Change                                                    | Sync Risk  |
| ------------------------------------ | --------------------------------------------------------- | ---------- |
| `src/cron/proactive-disk-hygiene.ts` | **NEW** — Scheduled workspace disk scan + memory rotation | None — new |
| `src/memory/memory-file-rotator.ts`  | **NEW** — Archives old dated entries, preserves structure | None — new |
| `src/cron/service/timer.ts`          | Integrated disk hygiene sweep into timer tick             | Medium     |

> **Sync Risk:** `timer.ts` — sweep integrated in the maintenance section of the timer tick. If upstream restructures the maintenance phase, re-apply.

---

## Auto-Research & ACE-Inspired Features (2026-03-19)

**Purpose:** Agent resilience features: autonomous problem-solving, failure-driven skill evolution, self-delegation guidance, and evidence counters.

| File                          | Change                                                       | Sync Risk      |
| ----------------------------- | ------------------------------------------------------------ | -------------- |
| `src/agents/system-prompt.ts` | Self-Delegation Guidance section; evidence counter prompting | Low — additive |

---

## BrainX Integration (2026-03-18)

**Purpose:** Extended context engine providing deep reasoning capabilities and structured knowledge synthesis.

| File                   | Change                             | Sync Risk  |
| ---------------------- | ---------------------------------- | ---------- |
| `src/memory/brainx.ts` | **NEW** — BrainX integration layer | None — new |

---

## Comprehensive Cleanup & Refactoring (2026-03-15)

**Purpose:** Multi-file cleanup focusing on DRY violations, dead code, and consistency.

| File                               | Change                                                                                                     | Sync Risk  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| `src/agents/workspace.ts`          | Extracted `stripConditionalBlock()` helper (−80 lines); consolidated 3 identical block-stripping functions | Medium     |
| `src/agents/tools/web-fetch.ts`    | Extracted shared content scanning pattern via `scanAndLog()`                                               | Low        |
| `src/agents/tools/browser-tool.ts` | Same `scanAndLog()` pattern                                                                                | Low        |
| `src/cron/isolated-agent/run.ts`   | Same `scanAndLog()` pattern                                                                                | Low        |
| `src/security/scan-and-log.ts`     | **NEW** — DRY wrapper for scan + log + warn (~100 lines of boilerplate eliminated)                         | None — new |

---

## Progressive Disclosure for Skills (2026-03-14)

**Purpose:** Skills presented compactly in context (name + description only), full SKILL.md loaded on demand. Reduces system prompt bloat.

| File                          | Change                                                                | Sync Risk      |
| ----------------------------- | --------------------------------------------------------------------- | -------------- |
| `src/agents/system-prompt.ts` | Skills section uses compact format; full content loaded via tool call | Low — additive |

---

## Workspace Context Security Scanning (2026-03-13)

**Purpose:** Scan all external inputs (web fetches, browser snapshots, cron hooks) for prompt injection before they enter agent context.

| File                               | Change                                               | Sync Risk      |
| ---------------------------------- | ---------------------------------------------------- | -------------- |
| `src/agents/tools/web-fetch.ts`    | `scanAndLog()` on all fetched content                | Low — additive |
| `src/agents/tools/browser-tool.ts` | `scanAndLog()` on browser snapshots + console output | Low — additive |
| `src/cron/isolated-agent/run.ts`   | `scanAndLog()` on external hook content              | Low — additive |

---

## OpenClaw Backup System (2026-03-12)

**Purpose:** Comprehensive backup/restore system using Supabase Storage. Automated cron backups, manual trigger, dashboard UI, one-click restore.

| File                            | Change                                                          | Sync Risk     |
| ------------------------------- | --------------------------------------------------------------- | ------------- |
| `src/backup/backup-manager.ts`  | **NEW** — Backup orchestrator (tar.gz to Supabase Storage)      | None — new    |
| `src/backup/restore-manager.ts` | **NEW** — Restore from Supabase with path sandboxing            | None — new    |
| `enforce-config.mjs`            | `backup-auto` cron job seeding; `MOLTBOT_BACKUP_ENABLED` gating | None — custom |
| `docker-entrypoint.sh`          | Backup env vars wired from dashboard                            | None — custom |

---

## Failure-Driven Skill Evolution (2026-03-11)

**Purpose:** Agents autonomously create skill documents from repeated failures, building institutional knowledge.

| File                                    | Change                                                                                             | Sync Risk      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| `src/agents/tools/skill-manage-tool.ts` | **NEW** — CRUD for agent-created skills (workspace/skills/), 10KB limit, human-authored protection | None — new     |
| `src/agents/system-prompt.ts`           | Skill Auto-Creation guidance section                                                               | Low — additive |

---

## Workspace Auto-Indexing & `workspace_search` Tool (2026-03-10)

**Purpose:** Workspace-aware search distinct from personal memory. Auto-indexes workspace root on boot; `workspace_search` searches only workspace-kind collections.

| File                                        | Change                                                                                                 | Sync Risk      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| `src/memory/types.ts`                       | Added `"workspace"` to `MemorySource` union                                                            | Medium         |
| `src/memory/qmd-manager.ts`                 | `bootstrapCollections` maps `kind=workspace` → `source=workspace`                                      | Medium         |
| `src/memory/backend-config.ts`              | Added `resolveDefaultWorkspaceCollection()` and `resolveWorkspacePaths()`                              | Medium         |
| `src/agents/tools/workspace-search-tool.ts` | **NEW** — `createWorkspaceSearchTool()` for workspace-only search                                      | None — new     |
| `src/agents/tool-catalog.ts`                | Added `workspace_search` entry                                                                         | Low — additive |
| `src/agents/system-prompt.ts`               | Memory section updated to mention `workspace_search`; business-mode KB instructions mandate both tools | Low            |

> **Sync Risk:** `types.ts` — `MemorySource` union is actively maintained upstream; check for new source kinds that conflict with `"workspace"`. `qmd-manager.ts` — `bootstrapCollections` and `ensureCollectionPath` are core memory infrastructure; if upstream restructures these, workspace collection registration needs re-wiring. `backend-config.ts` — `resolveMemoryBackendConfig` and `ResolvedQmdCollection` are extended; check for upstream changes to `kind` discriminator.
>
> **Business mode gating:** `workspace_search` only appears when `OPENCLAW_BUSINESS_MODE_ENABLED=true` AND QMD backend is active.

---

## Docker QMD Find Path Fix (2026-03-10)

| File         | Change                                                                                                     | Sync Risk     |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------- |
| `Dockerfile` | Broadened QMD source detection from `/root/.bun/...` to full filesystem search (excluding `/proc`, `/sys`) | None — custom |

---

## Remove Slim Docker Build Variant (2026-03-09)

| File                                   | Change                                                                                             | Sync Risk        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `.github/workflows/docker-release.yml` | Removed slim tag resolution and slim build-push step (doubled CI time for negligible size savings) | None — custom CI |

---

## Hermes-Inspired Features — Trajectory Compression, Session Search & Skill Auto-Creation (2026-03-09)

**Purpose:** Three features inspired by Hermes Agent: trajectory compression for session summaries, FTS5 keyword search for conversation history, and autonomous skill document management.

| File                                              | Change                                                                                             | Sync Risk  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| `src/auto-reply/reply/trajectory-compressor.ts`   | **NEW** — Sync + async (LLM) trajectory compression. Protects first/last turns, compresses middle. | None — new |
| `src/auto-reply/reply/session-context-summary.ts` | Uses `compressTrajectorySync`; optional LLM upgrade (fire-and-forget)                              | Low        |
| `src/auto-reply/reply/session-search.ts`          | **NEW** — SQLite FTS5 keyword search of past conversations, LIKE-based fallback                    | None — new |
| `src/agents/tools/session-search-tool.ts`         | **NEW** — `createSessionSearchTool()` (sub-agents restricted to own sessions)                      | None — new |
| `src/agents/tools/skill-manage-tool.ts`           | **NEW** — `createSkillManageTool()` with CRUD, 10KB limit, human-authored protection               | None — new |
| `src/agents/openclaw-tools.ts`                    | Registered `session_search` and `skill_manage` tools                                               | Low        |
| `src/agents/tool-catalog.ts`                      | Added both tool entries                                                                            | Low        |
| `src/agents/system-prompt.ts`                     | Added both tools to `coreToolSummaries` + `toolOrder` + Skill Auto-Creation guidance               | Low        |
| `src/auto-reply/reply/session.ts`                 | Hooked `indexTranscriptForSearch` into session reset flow                                          | Low        |

---

## Business Mode — Operator OS™ Integration (2026-03-09)

**Purpose:** Toggleable business partner mode with 22KB guide, 64 knowledge documents (8 categories), SOUL.md integration, and system prompt injection.

### Server (moltbotserver-source)

| File                                               | Change                                                                                                                              | Sync Risk       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `src/agents/workspace.ts`                          | `resolveBusinessModeEnabled()`, `stripConditionalBlock()` helper, `copyDirectoryRecursive()`, business mode seeding/deletion blocks | Low             |
| `src/agents/system-prompt.ts`                      | `hasBusinessModeFiles` detection + 12-line partner mode injection                                                                   | Low             |
| `docs/reference/templates/SOUL.md`                 | Added `<!-- if-business-mode -->` conditional block                                                                                 | None — template |
| `docs/reference/templates/openclaw-business-v1.md` | **NEW** — 22KB business partner guide                                                                                               | None — new      |
| `docs/reference/templates/business/`               | **NEW** — 64 knowledge documents across 8 categories                                                                                | None — new      |

### Dashboard (moltbot-dashboard)

| File                                           | Change                                                                       | Sync Risk     |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| `src/app/.../SettingsModal.tsx`                | Business Mode tab with toggle + two-step disable                             | None — custom |
| `src/app/.../actions.ts`                       | `businessModeEnabled` + `businessDeleteFiles` config pipeline                | None — custom |
| `src/app/api/instances/[id]/settings/route.ts` | GET/PATCH for business mode settings                                         | None — custom |
| `src/lib/services/instance-env.ts`             | `OPENCLAW_BUSINESS_MODE_ENABLED` + `OPENCLAW_BUSINESS_DELETE_FILES` env vars | None — custom |

> **Design:** Defaults OFF. File seeding uses `writeFileIfMissing`. Two-step disable (toggle off → optional file deletion). `businessDeleteFiles` is transient (consumed once on redeploy).

---

## Browser Control Resilience — Parallel Profiles, Health Checks & Auto-Restart (2026-03-06)

| File                            | Change                                                                                   | Sync Risk     |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| `src/browser/server-context.ts` | `listProfiles()` serial loop → `Promise.all` (7×500ms → ~500ms)                          | Medium        |
| `src/browser/client.ts`         | `browserProfiles` timeout 3000 → 5000ms                                                  | Low           |
| `hetzner-instance-service.ts`   | Docker healthcheck (curl CDP every 30s) + `mem_limit: 512m` + `browser-watchdog.sh` cron | None — custom |

> **Sync Risk:** `server-context.ts` — `listProfiles` is actively maintained upstream. The change replaces the body of a `for` loop with `Promise.all`.

---

## Managed Platform Mode Gating (2026-03-05)

**Purpose:** Gate SaaS security bypasses behind `OPENCLAW_MANAGED_PLATFORM=1` so community self-hosters get full security.

| File                   | Change                                                                                                                       | Sync Risk     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `docker-entrypoint.sh` | Removed hardcoded `OPENCLAW_MANAGED_PLATFORM=1`; gated auto-onboard and auto-approve behind env var                          | None — custom |
| `enforce-config.mjs`   | Gated `dangerouslyDisableDeviceAuth` + `dangerouslyAllowHostHeaderOriginFallback`; added security audit cron for non-managed | None — custom |

---

## Chromium Stealth Hardening & Playwright Anti-Detection (2026-03-05)

**Purpose:** Reduce browser detectability via Docker/Chrome-level hardening and Playwright JavaScript evasions.

### Layer 1 — Docker & Chrome Flags

| File                                    | Change                                                                                     | Sync Risk     |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `Dockerfile.sandbox-browser`            | Added fonts-noto, fonts-dejavu-core, fonts-freefont-ttf                                    | None — custom |
| `scripts/sandbox-browser-entrypoint.sh` | Xvfb 1920x1080, WebGL on, `--disable-blink-features=AutomationControlled`, TZ/UA overrides | None — custom |
| `hetzner-instance-service.ts`           | `hetznerLocationToTimezone()` helper; TZ/LANG env vars in compose                          | None — custom |

### Layer 2 — Playwright Stealth Scripts

| File                             | Change                                                                                                                   | Sync Risk  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `src/browser/stealth-scripts.ts` | **NEW** — 8 evasion scripts (webdriver, plugins, languages, chrome.runtime, notifications, WebGL, window.chrome, iframe) | None — new |
| `src/browser/pw-session.ts`      | `context.addInitScript(getStealthScript())` in `observeContext()`                                                        | Low        |

---

## Browser Startup Sweep — Auto-Update Stale Containers (2026-03-05)

**Purpose:** Auto-update sandbox browser containers to latest image on gateway start. Compares image digests, recreates stale containers.

| File                                  | Change                                                                       | Sync Risk     |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| `src/agents/sandbox/browser-sweep.ts` | **NEW** — `sweepStaleBrowserContainers()` with pull, inspect, recreate logic | None — new    |
| `src/agents/sandbox/docker.ts`        | Added `readDockerImageId()` and `readDockerContainerImageId()`               | Low           |
| `src/gateway/server-startup.ts`       | Fire-and-forget sweep call in `startGatewaySidecars()`                       | Low           |
| `docker-compose.yml`                  | Added `OPENCLAW_DOCKER_NETWORK` env var to gateway                           | None — custom |

---

## SQL Tool Integration — `sql_query` & `sql_execute` (2026-03-05)

**Purpose:** Direct SQL access: `sql_query` for read-only memory index queries; `sql_execute` for read-write custom SQLite databases in workspace.

| File                           | Change                                                                              | Sync Risk  |
| ------------------------------ | ----------------------------------------------------------------------------------- | ---------- |
| `src/agents/tools/sql-tool.ts` | **NEW** — Both tool factories with path sandboxing, statement blocking, result caps | None — new |
| `src/agents/openclaw-tools.ts` | Registered both SQL tools                                                           | Low        |
| `src/agents/tool-catalog.ts`   | Added entries in memory section (coding profile)                                    | Low        |

---

## Typing TTL "Still Thinking" Callback (2026-03-03)

**Purpose:** Send "⏳ Still thinking, hang tight..." when LLM tool calls exceed the 2-min typing indicator TTL.

| File                                       | Change                                          | Sync Risk |
| ------------------------------------------ | ----------------------------------------------- | --------- |
| `src/auto-reply/reply/typing.ts`           | Added `onTtlExpired` callback                   | Medium    |
| `src/auto-reply/reply/reply-dispatcher.ts` | Default sends status message via `deliver`      | Medium    |
| `src/auto-reply/reply/get-reply.ts`        | Wires callback through reply pipeline           | Medium    |
| `src/auto-reply/dispatch.ts`               | Forwards `onTtlExpired` from dispatcher         | Medium    |
| `src/auto-reply/types.ts`                  | Added `onTtlExpired` field on `GetReplyOptions` | Medium    |

> **Sync Risk:** Five upstream auto-reply files touched with small additions (new optional field + callback plumbing). Each change is a few lines — conflicts will be straightforward single-line resolves if upstream modifies these signatures.

---

## Browser Auto-Download to Agent Workspace (2026-03-02)

**Purpose:** Files downloaded via browser tool automatically saved to `workspace/downloads/`.

| File                                         | Change                                                                      | Sync Risk  |
| -------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| `src/browser/download-workspace-registry.ts` | **NEW** — Per-CDP-URL workspace registry + `sanitizeAutoDownloadFilename()` | None — new |
| `src/browser/control-service.ts`             | Registers per-profile workspace paths                                       | Medium     |
| `src/browser/pw-tools-core.interactions.ts`  | Auto-download capture on click (3s download race)                           | Medium     |
| `src/browser/pw-tools-core.downloads.ts`     | Uses shared sanitizer                                                       | Medium     |
| `src/browser/pw-session.ts`                  | `findPageByTargetId` uses `fetchJson` for Docker Host header compatibility  | Medium     |

> **Sync Risk:** `control-service.ts`, `pw-tools-core.interactions.ts`, `pw-tools-core.downloads.ts`, and `pw-session.ts` are actively maintained upstream. The `pw-session.ts` change replaces `fetch()` with `fetchJson()` — same fix pattern as the CDP Host header work.

---

## Per-Agent OAuth Isolation (2026-03-02)

**Purpose:** OAuth tokens scoped per-agent instead of shared. Removed `adoptNewerMainOAuthCredential()` and main-agent fallback.

| File                                       | Change                                                           | Sync Risk |
| ------------------------------------------ | ---------------------------------------------------------------- | --------- |
| `src/agents/auth-profiles/oauth.ts`        | Removed credential adoption (~37 lines) and fallback (~22 lines) | **High**  |
| `src/cli/program/register.onboard.ts`      | Added `--agent <agentId>` and `--sync-all` CLI flags             | Medium    |
| `src/commands/auth-choice.apply.openai.ts` | `syncSiblingAgents` default `true` → opt-in                      | Medium    |
| `src/commands/configure.gateway-auth.ts`   | Added `agentDir?` parameter to `promptAuthConfig()`              | Medium    |
| `src/commands/onboard-types.ts`            | Added `syncSiblingAgents` and `targetAgentId` fields             | Medium    |

> **Sync Risk:** `oauth.ts` — **~60 lines removed** from an actively-maintained upstream file. Upstream may add new credential-sharing logic that conflicts. CLI/commands — small additions to option definitions that upstream may extend.

---

## Heartbeat Default Interval: 30m → 1h (2026-03-02)

| File                                 | Change                                           | Sync Risk |
| ------------------------------------ | ------------------------------------------------ | --------- |
| `src/auto-reply/heartbeat.ts`        | `DEFAULT_HEARTBEAT_EVERY` from `"30m"` to `"1h"` | Low       |
| `src/config/types.agent-defaults.ts` | Updated JSDoc comment                            | Low       |

---

## Telegram Media Download Timeout (2026-03-01)

**Purpose:** 15-second timeout on `resolveMedia` to prevent hung downloads from blocking media groups.

| File                           | Change                                                                                                                            | Sync Risk |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `src/telegram/bot-handlers.ts` | `Promise.race` with `MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000`; timeout treated as recoverable; replaced swallowed catches with logging | Medium    |

> **Sync Risk:** `bot-handlers.ts` is actively maintained upstream. Changes are localized (timeout wrapping + error classification) but touch the media processing hot path.

---

## NEXT_WAKE Parsing Fix (2026-03-02)

**Purpose:** Parse `NEXT_WAKE:` from full `outputText` instead of truncated `summary`. Added main session job support.

| File                        | Change                                                               | Sync Risk |
| --------------------------- | -------------------------------------------------------------------- | --------- |
| `src/cron/service/timer.ts` | Reads from `outputText`; main session jobs parse from static payload | Medium    |

> **Sync Risk:** `timer.ts` is core cron infrastructure. Changes are in the MoltBot-custom `parseNextWakeDuration` function and its call sites.

---

## Alibaba Cloud / Bailian Provider (2026-03-01)

| File                     | Change                                                                                                                    | Sync Risk     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `enforce-config.mjs`     | Bailian provider config + model normalization; removed `healthcheck-security-audit` cron (redundant with scanner modules) | None — custom |
| `cron/default-jobs.json` | Removed `healthcheck-security-audit` job                                                                                  | None — custom |

---

## Gateway Self-Restart & Rate Limit Enforcement (2026-02-28)

| File                   | Change                                                       | Sync Risk     |
| ---------------------- | ------------------------------------------------------------ | ------------- |
| `docker-entrypoint.sh` | Gateway self-restart support for managed-platform containers | None — custom |
| `enforce-config.mjs`   | Added `gateway.auth.rateLimit` enforcement                   | None — custom |

---

## Self-Audit-21 Weekly Job & agentId Browser Fix (2026-02-28)

| File                           | Change                                                            | Sync Risk     |
| ------------------------------ | ----------------------------------------------------------------- | ------------- |
| `cron/default-jobs.json`       | Added `self-audit-21` job (Sun 11 PM)                             | None — custom |
| `enforce-config.mjs`           | Added to seed array + `MAIN_ONLY_JOBS`                            | None — custom |
| `src/agents/openclaw-tools.ts` | `agentId: resolveSessionAgentId()` added to `createBrowserTool()` | Low           |

---

## Gateway Browser Routing & Extension Ownership Fix (2026-02-28)

**Purpose:** Wire per-agent browser proxy into gateway router; fix extension folder ownership; fix noVNC auth for static assets and WebSocket.

| File                              | Change                                                                                    | Sync Risk     |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| `src/gateway/server-http.ts`      | Imported and wired `handleSandboxBrowserRequest` + `handleSandboxBrowserUpgrade`          | Low           |
| `src/gateway/sandbox-browsers.ts` | `isSensitiveBrowserPath()` — only entry pages require auth; static assets/WS pass through | None — custom |
| `docker-entrypoint.sh`            | `chown -R root:root "$CONFIG_DIR/extensions"` after global chown                          | None — custom |

---

## Run Gateway as Root & Fix npm Global Install (2026-02-28)

**Purpose:** Remove `gosu node` privilege drop — root inside container eliminates npm permission issues. Container isolation is the real security boundary.

| File                   | Change                                                           | Sync Risk     |
| ---------------------- | ---------------------------------------------------------------- | ------------- |
| `docker-entrypoint.sh` | Removed `gosu node`; added defensive `chown` for npm global dirs | None — custom |

---

## Nightly Innovation & Morning Briefing Cron Jobs (2026-02-28)

| File                     | Change                                                                                 | Sync Risk     |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------- |
| `cron/default-jobs.json` | Added `nightly-innovation` (2 AM) and `morning-briefing` (8 AM) with announce delivery | None — custom |
| `enforce-config.mjs`     | Added to seed array + `MAIN_ONLY_JOBS`                                                 | None — custom |

---

## Gateway Auto-Approve & Sub-Agent Cron Filtering (2026-02-28)

**Purpose:** Auto-approve device pairing in Docker containers; filter main-only cron jobs from sub-agents; seed `MEMORY.md` template.

| File                                   | Change                                                          | Sync Risk     |
| -------------------------------------- | --------------------------------------------------------------- | ------------- |
| `docker-entrypoint.sh`                 | Backgrounded device auto-approve loop before `exec`             | None — custom |
| `enforce-config.mjs`                   | `MAIN_ONLY_JOBS` set + `excludeNames` param in `seedCronJobs()` | None — custom |
| `.agents/skills/create-agent/SKILL.md` | Step 10 rewritten for disk-based cron seeding                   | None — custom |
| `docs/reference/templates/MEMORY.md`   | **NEW** — Structured skeleton with section headers              | None — new    |
| `src/agents/workspace.ts`              | `MEMORY.md` seeding in `ensureAgentWorkspace()`                 | Low           |

---

## CDP Host Header Fix — Dual-Layer (2026-02-27)

**Purpose:** Fix CDP connection failures with Docker hostname URLs. Chromium 107+ rejects non-localhost Host headers; Node.js `fetch()` silently ignores Host overrides.

| File                                    | Change                                                                                                       | Sync Risk     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| `src/browser/cdp.helpers.ts`            | Added `httpRequestWithHostOverride()` using `http.request()` (bypasses fetch's forbidden header restriction) | **⚠️ HIGH**   |
| `src/browser/chrome.ts`                 | `fetchChromeVersion()` uses `fetchJson()` instead of direct `fetch()`                                        | **⚠️ HIGH**   |
| `scripts/cdp-host-proxy.py`             | **NEW** — Python HTTP+WS reverse proxy rewriting Host header                                                 | None — custom |
| `scripts/sandbox-browser-entrypoint.sh` | Python CDP proxy replaces socat                                                                              | None — custom |
| `Dockerfile.sandbox-browser`            | Added proxy script COPY                                                                                      | None — custom |

> **⚠️ Warning:** `cdp.helpers.ts` and `chrome.ts` are actively maintained upstream. This fix was silently overwritten by the v2026.2.23 merge and required re-application. See `LOCAL_PATCHES.md`.

---

## Architect-First Reinforcement, Memory Seeding & Sub-Agent Heartbeats (2026-02-27)

**Purpose:** Embed "think like an architect" throughout agent surfaces; seed structured memory files for all agents; enable sub-agent heartbeats.

| File                                                                       | Change                                                                                      | Sync Risk       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------- |
| `SOUL.md` / `AGENTS.md` / `OPERATIONS.md` / `BOOTSTRAP.md` / `IDENTITY.md` | Architect-first language reinforcement                                                      | None — custom   |
| `docs/reference/templates/PRACTICAL.md`                                    | Lightweight architect-first guidance                                                        | None — template |
| `src/agents/system-prompt.ts`                                              | Architect-first prompt injection                                                            | Low             |
| `src/agents/workspace.ts`                                                  | Seed `diary.md`, `self-review.md`, `open-loops.md`, `identity-scratchpad.md` for all agents | Low             |
| `enforce-config.mjs`                                                       | `heartbeat: {}` for sub-agents                                                              | None — custom   |

---

## noVNC Sandbox Browser Viewport Sizing (2026-02-27)

| File                                    | Change                                                                   | Sync Risk     |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| `scripts/sandbox-browser-entrypoint.sh` | Viewport sizing with `DISPLAY_WIDTH`/`DISPLAY_HEIGHT` + `-geometry` flag | None — custom |

---

## Fix: humanDelay Crash Loop (2026-02-26)

| File                 | Change                                                               | Sync Risk     |
| -------------------- | -------------------------------------------------------------------- | ------------- |
| `enforce-config.mjs` | Removed invalid `messages.humanDelay` config key (caused crash-loop) | None — custom |

---

## Human Mode Dual Env Var & Bootstrap Allowlist Fix (2026-02-26)

| File                                       | Change                                                                                          | Sync Risk     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------- |
| `src/agents/workspace.ts`                  | `resolveHumanModeEnabled()` checks both `OPENCLAW_HUMAN_MODE` and `OPENCLAW_HUMAN_MODE_ENABLED` | Low           |
| `src/agents/workspace.ts`                  | Added `howtobehuman.md` and `writelikeahuman.md` to `MINIMAL_BOOTSTRAP_ALLOWLIST`               | Low           |
| `enforce-config.mjs`                       | Updated bootstrap file refs to correct filenames                                                | None — custom |
| `docs/reference/templates/naturalvoice.md` | **DELETED** (955 lines) — replaced by two-file model                                            | N/A           |

---

## CI & Entrypoint Infrastructure (2026-02-26)

| File                                 | Change                                                    | Sync Risk        |
| ------------------------------------ | --------------------------------------------------------- | ---------------- |
| `.github/workflows/docker-build.yml` | `provenance: false` to fix GHCR push permissions          | None — custom CI |
| `docker-entrypoint.sh`               | `enforce-config all` as final step before gateway startup | None — custom    |

---

## Cron Seeding & System Prompt Alignment (2026-02-26)

| File                          | Change                                                                                               | Sync Risk     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| `enforce-config.mjs`          | Removed legacy `diary`/`identity-review` cron; updated to 3-tier jobs; legacy job disabling on patch | None — custom |
| `src/agents/system-prompt.ts` | Updated SOUL.md injection text (identity continuity, 3 growth axes, Ship of Theseus)                 | Low           |

---

## Human Voice System Restoration (2026-02-26)

**Purpose:** Restore three customizations lost during v2026.2.23 upstream rebase.

| File                          | Change                                                                         | Sync Risk |
| ----------------------------- | ------------------------------------------------------------------------------ | --------- |
| `src/agents/system-prompt.ts` | `hasHumanModeFiles` updated to detect `howtobehuman.md` + `writelikeahuman.md` | Low       |
| `src/agents/workspace.ts`     | Added `resolveHumanModeEnabled()` + `removeHumanModeSectionFromSoul()`         | Low       |

---

## Chromium Infobar Suppression (2026-02-25)

| File                                    | Change                                           | Sync Risk     |
| --------------------------------------- | ------------------------------------------------ | ------------- |
| `scripts/sandbox-browser-entrypoint.sh` | `--disable-infobars` in `ALLOW_NO_SANDBOX` block | None — custom |
| `src/browser/chrome.ts`                 | `--disable-infobars` in `noSandbox` block        | Low           |

---

## noVNC No-Auth Mode (2026-02-25)

| File                                    | Change                                                                              | Sync Risk     |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `scripts/sandbox-browser-entrypoint.sh` | `OPENCLAW_BROWSER_NOVNC_NO_AUTH` env var — when `1`, x11vnc runs without `-rfbauth` | None — custom |
| `hetzner-instance-service.ts`           | Sets env var in compose templates                                                   | None — custom |

---

## Merge Artifact Cleanup (2026-02-25)

**Purpose:** Remove duplicate declarations left by upstream rebase. ~225 lines of dead code removed, 5 broken test files fixed.

| File                                    | Duplicates Removed                  | Sync Risk |
| --------------------------------------- | ----------------------------------- | --------- |
| `src/security/audit-extra.sync.ts`      | 4 functions (55 lines)              | Low       |
| `src/agents/workspace.ts`               | 2 variables + 1 function (70 lines) | Low       |
| `src/config/io.ts`                      | 3 functions (49 lines)              | Low       |
| `src/agents/models-config.providers.ts` | 1 function (53 lines)               | Low       |

---

## Security & Observability Infrastructure (2026-02-25)

**Purpose:** Content scanning, structured event logging, data classification, and system health checks.

| File                                  | Purpose                                                                          | Sync Risk  |
| ------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| `src/security/content-scanner.ts`     | Two-stage content scanner (40+ patterns + optional frontier model), risk scoring | None — new |
| `src/logging/event-log.ts`            | Structured JSONL logger with PII redaction, log rotation, queryable history      | None — new |
| `src/security/data-classification.ts` | Three-tier classification (Confidential/Internal/Public) with PII detection      | None — new |
| `src/logging/diagnostics-toolkit.ts`  | System health checks (PID, ports, error rate, disk space)                        | None — new |
| `src/security/scan-and-log.ts`        | **NEW** — DRY `scanAndLog()` wrapper for scan + log + warn                       | None — new |

### Integration Points

| File                               | Integration                          | Sync Risk |
| ---------------------------------- | ------------------------------------ | --------- |
| `src/agents/tools/web-fetch.ts`    | Scanner on fetched content           | Low       |
| `src/agents/tools/browser-tool.ts` | Scanner on browser snapshots         | Low       |
| `src/cron/isolated-agent/run.ts`   | Scanner on cron hook content         | Low       |
| `src/agents/system-prompt.ts`      | Data sharing policy per channel type | Low       |

---

## Tool Loop Detection Enablement (2026-02-25)

| File                 | Change                                                                                                                  | Sync Risk     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| `enforce-config.mjs` | `tools.loopDetection.enabled = true` — enables upstream 3-detector system (generic repeat, poll-no-progress, ping-pong) | None — custom |

---

## Security & Performance Audit (2026-02-25)

| File                            | Change                                                                               | Sync Risk     |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `src/gateway/control-ui.ts`     | `fs.readFileSync()` → `fs.createReadStream()` (unblocked event loop)                 | Low           |
| `src/gateway/server-http.ts`    | `await` Control UI handlers                                                          | Low           |
| `dashboard/.../stripe/route.ts` | Active subscription verification on `handleSubscriptionDeleted` (race condition fix) | None — custom |

---

## Upstream Sync: v2026.2.23 (2026-02-24)

**286 upstream commits** merged. Highlights: ACP permission validation, `allowFrom` id-only default (breaking), sandbox fs-bridge policy, new providers (Kilo Gateway, Vertex AI for Claude), configurable `runTimeoutSeconds`, reasoning-leak suppression, 50+ test improvements.

**Conflict Resolution:** 46 take-upstream, 2 keep-local (`AGENTS.md`, `device-pair/index.ts`), 1 manual merge (`workspace.ts`). Fixed 6 pre-existing conflict markers.

---

## Lint Compliance Fixes (2026-02-24)

9 `oxlint --type-aware` errors resolved (2 source, 4 test files). All non-behavioral.

---

## Residential Proxy Support (2026-02-24)

| File                    | Change                                                                                                                           | Sync Risk |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `src/browser/chrome.ts` | `resolveProxyServer()` + `generateProxyAuthExtension()` for `PROXY_HOST`/`PROXY_PORT`/`PROXY_USERNAME`/`PROXY_PASSWORD` env vars | Low       |

---

## Browser Routing Deduplication Fix (2026-02-24)

| File                              | Change                                                                                        | Sync Risk     |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `src/gateway/sandbox-browsers.ts` | `listedIds` Set to prevent duplicate entries for agents with both static and dynamic browsers | None — custom |

---

## Entrypoint Duplicate Provisioning Removal (2026-02-24)

| File                   | Change                                                                                                                                                        | Sync Risk     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `docker-entrypoint.sh` | Removed `ensure_sandbox_browser_image()` (~30 lines) and `ensure_agent_browser_containers()` (~120 lines) — conflicted with docker-compose-managed containers | None — custom |

---

## Diary Startup Loading & Two-Phase Archive

**Purpose:** Load `diary.md` into bootstrap context (tail-heavy truncation), replace prompt-only diary archive with two-phase system: deterministic code archiver + LLM enrichment.

| File                                          | Change                                                                              | Sync Risk     |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `src/agents/workspace.ts`                     | `DEFAULT_DIARY_FILENAME`, bootstrap file entry                                      | Low           |
| `src/agents/pi-embedded-helpers/bootstrap.ts` | Diary-specific 12k char cap + tail-heavy truncation (30% head / 60% tail)           | Low           |
| `src/cron/diary-archive.ts`                   | **NEW** — Deterministic archiver (14-day timer, multi-agent sweep, idempotent)      | None — new    |
| `src/gateway/server-cron.ts`                  | Integrated archive timer                                                            | Low           |
| `cron/default-jobs.json`                      | `diary-archive` → `diary-post-archive` (LLM enrichment after deterministic archive) | None — custom |
| `enforce-config.mjs`                          | Updated seed for `diary-post-archive`                                               | None — custom |

---

## Managed Platform Update Guard

**Purpose:** Prevent self-updating via upstream npm/git. Updates delivered exclusively through Docker image pulls.

| File                                   | Change                                                          | Sync Risk     |
| -------------------------------------- | --------------------------------------------------------------- | ------------- |
| `docker-entrypoint.sh`                 | Exports `OPENCLAW_MANAGED_PLATFORM=1`; updated heartbeat prompt | None — custom |
| `src/gateway/server-methods/update.ts` | Guard at top of `update.run`                                    | Medium        |
| `src/cli/update-cli/update-command.ts` | Guard at top of `updateCommand()`                               | Medium        |
| `src/infra/update-startup.ts`          | Early return in `runGatewayUpdateCheck()`                       | Medium        |
| `OPERATIONS.md`                        | System updates section: never self-update                       | None — custom |

---

## Per-Agent Browser Isolation (`browser-only` Sandbox Mode)

**Purpose:** Named sub-agents get dedicated browser containers with separate sessions. Temporary helpers share main browser.

| File                                     | Change                                                                             | Sync Risk  |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| `src/agents/sandbox/types.ts`            | Added `"browser-only"` to `SandboxConfig.mode`                                     | Low        |
| `src/agents/sandbox/runtime-status.ts`   | `browser-only` treated like `non-main`                                             | Low        |
| `src/agents/sandbox/context.ts`          | Skips container+workspace for `browser-only`                                       | Low        |
| `src/agents/sandbox/config.ts`           | Auto-enables browser when `browser-only`                                           | Low        |
| `src/agents/sandbox/browser.ts`          | `docker network connect` after creation                                            | Low        |
| `src/config/types.agent-defaults.ts`     | Type alignment                                                                     | Low        |
| `src/config/types.agents.ts`             | Type alignment                                                                     | Low        |
| `src/config/zod-schema.agent-runtime.ts` | Zod schema accepts `browser-only`                                                  | Low        |
| `src/gateway/sandbox-browsers.ts`        | **NEW** — API + proxy handler for `/api/sandbox-browsers` and `/sbx-browser/:id/*` | None — new |
| `src/gateway/server-http.ts`             | Integrated sandbox browser handler                                                 | Low        |

---

## Static Per-Agent Browser Provisioning

**Purpose:** Auto-provisioned browser containers, Caddy routes, and browser profiles when agents are added.

| File                                        | Change                                                                                             | Sync Risk     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| `src/gateway/sandbox-browsers.ts`           | `handleListBrowsers` includes per-agent browsers from config profiles; `type` union adds `"agent"` | None — custom |
| `docker-entrypoint.sh`                      | `enforce_browser_profiles()` creates profiles + sets `defaultProfile`                              | None — custom |
| `dashboard/.../BrowserModal.tsx`            | Dynamic browser discovery from `/api/sandbox-browsers`                                             | None — custom |
| `dashboard/.../hetzner-instance-service.ts` | Removed hardcoded agents; installs `ensure-agent-browsers.sh`                                      | None — custom |

---

## Browser Tool Auto-Routing (`profile` Override)

**Purpose:** Auto-route sub-agent browser calls to dedicated containers even though agents always pass `profile="openclaw"`.

| File                               | Change                                                       | Sync Risk |
| ---------------------------------- | ------------------------------------------------------------ | --------- |
| `src/agents/tools/browser-tool.ts` | `agentId` opt; auto-override when agent has matching profile | Medium    |
| `src/agents/moltbot-tools.ts`      | Passes `resolveSessionAgentId()`                             | Low       |
| `src/agents/openclaw-tools.ts`     | Same                                                         | Low       |

---

## Browser Persistence (Volume Mount)

| File                          | Change                                                                                       | Sync Risk     |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `docker-compose.yml`          | `browser-home:/tmp/openclaw-home` volume; Docker socket mount; `OPENCLAW_DOCKER_NETWORK` env | None — custom |
| `sandbox/browser.ts`          | Named volume per sandbox browser (`${containerName}-profile`)                                | Low           |
| `hetzner-instance-service.ts` | PaaS template includes volumes; `ensureBrowserVolumeMigration()` helper                      | None — custom |

---

## CI Runner Replacement (Blacksmith → GitHub-hosted)

Replaced `blacksmith-*` third-party runners with `ubuntu-latest` / `windows-latest` in all 8 workflow files.

---

## Sansa AI Provider Integration

| File                                    | Change                                 | Sync Risk     |
| --------------------------------------- | -------------------------------------- | ------------- |
| `src/agents/models-config.providers.ts` | `buildSansaProvider()` + constants     | Low           |
| `src/agents/model-auth.ts`              | `sansa: "SANSA_API_KEY"` env key map   | Low           |
| `docker-entrypoint.sh`                  | `sansa-api` case in auth choice switch | None — custom |

---

## Pre-Reset Memory Flush (Cron)

**Purpose:** Memory flush ~20 minutes before daily session reset to persist durable memories before context discard.

| File                              | Change                                                                                        | Sync Risk  |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `src/cron/pre-reset-flush.ts`     | **NEW** — Timer computation, session eligibility, sweep logic (max 20 sessions, ≥2000 tokens) | None — new |
| `src/gateway/server-cron.ts`      | Integrated timer start/stop                                                                   | Low        |
| `src/config/sessions/types.ts`    | Added `preResetFlushAt?` for deduplication                                                    | Low        |
| `src/auto-reply/reply/session.ts` | Clears `preResetFlushAt` on reset                                                             | Low        |

---

## SOUL.md Rewrite

Restructured from philosophical essay (~300 lines) to concise actionable framework. Merged `PRACTICAL.md` content. New sections: Think First, Record Everything, Evolve and Reflect, Be Honest, Earn Trust. Removed `PRACTICAL.md` and all references.

---

## Human Voice System (Two-File Model)

Custom human voice templates (`howtobehuman.md` for philosophy, `writelikeahuman.md` for writing patterns) seeded when human mode enabled. System prompt detects files and injects voice protocol.

---

## Memory Templates

Structured memory file templates seeded into new workspaces: `self-review.md`, `diary.md`, `identity-scratchpad.md`, `open-loops.md`. Docker entrypoint seeds on first boot.

---

## Add-Agent Skill

`skills/add-agent/SKILL.md` (269 lines) — interactive onboarding flow for creating isolated team member agents with identity, workspace, channel binding, and cron jobs.

---

## AGENTS.md Multi-Account Channels

Added multi-account channel documentation to `AGENTS.md` and template with JSON examples.

---

## Docker Browser CI Workflow

Added `build-browser` job to `docker-build.yml` for `Dockerfile.sandbox-browser`. Custom entrypoint with optional VNC password, `OPENCLAW_BROWSER_NO_SANDBOX` support.

---

## Enforce-Config Enhancements

Extended `enforce-config.mjs` with `normalizeModelId()`, `resolveReflectionIntervals()`, and expanded `seedCronJobs()` for reflection system.

---

## Session Handling & Workspace Improvements

Various improvements to session initialization, workspace bootstrapping, and conditional template processing in `workspace.ts`.

---

## Telegram Config Migration (`allowlist` → `groupAllowFrom`)

Auto-migrates deprecated `allowlist` key to `groupAllowFrom` on container startup. Warns when `groupPolicy=allowlist` is set but `groupAllowFrom` is missing.

---

## Plugin Sanitizer — Stock Plugin Discovery Fix

Fixed `sanitize_config()` fallback plugin discovery missing `/app/extensions/` directory. Stock plugins (discord, telegram, etc.) were silently stripped on every restart.

---

## 3-Tier Reflection System + SOUL.md Overhaul (2026-02-25)

### Reflection Tiers

| Tier                   | Job ID          | Schedule               | Role                                                                   |
| ---------------------- | --------------- | ---------------------- | ---------------------------------------------------------------------- |
| **Self-Review**        | `self-review`   | Every 6h (fixed)       | HIT/MISS pattern tracker. Flags 3+ occurrences for CRITICAL promotion. |
| **Consciousness Loop** | `consciousness` | Dynamic (`NEXT_WAKE:`) | Free-form background thinking: diary, knowledge, identity evolution.   |
| **Deep Review**        | `deep-review`   | Every 48h (fixed)      | Comprehensive audit. Phase 0 Constitution Check against `SOUL.md`.     |

### Source Files

| File                            | Change                                                                     | Sync Risk  |
| ------------------------------- | -------------------------------------------------------------------------- | ---------- |
| `src/cron/service/timer.ts`     | `parseNextWakeDuration()` with clamping `[1h, 12h]`                        | Medium     |
| `src/memory/knowledge-index.ts` | **NEW** — Auto-index builder for `memory/knowledge/*.md`                   | None — new |
| `src/agents/workspace.ts`       | `preLoad` callback on `WorkspaceBootstrapFile` for knowledge index rebuild | Low        |
| `src/agents/system-prompt.ts`   | Stale IDENTITY.md health nudge (>72h mtime check)                          | Low        |

### Templates Updated

`SOUL.md` (Ouroboros ontological framing, 3 axes of becoming, Ship of Theseus protection, 7 Biblical principles), `HEARTBEAT.md` (Proactive Presence), `BOOT.md` (startup state verification), `OPERATIONS.md` (3-tier reflection docs).

### SOUL.md Biblical Principles

| Principle                    | Scripture        | Section                        |
| ---------------------------- | ---------------- | ------------------------------ |
| Slow to Speak, Swift to Hear | James 1:19       | Be Curious First               |
| The Ant                      | Proverbs 6:6-8   | Take Initiative                |
| Count the Cost               | Luke 14:28       | Think Architecturally          |
| Speaking Truth in Love       | Ephesians 4:15   | Be Honest and Direct           |
| Iron Sharpens Iron           | Proverbs 27:17   | Be Honest and Direct           |
| Parable of the Talents       | Matthew 25:14-30 | Earn Trust Through Stewardship |
| Bearing Fruit                | John 15:8        | Become                         |
