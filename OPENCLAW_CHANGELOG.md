# OPENCLAW_CHANGELOG.md — MoltBot Custom Modifications Log

This file is the complete record of all custom changes made to the OpenClaw source for the MoltBot platform.
For the upstream sync reference (what to preserve during merges), see `OPENCLAW_CONTEXT.md`.

---

## Memory Maintenance Automation — Proactive Disk Hygiene, File Rotation, Staleness Detection (2026-03-20)

**Purpose:** Automated memory maintenance pipeline to prevent disk bloat and stale memory accumulation. 4-phase implementation: proactive cleanup, daily→monthly memory archival, BrainX script orchestration, and dated-entry staleness detection.

### Phase 1 — Proactive Disk Hygiene Cron

| File                                      | Change                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cron/proactive-disk-hygiene.ts`      | **[NEW]** Self-throttled (6h default) sweep wrapper. Derives OpenClaw home from session store path via `resolveAgentsDirFromSessionStorePath()`, discovers agent workspaces, runs `runDiskCleanup()` + `rotateOldMemoryFiles()`. Configurable via `cronConfig.diskHygieneIntervalMs` (30-min minimum). |
| `src/cron/proactive-disk-hygiene.test.ts` | **[NEW]** 14 tests — interval resolution, OpenClaw dir derivation, throttling, old file cleanup, recent file preservation, edge cases                                                                                                                                                                  |
| `src/cron/service/timer.ts`               | **[MODIFIED]** Added `sweepProactiveDiskHygiene()` call in `finally` block (after session reaper sweeps). Error-wrapped, non-blocking.                                                                                                                                                                 |

### Phase 2 — Memory File Rotation

| File                                     | Change                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/memory/memory-file-rotator.ts`      | **[NEW]** Consolidates daily memory files (`memory/YYYY-MM-DD.md` >30 days old) into monthly archives (`memory/archive/YYYY-MM.md`). Groups by month, sorts chronologically, appends to existing archives. Self-throttled (24h). Empty files cleaned without archive creation. |
| `src/memory/memory-file-rotator.test.ts` | **[NEW]** 15 tests — grouping, sorting, archive creation/appending, recent file protection, non-date files, multi-month, throttling, empty/missing dirs                                                                                                                        |

### Phase 3 — BrainX Cron Orchestrator

| File                                   | Change                                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrainX/scripts/brainx-maintenance.sh` | **[NEW]** Shell orchestrator with 3 modes: `weekly` (cleanup + consolidation), `biweekly` (dedup + quality scoring), `all` (full suite). Configurable limits via `CONSOLIDATOR_LIMIT` / `SCORER_LIMIT`. Non-fatal per-script — continues on individual failures. |
| `BrainX/scripts/MANIFEST.md`           | **[MODIFIED]** Updated frequencies and added orchestrator entry                                                                                                                                                                                                  |

### Phase 4 — MEMORY.md Staleness Detection

| File                                          | Change                                                                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/memory/memory-staleness-scanner.ts`      | **[NEW]** Pure-function detector for dated entries in MEMORY.md older than configurable threshold (default 90 days). Handles `[YYYY-MM]`, `[YYYY-MM-DD]`, `(YYYY-MM)` formats. Deduplicates same-date entries. `formatStalenessSummary()` for system event emission. |
| `src/memory/memory-staleness-scanner.test.ts` | **[NEW]** 12 tests — date format detection, threshold behavior, deduplication, line numbers/snippets, summary formatting, edge cases                                                                                                                                 |

### Documentation

| File                  | Change                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `memory-hygiene.md`   | **[MODIFIED]** Added "Automated Maintenance" section documenting all 4 systems |
| `OPENCLAW_CONTEXT.md` | **[MODIFIED]** Added 7 new file entries + updated `timer.ts` entry             |

**Total new tests:** 41 (14 + 15 + 12). TypeScript type-check: ✓ (exit 0).

---

## Comprehensive Codebase Cleanup — Bug Fixes, Test Coverage, Orphan Removal (2026-03-20)

**Purpose:** Systematic audit of all recently modified files plus broader codebase scan. Fixed bugs, added missing test coverage, removed dead code and orphan files, aligned documentation.

### Bug Fixes

| File                                               | Fix                                                                                                                                                      | Severity |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/cron/cron-health-probes.ts`                   | **Operator precedence bug** in `checkAutoDisabledJobs()` — mixed `&&`/`                                                                                  |          | ` without grouping caused the filter to let enabled jobs with consecutive errors through. Added parentheses for correct intent. | Medium |
| `src/auto-reply/reply/session-skill-candidates.ts` | **Truncation logic reversed** — was removing newest entries from the bottom; corrected to remove oldest from the top so recent candidates are preserved. | Medium   |
| `enforce-config.mjs`                               | **Duplicate step numbering** in skill-evolution cron prompt — had two "Step 3"s; corrected second to "Step 4".                                           | Low      |

### New Test Coverage

| File                                                    | Tests                                                                                                                                                                                                | Coverage      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/cron/cron-health-probes.test.ts`                   | **[NEW]** 21 tests — all 4 probe functions (`checkSchedulerLiveness`, `checkConsecutiveErrors`, `checkAutoDisabledJobs`, `checkStaleDeliveryTargets`) + combined `runCronHealthProbes()` integration | Comprehensive |
| `src/agents/tools/skill-generation.test.ts`             | **+3 tests** — NaN, Infinity, and zero generation value edge cases added to existing suite (now 15 total)                                                                                            | Edge cases    |
| `src/auto-reply/reply/session-skill-candidates.test.ts` | **+1 test** — truncation logic (oldest-first removal), removed unused `makeAssistantText` helper (now 11 total)                                                                                      | Correctness   |

### Orphan/Dead Code Removal

| Item                                                    | Action                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/infra/fs-bridge.test 2.ts`                         | **Deleted** — macOS Finder duplicate copy (space in filename), non-functional |
| `src/channels/discord/discord-context 2.ts`             | **Deleted** — macOS Finder duplicate copy (space in filename), non-functional |
| `session-skill-candidates.test.ts: makeAssistantText()` | **Removed** — unused helper function that was never called                    |

### Documentation Alignment

- Updated `OPENCLAW_CONTEXT.md` with all new MetaClaw and cron defense files
- Updated `OPENCLAW_CHANGELOG.md` with audit results and this cleanup section
- Corrected idle-gate documentation to reflect actual 30-minute default threshold (was incorrectly described as 15 minutes in earlier walkthrough)

---

## MetaClaw Integration — Idle-Aware Scheduling, Skill Generation Versioning & Per-Session Skill Candidates (2026-03-20)

**Purpose:** Three features inspired by [MetaClaw](https://github.com/aiming-lab/MetaClaw) v0.2.0: (1) OMLS-inspired idle-aware cron scheduling that defers heavy background jobs when the user is active, (2) skill generation versioning for cache invalidation when skills evolve, (3) per-session mechanical extraction of skill candidates from transcripts.

### Feature 1 — Idle-Aware Cron Scheduling (OMLS)

Opportunistic Meta-Learning Scheduler pattern: heavy reflection crons (consciousness, deep-review, skill-evolution, nightly-innovation) are deferred when the user is actively chatting. Runs during idle windows or the sleep window (23:00–07:00 UTC).

| File                         | Change                                                                                                                                                                          | Sync Risk                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/cron/idle-gate.ts`      | **[NEW]** Idle detection module: `isUserIdle()` (30-min threshold), `isInSleepWindow()` (23:00–07:00 UTC), `shouldRunIdleJob()` gate. Pure functions, fully configurable.       | None — new                      |
| `src/cron/idle-gate.test.ts` | **[NEW]** 17 unit tests: active user, idle user, sleep window boundaries, custom config, edge cases                                                                             | None — test                     |
| `src/cron/types-shared.ts`   | Added `idleOnly?: boolean` to `CronJobBase`                                                                                                                                     | Low — additive                  |
| `src/cron/service/state.ts`  | Added `getLastUserActivityMs?: () => number \| undefined` to `CronServiceDeps`                                                                                                  | Low — additive                  |
| `src/cron/service/timer.ts`  | Integrated idle gate into `collectRunnableJobs()`: due jobs with `idleOnly: true` are deferred (nextRunAtMs bumped 5 min) when user is active. Debug logging for deferred jobs. | Medium — modified upstream file |
| `enforce-config.mjs`         | Tagged 4 crons with `idleOnly: true`: consciousness, deep-review, skill-evolution, nightly-innovation                                                                           | Low — custom file               |

### Feature 2 — Skill Generation Versioning

Monotonically increasing generation counter stored in `skills/.generation.json`. Skills are tagged with the current generation in frontmatter on creation. The skill-evolution cron bumps the generation after creating/revising skills.

| File                                        | Change                                                                                                                           | Sync Risk         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `src/agents/tools/skill-generation.ts`      | **[NEW]** `readSkillGeneration()`, `readSkillGenerationState()`, `bumpSkillGeneration()`. Persists to `skills/.generation.json`. | None — new        |
| `src/agents/tools/skill-generation.test.ts` | **[NEW]** 12 unit tests: read/bump/persist, corrupt JSON, negative values, decimal flooring                                      | None — test       |
| `src/agents/tools/skill-manage-tool.ts`     | Added `generation` to frontmatter builder, `SkillInfo` type, and frontmatter parser                                              | Low — additive    |
| `enforce-config.mjs`                        | Updated skill-evolution cron prompt: Phase 3.5 (bump generation), Phase 4 (clean up candidates), Phase 5 (log)                   | Low — custom file |

### Feature 3 — Per-Session Skill Candidates

Zero-cost mechanical extraction from session transcripts on each session reset. Detects multi-step tool workflows (3+ distinct tools) and iterative correction patterns (same tool 3+ times). Candidates stored in `memory/skill-candidates.md` for the skill-evolution cron to evaluate.

| File                                                    | Change                                                                                                          | Sync Risk         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| `src/auto-reply/reply/session-skill-candidates.ts`      | **[NEW]** `extractSkillCandidates()` (pattern-based, no LLM), `persistSkillCandidates()` (append with 16KB cap) | None — new        |
| `src/auto-reply/reply/session-skill-candidates.test.ts` | **[NEW]** 10 unit tests: extraction patterns, capping, persistence, file creation/append                        | None — test       |
| `src/auto-reply/reply/session.ts`                       | Hooked extraction into session reset flow (after `persistSessionContextOnReset`, best-effort)                   | Low — additive    |
| `enforce-config.mjs`                                    | Skill-evolution Phase 1 now reads `memory/skill-candidates.md` (step 2 of candidate identification)             | Low — custom file |

### Tests

- ✅ `idle-gate.test.ts`: 17/17 passed
- ✅ `skill-generation.test.ts`: 12/12 passed
- ✅ `session-skill-candidates.test.ts`: 10/10 passed
- ✅ `skill-manage-tool.test.ts`: 15/15 passed (regression)
- ✅ `session-context-summary.test.ts`: 12/12 passed (regression)
- ✅ `timer.next-wake.test.ts`: 12/12 passed (regression)
- ✅ Build: clean (exit code 0)

### Upstream Sync Risk

**None for new files** — 5 new source + 4 test files, fully custom.
**Low for modified files** — `types-shared.ts` and `state.ts` are additive. `session.ts` adds a best-effort try/catch block. `skill-manage-tool.ts` adds one field to frontmatter.
**Medium for `timer.ts`** — 30-line addition to `collectRunnableJobs()` with new import. May need manual re-application if upstream modifies this function.

---

## Alignment Drift Scoring & ByteRover Reflection Sync (2026-03-19)

**Purpose:** Two features: (1) alignment drift detection that scores each agent response against SOUL.md/IDENTITY.md rules using Flash Lite, injecting corrective context when the agent drifts from its identity; (2) expanding ByteRover's curation scope to include reflection artifacts for knowledge permanence.

### Feature 1 — Alignment Drift Scoring

Per-turn alignment evaluation via a lightweight LLM call (Gemini Flash Lite). Scores each assistant response against the agent's stated identity (`SOUL.md`) and critical rules (`IDENTITY.md`). When drift is detected, a correction context block is injected into the next turn via `prependContext`.

| File                                             | Change                                                                                                                                                                                                                                                                                                                                                                                         | Sync Risk                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `src/memory/alignment-state.ts`                  | **[NEW]** In-memory per-session state tracker: turn counting, cooldown logic (configurable turns), mild-drift escalation (consecutive drifts trigger early recheck), severity classification (aligned/mild/severe). Pure functions following `session-health.ts` pattern.                                                                                                                      | None — new                    |
| `src/memory/alignment-scorer.ts`                 | **[NEW]** Core scoring module: structured JSON prompt for Flash Lite, dependency-injected LLM call (`AlignmentLlmCall` type for testability), response parsing with markdown fence stripping and score clamping, `buildCorrectionContext()` outputs XML-tagged `<alignment-correction>` blocks, `formatAlignmentLogEntry()` for structured logging.                                            | None — new                    |
| `src/memory/alignment-state.test.ts`             | **[NEW]** 19 tests: state creation, turn advancement, cooldown logic, mild-drift escalation, recordCheck immutability, severity classification with custom thresholds.                                                                                                                                                                                                                         | None — test                   |
| `src/memory/alignment-scorer.test.ts`            | **[NEW]** 24 tests: JSON parsing (valid, markdown fences, out-of-range scores, invalid JSON, missing fields, non-string arrays), LLM call error handling (timeout, null, malformed), response truncation, correction context formatting, log entry structure.                                                                                                                                  | None — test                   |
| `extensions/memory-unified/index.ts`             | Added alignment drift scoring hook alongside existing auto-recall hook. New helper functions: `extractLastAssistantText()` (walks messages backwards), `extractCriticalRules()` (regex-based CRITICAL section extraction from IDENTITY.md), `readTextFileOrEmpty()`, `createGeminiAlignmentCall()` (fetch-based with AbortController timeout). Registers `session_start` hook for state reset. | Low — additive to custom file |
| `extensions/memory-unified/clawdbot.plugin.json` | Added 4 new config properties: `alignmentCheck` (boolean), `alignmentCheckObserveOnly` (boolean), `alignmentCheckCooldownTurns` (number), `alignmentCheckThreshold` (number).                                                                                                                                                                                                                  | None — schema extension       |
| `enforce-config.mjs`                             | Auto-enables alignment scoring for all deployed agents. Sets `alignmentCheck: true`, `alignmentCheckObserveOnly: false` (active corrections by default). Configurable via env vars.                                                                                                                                                                                                            | Low — custom file             |

#### Configuration (auto-enforced via enforce-config.mjs)

| Setting                       | Default | Env Var Override                    | Purpose                                       |
| ----------------------------- | ------- | ----------------------------------- | --------------------------------------------- |
| `alignmentCheck`              | `true`  | —                                   | Always enabled via enforce-config             |
| `alignmentCheckObserveOnly`   | `false` | `ALIGNMENT_CHECK_OBSERVE_ONLY=true` | Set to true to log-only mode (no corrections) |
| `alignmentCheckCooldownTurns` | `3`     | `ALIGNMENT_CHECK_COOLDOWN_TURNS`    | Minimum turns between alignment checks        |
| `alignmentCheckThreshold`     | `0.7`   | `ALIGNMENT_CHECK_THRESHOLD`         | Score below which a correction is injected    |

#### Pipeline

```
before_agent_start hook
  ├─ advanceTurn() — increment session turn counter
  ├─ shouldCheck() — cooldown + mild-drift escalation gate
  ├─ extractLastAssistantText() — walk messages backwards
  ├─ Read SOUL.md + IDENTITY.md from workspace
  ├─ scoreAlignment() — Flash Lite JSON evaluation
  ├─ buildCorrectionContext() — format violations as XML
  ├─ recordCheck() — update state (score, consecutive drifts)
  └─ Return { prependContext: correctionContext } if warranted
```

#### Cost Estimate

~$0.00008 per alignment check (Flash Lite at $0.40/1M output tokens, ~200 tokens per check).

### Feature 2 — ByteRover Reflection Sync

Added `memory/self-review.md` and `memory/open-loops.md` to ByteRover's curation watcher, ensuring reflection artifacts (agent failure analysis, ongoing task tracking) are curated into ByteRover's long-term knowledge tree.

| File                            | Change                                                                                                                                                          | Sync Risk         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `scripts/brv-curate-watcher.sh` | Added 2 files to `fixed_files` array in `get_watched_files()`: `memory/self-review.md` (agent failure analysis), `memory/open-loops.md` (ongoing work tracking) | Low — custom file |

### Tests

- ✅ `alignment-state.test.ts`: 19/19 passed
- ✅ `alignment-scorer.test.ts`: 24/24 passed
- ✅ TypeScript: compiles clean (`tsc --noEmit`)
- ✅ No regressions in memory or extension test suites

### Upstream Sync Risk

**None for new files** — 4 new source + test files, fully custom.
**Low for modified files** — `index.ts` additions are alongside existing auto-recall hook. Config schema is additive. ByteRover watcher is custom script.

---

## Lossless Claw (LCM) — Version-Aware Auto-Update (2026-03-19)

**Purpose:** Make `enforceLCM()` version-aware so rebuilding the Docker image with a newer LCM version automatically propagates to running containers on next restart. Previously, `enforceLCM()` skipped installation if the plugin directory already existed — meaning the only way to update was to manually `rm -rf` the installed copy.

### Changes

| File                 | Change                                                                                                                                                                                   | Sync Risk         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `enforce-config.mjs` | Rewrote `enforceLCM()` with version comparison. Added `readPluginVersion()` (reads `package.json` → `.version`) and `isNewerSemver()` helpers. Old install is `rmSync`'d before upgrade. | Low — custom file |

### Behavior

| Scenario                           | Before               | After                                        |
| ---------------------------------- | -------------------- | -------------------------------------------- |
| Fresh install (no plugin dir)      | Copy prebaked → done | Same                                         |
| Same version installed             | Skip (dir exists)    | Skip (version match)                         |
| Prebaked is newer                  | Skip (dir exists)    | Remove old → copy new, log `upgraded: X → Y` |
| Can't read prebaked `package.json` | N/A                  | Skip (don't risk overwriting)                |
| Plugin dir exists, no prebaked     | Skip                 | Skip (no log noise)                          |

---

## Marketing Skills Integration — 33 Skills from coreyhaines31/marketingskills (2026-03-17)

**Purpose:** Integrate a comprehensive marketing skills library into the MoltBot agent system, giving agents access to structured marketing frameworks through OpenClaw's progressive disclosure system.

**Source:** [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT License)

### Tier 1 — Always-On Skills (4 skills, no gating)

Available to all agents immediately via progressive disclosure (compact index → on-demand `skill_view` loading):

| Skill                       | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `marketing-psychology`      | 60+ mental models with marketing applications                               |
| `copywriting`               | Structured frameworks for marketing copy (homepage, landing pages, pricing) |
| `social-content`            | Complete system for social media content creation across platforms          |
| `product-marketing-context` | Foundational product/audience/positioning context document                  |

### Tier 2 — Business-Gated Skills (29 skills, requires `business.enabled`)

Available only when `business.enabled: true` is set in the agent's configuration. Gated via OpenClaw's `metadata.openclaw.requires.config` frontmatter:

| Category                | Skills                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **SEO & Content**       | `ai-seo`, `content-strategy`, `programmatic-seo`, `schema-markup`, `seo-audit`, `site-architecture`            |
| **CRO & Conversion**    | `form-cro`, `onboarding-cro`, `page-cro`, `paywall-upgrade-cro`, `popup-cro`, `signup-flow-cro`                |
| **Advertising**         | `ad-creative`, `paid-ads`                                                                                      |
| **Email & Outreach**    | `cold-email`, `email-sequence`                                                                                 |
| **Analytics & Testing** | `ab-test-setup`, `analytics-tracking`                                                                          |
| **Sales & Revenue**     | `competitor-alternatives`, `pricing-strategy`, `referral-program`, `revops`, `sales-enablement`                |
| **Strategy & Growth**   | `churn-prevention`, `copy-editing`, `free-tool-strategy`, `launch-strategy`, `lead-magnets`, `marketing-ideas` |

### Marketing Tools Registry — Reference Skill

| File                                               | Change                                                                                                                                                         | Sync Risk              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `.agents/skills/marketing-tools-registry/SKILL.md` | **[NEW]** Reference to 51 zero-dependency Node.js CLI wrappers (analytics, email, ads, CRM, SEO, payments). Business-gated. Tools fetched on-demand via `npx`. | None — workspace level |

### Integration Details

| Aspect               | Detail                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Location**         | `.agents/skills/` (workspace-level, gitignored from source)                                                               |
| **Indexing**         | Auto-indexed by OpenClaw's `buildWorkspaceSkillSnapshot()`                                                                |
| **Prompt format**    | Progressive disclosure — compact name+description index in system prompt, full SKILL.md loaded on demand via `skill_view` |
| **Token impact**     | ~200 tokens (index only) until agent reads a specific skill                                                               |
| **Gating mechanism** | YAML frontmatter: `metadata.openclaw.requires.config: ["business.enabled"]`                                               |

### Attribution

All 33 marketing skills are sourced from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) under the MIT License. The `marketing-tools-registry` skill references CLI tools from the same repository.

---

## Codebase Cleanup — enforce-config Modularization & Test Coverage (2026-03-17)

**Purpose:** Improve maintainability and testability of the two largest custom scripts (`enforce-config.mjs` and `safe-config-edit.mjs`) by extracting shared utilities into testable modules and adding comprehensive test suites.

### Refactoring — enforce-config Module Extraction

Extracted 210 lines of shared helpers from the 2524-line `enforce-config.mjs` into two focused modules:

| File                         | Change                                                                                                                                                       | Sync Risk         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `enforce-config-helpers.mjs` | **[NEW]** Shared utilities: `readConfig`, `writeConfig`, `ensure`, `makeId`, `env`, `isTruthy`, `repairConfig`, `backupConfig`, `resolveReflectionIntervals` | None — new        |
| `enforce-config-models.mjs`  | **[NEW]** Model ID normalization: `normalizeModelId`, `CANONICAL_MODEL_IDS` map                                                                              | None — new        |
| `enforce-config.mjs`         | Replaced inline helpers with imports from extracted modules. Added architecture docs in header. Reduced from 2524→2325 lines                                 | Low — custom file |

### New Test Suites (69 tests total)

| File                              | Tests                                                                                                                                                                             | Coverage   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `enforce-config-helpers.test.mjs` | **[NEW]** 34 tests — readConfig, writeConfig, ensure, makeId, env, isTruthy, resolveReflectionIntervals, repairConfig (prefix stripping, backup restore), backupConfig (rotation) | None — new |
| `enforce-config-models.test.mjs`  | **[NEW]** 12 tests — normalizeModelId (case correction, passthrough, edge cases), CANONICAL_MODEL_IDS validation                                                                  | None — new |
| `safe-config-edit.test.mjs`       | **[NEW]** 23 tests — CLI black-box: get/set/remove/validate/diff commands, backup rotation, --force/--dry-run flags                                                               | None — new |

### Config — vitest include update

| File               | Change                                                                  | Sync Risk      |
| ------------------ | ----------------------------------------------------------------------- | -------------- |
| `vitest.config.ts` | Added `*.test.mjs` to include patterns for root-level `.mjs` test files | Low — additive |

---

## Unified Memory System — Auto-Recall, ByteRover Expansion & Cleanup (2026-03-17)

**Purpose:** Replace the manual `memory_search` agent workflow with automatic per-turn memory injection. Expand ByteRover's curation scope to cover knowledge topics, identity scratchpad, and yesterday's daily memory. Add a dedicated source-boost rule for knowledge files, and clean up configuration redundancies.

### Feature 1 — Memory-Unified Plugin (`extensions/memory-unified/index.ts`)

New plugin replaces `memory-core` as the active memory slot. Re-exports `memory_search` and `memory_get` tools (identical to memory-core) and adds a `before_agent_start` lifecycle hook for **per-turn auto-recall**.

| Guard              | Condition                     | Purpose                              |
| ------------------ | ----------------------------- | ------------------------------------ |
| Short prompt       | `< 10 chars`                  | Avoids noise on empty/trivial inputs |
| Trigger skip       | `cron`, `heartbeat`, `memory` | Don't inject on background jobs      |
| Slash commands     | Starts with `/`               | Commands don't need memory context   |
| Missing sessionKey | `!ctx.sessionKey`             | Defensive — shouldn't happen         |

Auto-recalled results are formatted inside `<auto-recalled-memories>` XML tags and injected via `prependContext`.

| File                                 | Change                                                                    | Sync Risk         |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------------- |
| `extensions/memory-unified/index.ts` | **[NEW]** Plugin with auto-recall hook, tool re-exports, CLI registration | None — new        |
| `enforce-config.mjs`                 | `slots.memory = "memory-unified"`, enabled in entries + allow list        | Low — custom file |

### Feature 2 — QMD Always-On + Tiered Limits (`enforce-config.mjs`)

QMD memory backend switched from opt-in to **always-on** (opt-out via `OPENCLAW_QMD_ENABLED=false`). `maxInjectedChars` now tiered: **5,000** for normal mode, **10,000** for business mode (env: `OPENCLAW_BUSINESS_MODE`).

| File                 | Change                                                                     | Sync Risk         |
| -------------------- | -------------------------------------------------------------------------- | ----------------- |
| `enforce-config.mjs` | QMD always-on, tiered `maxInjectedChars`, removed redundant nested comment | Low — custom file |

### Feature 3 — ByteRover Watcher Expansion (`scripts/brv-curate-watcher.sh`)

Expanded `get_watched_files()` to include three new file sources for hash-based curation:

| Source                             | Type           | Purpose                                                           |
| ---------------------------------- | -------------- | ----------------------------------------------------------------- |
| `memory/knowledge/*.md`            | Dynamic (find) | Curated topic files (e.g., crypto-analysis, trading-patterns)     |
| `memory/identity-scratchpad.md`    | Fixed          | Identity evolution reasoning history                              |
| `memory/YYYY-MM-DD.md` (yesterday) | Dynamic (date) | Previous day's memory — stable, curated once daily after midnight |

| File                            | Change                                                 | Sync Risk         |
| ------------------------------- | ------------------------------------------------------ | ----------------- |
| `scripts/brv-curate-watcher.sh` | Added 3 new source categories to `get_watched_files()` | Low — custom file |

### Feature 4 — Source-Boost Knowledge Rule (`src/memory/source-boost.ts`)

Added explicit `memory/knowledge/*.md` boost rule (1.15×) before the generic `memory/*.md` catchall. Knowledge files were technically matched before, but the explicit rule clarifies intent and ensures nested knowledge subdirectory files are boosted.

| File                              | Change                                                | Sync Risk         |
| --------------------------------- | ----------------------------------------------------- | ----------------- |
| `src/memory/source-boost.ts`      | Added `memory/knowledge/` regex rule to `BOOST_RULES` | Low — custom file |
| `src/memory/source-boost.test.ts` | Added 2 test cases for knowledge dir paths            | None — test file  |

### Prompt Update (`docs/reference/templates/AGENTS.md`)

Replaced "Search Before Answering" section with "Memory Recall" note. Clarifies that memory recall is now automatic via `memory-unified` plugin; manual `memory_search` is available for targeted/deeper searches.

| File                                 | Change                          | Sync Risk           |
| ------------------------------------ | ------------------------------- | ------------------- |
| `docs/reference/templates/AGENTS.md` | Updated memory guidance section | Low — template file |

### Cleanup & Refactoring

| File                                 | Change                                                                                                                    | Category   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `enforce-config.mjs`                 | Removed redundant nested `// QMD backend (local llama.cpp embeddings)` comment                                            | Cleanup    |
| `extensions/memory-unified/index.ts` | Added sessionKey guard, typed catch clause (`err: unknown`), used `trimmedPrompt` for search, defensive `logger.warn?.()` | Robustness |

### Tests

- ✅ `source-boost.test.ts`: 26/26 passed (2 new knowledge dir test cases)

### Upstream Sync Risk

**None for new files** — `memory-unified/index.ts` has no upstream equivalent.
**Low for modified files** — all changes are in custom files (`enforce-config.mjs`, `brv-curate-watcher.sh`, `source-boost.ts`).
**Low for AGENTS.md** — template file, easy to re-apply on merge.

---

**Purpose:** Full codebase audit of all custom files, new test coverage for untested modules, unused variable removal, and `/update-openclaw` workflow rewrite.

### New Test Files

| File                                          | Tests | What It Covers                                                                                                                                                  |
| --------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-reply/reply/noise-patterns.test.ts` | 41    | NOISE_LINE_PATTERNS (6 patterns), CRON_PROMPT_PATTERNS (17 patterns), `cleanUserContent` edge cases, `isCronPromptMessage`, `isMeaningfulUserContent` threshold |
| `src/security/scan-and-log.test.ts`           | 10    | Benign passthrough, prompt injection detection, quarantine+warning logging, event logging, boundary markers, error resilience, sync-only mode                   |

### Cleanup Changes

| File                                              | Change                                                  | Sync Risk        |
| ------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| `src/auto-reply/reply/noise-patterns.test.ts`     | **[NEW]** 41 tests                                      | None — test file |
| `src/security/scan-and-log.test.ts`               | **[NEW]** 10 tests                                      | None — test file |
| `src/browser/download-workspace-registry.test.ts` | Removed unused `_original` variable                     | None — test file |
| `.agent/workflows/update-openclaw.md`             | Rewritten: merge-first, security warnings, cross-checks | None — workflow  |
| `.agent/workflows/verify-sync.md`                 | Added 2 new test files to Gate 4 (~570+ tests)          | None — workflow  |

### Source Audit (No Changes Needed)

Reviewed 11 source files for refactoring, performance, and security issues — all clean:
`download-workspace-registry.ts`, `control-service.ts`, `server-context.ts`, `session-updates.ts`, `browser-tool.ts`, `content-scanner.ts`, `session-freshness.ts`, `system-events.ts`, `noise-patterns.ts`, `scan-and-log.ts`, `stealth-scripts.ts`

---

## Server Context & Session Updates Tests (2026-03-16)

**Purpose:** Cover the parallel profile listing system and session event formatting — key custom patches with zero prior test coverage.

### New Test Files

| File                                           | Tests | What It Covers                                                                                                                                                                               |
| ---------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/browser/server-context.test.ts`           | 16    | `listKnownProfileNames` (config/runtime merge, dedup), `createBrowserRouteContext` (state null, profile resolution, defaults), parallel `Promise.all` listing, SSRF/navigation error mapping |
| `src/auto-reply/reply/session-updates.test.ts` | 19    | System event formatting/filtering (heartbeat, periodic, Node compaction), multiline prefix, channel summary, compaction counter, token tracking after compaction                             |

### Files Changed

| File                                           | Change                        | Sync Risk        |
| ---------------------------------------------- | ----------------------------- | ---------------- |
| `src/browser/server-context.test.ts`           | **[NEW]** 16 tests            | None — test file |
| `src/auto-reply/reply/session-updates.test.ts` | **[NEW]** 19 tests            | None — test file |
| `.agent/workflows/verify-sync.md`              | Added to Gate 4 (~520+ tests) | None — workflow  |

---

## Browser Download & Control Service Tests (2026-03-16)

**Purpose:** Cover the per-agent download routing pipeline and browser service lifecycle — the chain that ensures each agent's browser downloads land in their own workspace, not the shared one.

### New Test Files

| File                                              | Tests | What It Covers                                                                                                                          |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/browser/download-workspace-registry.test.ts` | 31    | Registry CRUD/isolation, URL normalization, filename sanitization (path traversal, control chars, overflow), auto-download timestamping |
| `src/browser/control-service.test.ts`             | 16    | Service startup/shutdown lifecycle, per-agent workspace registration, auth handling, cleanup on stop                                    |

### Files Changed

| File                                              | Change                        | Sync Risk        |
| ------------------------------------------------- | ----------------------------- | ---------------- |
| `src/browser/download-workspace-registry.test.ts` | **[NEW]** 31 tests            | None — test file |
| `src/browser/control-service.test.ts`             | **[NEW]** 16 tests            | None — test file |
| `.agent/workflows/verify-sync.md`                 | Added to Gate 4 (~490+ tests) | None — workflow  |

---

## Per-Agent Browser Routing Tests (2026-03-16)

**Purpose:** Fill the critical test gap around per-agent browser routing — the most breakable path during upstream syncs. Previously, the `agentId` injection in `openclaw-tools.ts` and profile override in `browser-tool.ts` had zero test coverage.

### New Test File

| File                                                  | Tests | What It Covers                                                                                                                                                        |
| ----------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/tools/browser-tool.agent-routing.test.ts` | 40    | Per-agent profile override, all-action routing, host-only protection, sandbox interaction, tab tracking, tool creation, error handling, config edge cases, node proxy |

### Test Categories

- **Profile override** (7): agentId injection → profile="dan" instead of "openclaw"
- **All-action routing** (8): status/start/stop/open/navigate/snapshot/act/close/console
- **Host-only protection** (4): user/chrome-relay profiles never overridden
- **Sandbox interaction** (2): profile override independent of base URL resolution
- **Tab tracking** (2): tabs tracked under agent's session key + profile
- **Tool creation** (5): description hints, name, label
- **Error handling** (6): unknown actions, missing params, policy violations
- **Edge cases** (5): empty config, null browser, dynamic config reload
- **Node proxy** (1): agent profile passes through to node.invoke

### Files Changed

| File                                                  | Change                               | Sync Risk            |
| ----------------------------------------------------- | ------------------------------------ | -------------------- |
| `src/agents/tools/browser-tool.agent-routing.test.ts` | **[NEW]** 40 per-agent routing tests | None — test file     |
| `.agent/workflows/verify-sync.md`                     | Added to Gate 4 test list            | None — workflow      |
| `OPENCLAW_CHANGELOG.md`                               | This entry                           | None — documentation |

---

## Post-Sync Stabilization Methodology (2026-03-16)

**Purpose:** Fill the gap between upstream sync conflict resolution and deploy. Previously, the only verification after a rebase was `npm run build` — type errors were caught but behavioral regressions were not detected until post-deploy smoke testing on a live VM.

### New Workflow: `/verify-sync`

4-gate automated verification that runs **after conflict resolution, before push**:

| Gate                            | What It Checks                                                                        | Catches                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| **1. Conflict Marker Sweep**    | Scans `.ts`, `.json`, `.md`, `.sh`, `.yml`, `.mjs` for leftover `<<<<<<<` markers     | Incomplete conflict resolution                |
| **2. Local Patch Verification** | ~65 grep checks across browser, security, memory, session, cron, and infrastructure   | Silently overwritten local modifications      |
| **3. TypeScript Build**         | `npm install && npm run build`                                                        | Type-level breakage from upstream API changes |
| **4. Custom Test Suites**       | ~400+ tests across 29 test files (security, sentinel, session, memory, cron, browser) | Behavioral regressions in custom features     |

### Expanded `LOCAL_PATCHES.md`

Expanded from 9 entries (CDP/browser patches only) to 35 entries organized by category:

- **Browser** (12): CDP host fix, parallel profiles, browser sweep, auto-downloads, agent routing
- **Security** (5): AgentGuard secret redaction, event journal, deployment audit, workspace scanning
- **Memory & Search** (8): workspace source, QMD retry, source boost, SearXNG, Scrapling
- **Sessions** (4): ephemeral path guard, session freshness, createdAt, typing TTL
- **Cron & Reflection** (3): NEXT_WAKE, evidence counters, reflection change-log
- **Infrastructure** (6): managed platform guards, tool profile, LCM, CLI tooling, heartbeat, Telegram timeout
- **Agent Behavior** (3): autonomous problem-solving, exhaust-before-escalating, IDENTITY.md fix

Added a complete copy-paste verification script at the top of `LOCAL_PATCHES.md` that can be piped to bash for quick manual checks.

### Files Changed

| File                              | Change                                                  | Sync Risk            |
| --------------------------------- | ------------------------------------------------------- | -------------------- |
| `.agent/workflows/verify-sync.md` | **[NEW]** 4-gate verification workflow                  | None — workflow file |
| `LOCAL_PATCHES.md`                | Expanded from 9 → 35 entries, added verification script | None — documentation |
| `OPENCLAW_CHANGELOG.md`           | This entry                                              | None — documentation |

---

## SearXNG Engine Selection & Deploy Wizard Integration (2026-03-16)

**Purpose:** Full-stack UI for selecting which [SearXNG](https://github.com/searxng/searxng) search engines an agent uses, plus SearXNG as the default search provider in the deploy wizard. Also includes a cache key mutation fix and rendering optimizations.

### Dashboard — `moltbot-dashboard`

| File                                                             | Change                                                                                                                                                                                                                                                                                                                                                            | Sync Risk                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `src/app/dashboard/console/components/SearxngEngineSelector.tsx` | **[NEW]** Engine selection component — groups 70+ SearXNG engines by category (General, Images, Videos, News, etc.), curated defaults (Google, Bing, DuckDuckGo, Wikipedia, etc.), select-all-curated / clear-all actions. `useMemo`-memoized category grouping and `useCallback`-memoized toggle/selectAll/clearAll callbacks to prevent unnecessary re-renders. | None — fully custom        |
| `src/components/instances/InlineDeployCard.tsx`                  | Added `"searxng"` as third search provider option — pill button, no API key required, description explaining keyless operation. **SearXNG is now the default selection** since it ships bundled. Advanced section background color and description text updated to accommodate.                                                                                   | Low — fully custom file    |
| `src/app/dashboard/console/components/ConfigurationTab.tsx`      | SearXNG engine selector wired into the configuration tab — renders `SearxngEngineSelector` when search provider is `"searxng"`. Persists selected engines via existing settings API.                                                                                                                                                                              | Low — modified custom file |
| `src/app/dashboard/instances/components/SettingsModal.tsx`       | Mirrors `ConfigurationTab` SearXNG wiring for the settings modal variant.                                                                                                                                                                                                                                                                                         | Low — modified custom file |
| `src/app/api/instances/[id]/settings/route.ts`                   | GET/PATCH handlers accept `searxngEngines` field (string array). Emitted as `SEARXNG_ENGINES` env var via `instance-env.ts`.                                                                                                                                                                                                                                      | Low — modified custom file |
| `src/lib/services/instance-env.ts`                               | `SEARXNG_ENGINES` env var emission — joins selected engine slugs as comma-separated string.                                                                                                                                                                                                                                                                       | Low — modified custom file |
| `src/app/dashboard/instances/actions.ts`                         | `searxngEngines` field persisted alongside other instance settings.                                                                                                                                                                                                                                                                                               | Low — modified custom file |

### Source — `moltbotserver-source`

| File                             | Change                                                                                                                                                                                                                                                                                            | Sync Risk                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/agents/tools/web-search.ts` | **Bug fix:** Cache key generation used `params.searxngEngines.sort()` which **mutates the caller's array**. Changed to `params.searxngEngines.slice().sort()` to create a sorted copy. Also added `resolveSearxngEngines()` — reads `SEARXNG_ENGINES` env var and falls back to curated defaults. | Medium — modified upstream file |

### Upstream Sync Risk

**Low–Medium.** The dashboard files are fully custom (no upstream equivalents). The `web-search.ts` fix is a 1-line change (`slice().sort()` instead of `.sort()`) in a custom code block, easily re-applied if upstream modifies surrounding logic.

---

## Codebase Cleanup Audit (2026-03-16)

**Purpose:** Comprehensive audit and refactoring of all recently modified files. No TODOs, no console.log leaks, no `any` types found across the sentinel module.

| Change                              | Detail                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Test DRY refactor**               | Extracted `health-sentinel-test-helpers.ts` with shared `createMockDeps` / `createMockHealthSummary` / `createMockSystemReport` factories. Removed ~120 lines of duplication across 3 test files.  |
| **Sidecar `depends_on` fix**        | Removed `searxng`/`scrapling` from gateway's `depends_on` in compose template — sidecars are optional, gateway has fallback providers. Prevents provisioning failures if sidecar image pull fails. |
| **Background sidecar provisioning** | Added parallel background sidecar pull to cloud-init boot sequence so SearXNG/Scrapling images download concurrently with browser pull, not blocking gateway startup.                              |
| **Unused import cleanup**           | Removed leftover `ChannelHealthSummary` and `CheckResult` type imports from `health-sentinel.test.ts` after mock factory extraction.                                                               |

---

## Sidecar Deployment Infrastructure (2026-03-16)

**Purpose:** Integrate SearXNG and Scrapling into the Hetzner VM deployment lifecycle — provisioning, soft redeploy, and pull-update. Both sidecars are now deployed automatically with every new instance and kept up-to-date on existing ones.

| Component           | Change                                                                                                                         | Location                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Cloud-init template | Added `searxng` (`searxng/searxng:latest`) + `scrapling` (`ghcr.io/ashneil12/optimized-claw-scrapling:latest`) to compose file | `moltbot-dashboard: hetzner-instance-service.ts` |
| SearXNG settings    | `settings.yml` written inline during provisioning + `ensureSearxngSettings()` idempotent helper for existing instances         | `moltbot-dashboard: hetzner-instance-service.ts` |
| Env vars            | `SEARXNG_BASE_URL=http://searxng:8080` + `SCRAPLING_BASE_URL=http://scrapling:8765` added to `.env` and compose                | `moltbot-dashboard: hetzner-instance-service.ts` |
| Soft redeploy       | `docker compose up -d --force-recreate ... searxng scrapling`                                                                  | `moltbot-dashboard: hetzner-instance-service.ts` |
| Pull update         | `docker compose pull ... searxng scrapling` + `up -d --force-recreate`                                                         | `moltbot-dashboard: hetzner-instance-service.ts` |
| GHCR image          | Scrapling Docker image built + pushed to `ghcr.io/ashneil12/optimized-claw-scrapling:latest`                                   | Dockerfile.scrapling                             |

---

## Browser Container Health Probes + Auto-Restart Playbook (2026-03-16)

**Purpose:** Monitor sandbox browser Docker containers via Health Sentinel. Probes check Docker state + CDP endpoint responsiveness. Unhealthy browsers are auto-restarted via the browser-restart playbook.

| File                                       | Change                                                                                                                   | Upstream Risk                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `src/logging/health-sentinel-types.ts`     | Added `checkBrowserHealth` to `DoctorProbes`, moved `RemediationContext` to playbooks                                    | Low — additive                   |
| `src/logging/health-sentinel.ts`           | Browser classification: `auto-fixable` (single failure), `needs-agent` (3+ consecutive)                                  | Low — additive                   |
| `src/logging/health-sentinel-playbooks.ts` | Browser restart playbook: `restartBrowserContainer` + `probeBrowserCdp` verify                                           | Low — additive                   |
| `src/logging/diagnostic.ts`                | `checkBrowserHealth` probe (Docker inspect + CDP probe), `restartBrowserContainer`/`probeBrowserCdp` remediation context | Low — runs in existing heartbeat |

---

## Health Sentinel — SearXNG & Scrapling Sidecar Probes (2026-03-16)

**Purpose:** Connect SearXNG and Scrapling Docker sidecars to the existing Health Sentinel monitoring system. Probes hit each service's `/health` endpoint every ~30 minutes and report status via the standard `CheckResult` pipeline.

| File                                           | Change                                                                                                                                                                                                                                                | Upstream Risk                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/logging/health-sentinel-types.ts`         | Added `checkSidecarHealth?: () => Promise<CheckResult[]>` to `DoctorProbes` interface — first async probe                                                                                                                                             | Low — additive                            |
| `src/logging/health-sentinel.ts`               | Added sidecar classification: `sidecar.searxng`/`sidecar.scrapling` failures → `"warning"` (non-critical, agents have fallbacks). After 3+ consecutive failures → `"needs-agent"`. Wired async probe into orchestrator alongside sync doctor probes.  | Low — additive to classification          |
| `src/logging/diagnostic.ts`                    | Implemented `checkSidecarHealth` probe in `doctorProbes` block: reads `SEARXNG_BASE_URL`/`SCRAPLING_BASE_URL` env vars, fetches `/healthz` and `/health` with 5s timeout, returns structured `CheckResult[]`. Skips services without configured URLs. | Low — runs inside existing heartbeat loop |
| `src/logging/health-sentinel-sidecars.test.ts` | **[NEW]** 7 unit tests: classification (warning/pass/skip), orchestrator integration, error resilience, non-escalation verification                                                                                                                   | None — test                               |

### Design Decision

Sidecar probes are **warnings by default** — SearXNG/Scrapling are enhancements, not critical services. Agents fall back to Brave/Firecrawl when sidecars are down. Only after 3+ consecutive failures does the sentinel escalate to `needs-agent`, indicating a persistent Docker issue worth investigating.

---

## AgentGuard — Secret Redaction, Security Event Journal & OC Deployment Audit (2026-03-16)

**Purpose:** Three-part safety and observability system for agent outputs. Philosophy: **"observe and redact, never restrict"** — agents maintain full tool/command access, but sensitive data is intercepted before reaching channels, all security-relevant events are logged for auditing, and deployment configurations are proactively checked for misconfigurations. Inspired by SkillGuard (by [Ziwen Xu](https://github.com/ziwenxu)).

### Feature 1 — Secret Redaction (data-classification.ts)

14 regex patterns detect developer secrets (API keys, tokens, connection strings, PEM keys) in agent output. Redaction runs inline in the reply normalization pipeline — before channel delivery, after all other text sanitization. Patterns cover: OpenAI, GitHub (PAT + OAuth/App), Slack, Stripe, Google, AWS, Telegram, Discord, Groq/Perplexity/npm/Anthropic, database connection strings, Bearer tokens, and PEM private keys.

| File                                                      | Change                                                                                                                                                                                                                                                                          | Upstream Risk                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/security/data-classification.ts`                     | Added `SecretPattern` interface with precomputed `globalRegex` property. 14 `SECRET_PATTERNS` entries. `redactSecrets()` returns redacted text + detected pattern names. `containsSecrets()` boolean check. Also optimized existing `PiiPattern` with precomputed `globalRegex` | Medium — modified upstream file |
| `src/auto-reply/reply/normalize-reply.ts`                 | Integrated `redactSecrets()` after `sanitizeUserFacingText()` — detects secrets, replaces with `[SECRET-REDACTED]`/`[CONNECTION-REDACTED]`/`[TOKEN-REDACTED]`/`[PRIVATE-KEY-REDACTED]`, logs event via security journal                                                         | Low — 2 imports + 10 lines      |
| `src/security/data-classification.redact-secrets.test.ts` | **[NEW]** 46 tests: individual pattern matching, no false positives on partial matches, `redactSecrets()` multi-pattern replacement, `containsSecrets()` detection                                                                                                              | None — test                     |

### Feature 2 — Security Event Journal (security-event-journal.ts)

Lightweight, append-only log for security-relevant events. Fire-and-forget API — never blocks the caller, never throws. Events go to `security.<type>.jsonl` via the existing `EventLogger` infrastructure. Supports 4 event types: `secret_redacted`, `content_quarantined`, `injection_detected`, `audit_finding`. Console-level `logWarn` for `secret_redacted` events gives immediate visibility.

| File                                          | Change                                                                                                                                                             | Upstream Risk |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `src/security/security-event-journal.ts`      | **[NEW]** Eager singleton logger (mirrors `scan-and-log.ts` pattern). `logSecurityEvent()` (fire-and-forget), `querySecurityEvents()` (filter by type/since/limit) | None — new    |
| `src/security/security-event-journal.test.ts` | **[NEW]** 8 tests: event logging, warn-level console output for secret_redacted, query filtering, graceful fallback when logger unavailable                        | None — test   |

### Feature 3 — OC Deployment Audit Checks

5 new audit checks integrated into the existing `runSecurityAudit()` pipeline. These are specific to OpenClaw multi-agent deployments and check for common deployment misconfigurations.

| Check ID                          | Severity   | What It Detects                                                                              |
| --------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `oc.searxng_provider_no_url`      | `warn`     | SearXNG provider configured but `SEARXNG_BASE_URL` not set                                   |
| `oc.searxng_exposure`             | `warn`     | SearXNG bound to public host or non-standard port (unauthenticated metasearch proxy exposed) |
| `oc.scrapling_high_concurrency`   | `warn`     | `SCRAPLING_MAX_CONCURRENCY > 10` — each Playwright session uses ~150-250MB RAM               |
| `oc.browser_sandbox_network_leak` | `warn`     | `sandbox.mode=all` + `browser.docker.networkMode=host` — sandbox boundary weakened           |
| `oc.gateway_bind_no_auth`         | `critical` | Gateway bound to network interface with `auth.mode=none` — any host can send agent commands  |
| `oc.agent_count_resource_warning` | `info`     | 8+ agents with browser + sandbox enabled — high RAM usage expected                           |

| File                                             | Change                                                                                                                                                                                                        | Upstream Risk                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `src/security/audit-extra.sync.ts`               | Added 5 collector functions: `collectSearxngExposureFindings`, `collectScraplingResourceFindings`, `collectBrowserSandboxAlignmentFindings`, `collectGatewayBindCorsFindings`, `collectAgentResourceFindings` | Low — additive in custom section |
| `src/security/audit-extra.ts`                    | Re-exported 5 new collector functions from `audit-extra.sync.ts`                                                                                                                                              | Low — re-export additions        |
| `src/security/audit.ts`                          | Integrated 5 new checks into `runSecurityAudit()` pipeline under "OC Deployment checks" block                                                                                                                 | Low — 5 additive `findings.push` |
| `src/security/audit-extra.oc-deployment.test.ts` | **[NEW]** 19 tests: all 6 check IDs, positive/negative cases, edge cases (default ports, Docker hostnames, mixed configs)                                                                                     | None — test                      |

### Performance Optimization

| File                                  | Change                                                                                                                                                                                                                                                                                    | Category    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `src/security/data-classification.ts` | Precomputed `globalRegex` property on both `PiiPattern` and `SecretPattern` interfaces. `redactPII()` and `redactSecrets()` now use precomputed variants instead of constructing `new RegExp(pattern.regex, 'g')` on every call. Added `lastIndex` resets to prevent stateful regex bugs. | Performance |

### Bug Fix

| Fix                                      | File                               | Detail                                                                                                                                            |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dead-code path in SearXNG exposure check | `src/security/audit-extra.sync.ts` | `!searxngUrl` check was after an early return, making it unreachable. Reordered to check provider config first, then early-return on missing URL. |

### Tests

- ✅ `data-classification.redact-secrets.test.ts`: 46/46 passed
- ✅ `security-event-journal.test.ts`: 8/8 passed
- ✅ `audit-extra.oc-deployment.test.ts`: 19/19 passed
- ✅ Total: 73/73 new tests passed

### Upstream Sync Risk

**None for new files** — 4 new source files + 3 test files, fully custom.
**Low for `normalize-reply.ts`** — 2 imports + 10-line conditional block after existing sanitization call.
**Low for `audit.ts`** — 5 `findings.push()` lines in additive block after existing checks.
**Medium for `data-classification.ts`** — `globalRegex` property added to pattern interfaces + function-level optimizations. Merge may need manual intervention if upstream modifies `PII_PATTERNS` or `redactPII`.

---

## SearXNG Search Provider & Scrapling Stealth Scraping Backend (2026-03-16)

**Purpose:** Self-hosted search and stealth scraping sidecars that ship with every deployment. [SearXNG](https://github.com/searxng/searxng) provides free, API-key-free metasearch (aggregates 70+ engines). [Scrapling](https://github.com/D4Vinci/Scrapling) (by [D4Vinci](https://github.com/D4Vinci)) provides anti-bot-bypass stealth scraping via Playwright with real browser fingerprints. Both run as shared Docker services — all agents hit the same instances, with Scrapling's concurrency defaulting to 5 concurrent sessions.

### Feature 1 — SearXNG Search Provider

New `"searxng"` search provider with auto-detection. When `SEARXNG_BASE_URL` is set (default: `http://searxng:8080`), SearXNG is auto-detected as the provider. API-key providers (Brave, Gemini, etc.) take priority in auto-detection when both are available. Explicit `provider: "searxng"` overrides all auto-detection.

| File                                            | Change                                                                                                                                                                                                                                                                                        | Upstream Risk                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/agents/tools/web-search.ts`                | Added `"searxng"` to `SEARCH_PROVIDERS`, `DEFAULT_SEARXNG_BASE_URL`, `runSearxngSearch()` function (JSON API with `format=json`), SearXNG branch in main search dispatcher, SearXNG auto-detection in `resolveSearchProvider()` (fallback after API-key providers), `resolveSearxngBaseUrl()` | Medium — modified upstream file |
| `src/config/types.tools.ts`                     | Added `"searxng"` to `provider` union, `searxng?: { baseUrl?: string }` config block                                                                                                                                                                                                          | Low — adds to existing type     |
| `src/config/schema.help.ts`                     | Help text for `tools.web.search.provider` updated with `"searxng"`, new `tools.web.search.searxng.baseUrl` entry                                                                                                                                                                              | Low — help text only            |
| `src/config/schema.field-metadata.ts`           | Field metadata for `tools.web.search.provider` updated, new `tools.web.search.searxng.baseUrl` entry                                                                                                                                                                                          | Low — metadata only             |
| `src/config/schema.labels.ts`                   | New `"tools.web.search.searxng.baseUrl": "SearXNG Base URL"` label                                                                                                                                                                                                                            | Low — label only                |
| `src/config/config.web-search-provider.test.ts` | **[NEW]** Tests: SearXNG config validation (2), auto-detection (3), config resolution (4)                                                                                                                                                                                                     | None — test                     |

### Feature 2 — Scrapling Stealth Scraping Backend

Scrapling exposed as an HTTP microservice (`/scrape` endpoint) and integrated into the `web_fetch` fallback chain: direct fetch → Scrapling stealth → Firecrawl. Auto-enabled when `SCRAPLING_BASE_URL` is set (default: `http://scrapling:8765`). Configurable stealth mode, timeout, and concurrency.

| File                                  | Change                                                                                                                                                                                                                                                                                                               | Upstream Risk                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `scripts/scrapling-server.py`         | **[NEW]** FastAPI wrapper exposing Scrapling as HTTP microservice. Endpoints: `GET /health`, `POST /scrape` (accepts `url`, `stealth`, `timeout`). Semaphore-based concurrency limiting (default 5, configurable via `SCRAPLING_STEALTH_CONCURRENCY`). Returns `{ url, html, status_code, content_length }`.         | None — new                      |
| `Dockerfile.scrapling`                | **[NEW]** Python 3.12-slim image with `scrapling[all]`, `fastapi`, `uvicorn`. Installs `camoufox` browsers. Port 8765.                                                                                                                                                                                               | None — new                      |
| `searxng/settings.yml`                | **[NEW]** SearXNG configuration — JSON format enabled, autocomplete via DuckDuckGo, engines configured.                                                                                                                                                                                                              | None — new                      |
| `src/agents/tools/web-fetch.ts`       | Added `ScraplingFetchConfig` type, resolver functions (`resolveScraplingConfig`, `resolveScraplingEnabled`, `resolveScraplingBaseUrl`, `resolveScraplingTimeoutSeconds`, `resolveScraplingStealthDefault`), `fetchScraplingContent()` (POST to `/scrape`), fallback chain updated to: direct → Scrapling → Firecrawl | Medium — modified upstream file |
| `src/config/types.tools.ts`           | Added `scrapling?: { enabled?, baseUrl?, timeoutSeconds?, stealth? }` config block under `tools.web.fetch`                                                                                                                                                                                                           | Low — adds to existing type     |
| `src/config/schema.help.ts`           | Help text for 4 new `tools.web.fetch.scrapling.*` entries                                                                                                                                                                                                                                                            | Low — help text only            |
| `src/config/schema.field-metadata.ts` | Field metadata for 4 new `tools.web.fetch.scrapling.*` entries                                                                                                                                                                                                                                                       | Low — metadata only             |
| `src/config/schema.labels.ts`         | Labels for 4 new `tools.web.fetch.scrapling.*` entries                                                                                                                                                                                                                                                               | Low — label only                |

### Docker Infrastructure

| File                 | Change                                                                                                                                                                                                                                                                                                                  | Upstream Risk                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `docker-compose.yml` | Added `SEARXNG_BASE_URL` and `SCRAPLING_BASE_URL` env vars to main `openclaw` service. Added `searxng` service (official image, port 8080, `./searxng` volume mount, 256MB mem limit, healthcheck). Added `scrapling` service (local build, port 8765, 512MB mem limit, healthcheck, configurable concurrency/timeout). | Medium — modified upstream file |

### System Prompt Update

| File                          | Change                                                                                                                                                                                                    | Upstream Risk               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `src/agents/system-prompt.ts` | Web Search Strategy guidance updated: `web_fetch` described with "built-in stealth scraping fallback for bot-protected sites" — agents prefer `web_fetch` over browser escalation for bot-blocked content | Low — text change in prompt |

### Environment Variables

| Variable                        | Default                 | Purpose                                        |
| ------------------------------- | ----------------------- | ---------------------------------------------- |
| `SEARXNG_BASE_URL`              | `http://searxng:8080`   | SearXNG instance URL (triggers auto-detection) |
| `SCRAPLING_BASE_URL`            | `http://scrapling:8765` | Scrapling service URL (auto-enables backend)   |
| `SCRAPLING_STEALTH_CONCURRENCY` | `5`                     | Max concurrent stealth sessions                |
| `SCRAPLING_TIMEOUT`             | `30`                    | Default timeout in seconds                     |

### Upstream Sync Risk

Docker compose changes require manual merge. Source file changes (`web-search.ts`, `web-fetch.ts`) are additions to existing provider lists and fallback chains — medium conflict risk. Config schema changes are low risk (additive). New files (`scrapling-server.py`, `Dockerfile.scrapling`, `searxng/settings.yml`) have no upstream conflict.

### Comprehensive Cleanup (post-implementation audit)

| File                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                              | Category                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `scripts/scrapling-server.py`                   | Replaced deprecated `asyncio.get_event_loop()` → `asyncio.get_running_loop()`. Extracted duplicate page extraction into shared `_extract_page_content()` helper (DRY). Added `MAX_TIMEOUT = 120` hard ceiling to prevent resource exhaustion. Added Pydantic `field_validator` to clamp timeout input. Improved error logging with `exc_info=True` + request metadata. Added success logging with timing/status. Added credit link. | Security, Performance, Quality |
| `Dockerfile.scrapling`                          | Added non-root user (`scrapling:scrapling`) — container no longer runs as root. Added credits label.                                                                                                                                                                                                                                                                                                                                | Security                       |
| `searxng/settings.yml`                          | Added comment explaining `secret_key` auto-generation. Restricted HTTP method to `GET`. Added credit link.                                                                                                                                                                                                                                                                                                                          | Security, Docs                 |
| `docker-compose.yml`                            | Added `mem_limit: 256m` on `searxng` service and `mem_limit: 512m` on `scrapling` service to prevent unbounded memory growth from headless browser instances.                                                                                                                                                                                                                                                                       | Performance, Security          |
| `src/agents/tools/web-fetch.ts`                 | Fixed timeout race condition in `fetchScraplingContent()`: client-side `AbortSignal` now uses `(timeoutSeconds + 15) * 1000` instead of `timeoutSeconds * 1000` — Scrapling server adds 5-10s padding, so client was aborting before server could finish stealth fetches. Added SSRF safety comment.                                                                                                                                | Bug fix, Security              |
| `src/commands/onboard-search.ts`                | Added `"searxng"` to `SearchProvider` type union. Added SearXNG entry to `SEARCH_PROVIDER_OPTIONS` (keyless, auto-detected). Added `"searxng"` case to `rawKeyValue()` and `applySearchKey()`. Fixes TypeScript build errors.                                                                                                                                                                                                       | Bug fix                        |
| `src/wizard/onboarding.finalize.ts`             | Added keyless provider handling: SearXNG is treated as always-configured (no API key needed). Shows "No API key required" instead of the "no key found" warning.                                                                                                                                                                                                                                                                    | Bug fix                        |
| `src/config/config.web-search-provider.test.ts` | Removed duplicate test case ("auto-detects kimi" was copy-pasted). Removed duplicate env cleanup lines in `beforeEach`.                                                                                                                                                                                                                                                                                                             | Quality                        |

---

## Security Skills — Prompt Guard & ClawScan (2026-03-16)

**Purpose:** Two documentation-only skills that teach agents to use OpenClaw's existing security infrastructure for prompt injection defense and workspace vulnerability scanning. Inspired by SkillGuard (by [Ziwen Xu](https://github.com/ziwenxu)). AgentGuard runtime components (output redaction, command blocklist, audit trail) deferred for separate implementation.

### New Files

| File                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/prompt-guard/SKILL.md` | Teaches agents to detect and handle prompt injection using the existing ACIP scanner (`content-scanner.ts`). Covers: source identification (email/webhook/API/browser), risk scoring interpretation, quarantine handling, boundary marker usage, and scanning integration points. Decision tree: safe → process, ambiguous → wrap with boundaries, dangerous → quarantine + notify.       |
| `skills/clawscan/SKILL.md`     | Teaches agents to run comprehensive security sweeps across workspaces, installed skills, dependencies, and configurations. Uses existing `skill-scanner.ts` (7 detection rules), `openclaw security audit` CLI, and npm/pip auditing. Includes 5-step full sweep workflow, finding severity handling, periodic scanning schedules via cron, and integration with the `healthcheck` skill. |

### Upstream Sync Risk

**None** — both are new files in `skills/` that don't exist upstream.

---

## Memory Search Enhancements — Source-Aware Ranking & Temporal Decay Defaults (2026-03-15)

**Purpose:** Improve memory search relevance by prioritizing agent-specific knowledge files and boosting recent information. Inspired by graph-RAG relevance patterns seen in [MiroFish](https://github.com/666ghj/MiroFish) (by [666ghj](https://github.com/666ghj)).

### Feature 1 — Source-Aware Ranking

Agent knowledge files receive a 1.15× score multiplier after the initial hybrid score merge. This ensures that agent-written memory, identity, and diary files rank higher than generic workspace documents.

| File                              | Change                                                                                                                                                                                    | Upstream Risk          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `src/memory/source-boost.ts`      | **[NEW]** Source-aware ranking module. Precompiled regex patterns match `MEMORY.md`, `memory/*.md`, `IDENTITY.md`, `identity-scratchpad.md`, `WORKING.md`. `applySourceBoostToResults()`. | None — new             |
| `src/memory/source-boost.test.ts` | **[NEW]** 24 unit tests: pattern matching (positive/negative), score application, immutability, property preservation.                                                                    | None — test            |
| `src/memory/hybrid.ts`            | Integrated `applySourceBoostToResults()` into `mergeHybridResults()` pipeline — applied after score merge, before temporal decay.                                                         | Low — import + 2 lines |

### Feature 2 — Temporal Decay Enabled by Default

Temporal decay (half-life–based recency boosting) is now **enabled by default** with a 14-day half-life (was: disabled, 30-day). Recent memory entries rank higher without any configuration.

| File                           | Change                                                                                    | Upstream Risk          |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------- |
| `src/agents/memory-search.ts`  | `DEFAULT_TEMPORAL_DECAY_ENABLED` → `true`, `DEFAULT_TEMPORAL_DECAY_HALF_LIFE_DAYS` → `14` | Low — constant changes |
| `src/memory/temporal-decay.ts` | `DEFAULT_TEMPORAL_DECAY_CONFIG` updated to match: `enabled: true`, `halfLifeDays: 14`     | Low — constant changes |
| `src/config/schema.help.ts`    | Help text updated to reflect new defaults (`true` / `14 days`)                            | Low — help text only   |
| `src/config/types.tools.ts`    | JSDoc `@default` comments updated for `temporalDecay.enabled` and `halfLifeDays`          | Low — comment changes  |

### Pipeline Order

```
Hybrid score merge → Source boost (1.15×) → Temporal decay → Sort → MMR re-ranking
```

### Tests

- ✅ `source-boost.test.ts`: 24/24 passed
- ✅ `hybrid.test.ts`: 6/6 passed (assertions updated for source boost)
- ✅ `temporal-decay.test.ts`: 6/6 passed (assertions updated for source boost)
- ✅ `schema.help.quality.test.ts`: 20/20 passed

### Upstream Sync Risk

**None for new files** — `source-boost.ts` and `source-boost.test.ts` are fully custom.
**Low for modified files** — constant value changes + import additions. Clean merge expected.

---

## Health Sentinel — Comprehensive Cleanup (2026-03-15)

**Purpose:** Code quality audit and refactoring across all sentinel files (8 source + 3 test).

| File                             | Change                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health-sentinel.ts`             | Consolidated duplicate `TrendAnalysis` import, updated module doc for all features, simplified `resolveConfig` (spread + filter vs field-by-field), hoisted `ONE_WEEK_MS` to top-level constant |
| `health-sentinel-incidents.ts`   | Removed dead `healthyChecks` variable in inbox composer                                                                                                                                         |
| `health-sentinel-phase2.test.ts` | Fixed type-safety lint errors: proper `as any` casts for partial `HealthSummary` mocks, added missing `accountId` to channel test fixture                                                       |

All 101 tests pass after cleanup (no behavioural changes).

---

## Health Sentinel Phase 3 — Operational Automation (2026-03-15)

**Purpose:** Incident file writing, categorised inbox summaries, weekly drift checks (backup freshness, file permission audits), and TTL-based auto-cleanup of old incidents, summaries, and history.

### New Files

| File                                         | Purpose                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/logging/health-sentinel-incidents.ts`   | Incident markdown writer (`writeIncidentFiles`), inbox summary writer (`writeInboxSummary`), TTL cleanup (`cleanupOldFiles`, `cleanupOldHistory`, `runCleanup`) |
| `src/logging/health-sentinel-phase3.test.ts` | 19 tests: incident files, inbox summaries, TTL cleanup, weekly probe gating, integration                                                                        |

### Modified Files

| File                                   | Change                                                                                                                                                                             | Upstream Risk      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/logging/health-sentinel.ts`       | Added: weekly probe gate (once/week via `lastWeeklyProbeRunMs`), incident files on escalation, inbox summary after every run, TTL cleanup on each cycle, retention config defaults | Low — fully custom |
| `src/logging/health-sentinel-types.ts` | Added: `incidentRetentionDays`, `historyRetentionDays` to `SentinelConfig`; `WeeklyProbes` interface; `weeklyProbes` to `SentinelDeps`                                             | Low — fully custom |
| `src/logging/diagnostic.ts`            | Wired: `weeklyProbes` with `checkBackupFreshness` (config .bak file age) and `checkFilePermissions` (root-owned state dir detection)                                               | Low — additive     |

### Retention Defaults

| Setting                 | Default | What Gets Cleaned                                       |
| ----------------------- | ------- | ------------------------------------------------------- |
| `incidentRetentionDays` | 7       | `{stateDir}/incidents/*.md` and `{stateDir}/inbox/*.md` |
| `historyRetentionDays`  | 14      | Old entries in `sentinel-history.jsonl`                 |

### Tests

- ✅ `health-sentinel-phase3.test.ts`: 19/19 passed
- ✅ `health-sentinel-phase2.test.ts`: 28/28 passed (regression)
- ✅ `health-sentinel.test.ts`: 12/12 passed (regression)
- ✅ `channel-health-monitor.test.ts`: 28/28 passed (regression)
- ✅ `channel-health-policy.test.ts`: 14/14 passed (regression)

---

## Health Sentinel Phase 2 — Enhanced Self-Healing (2026-03-15)

**Purpose:** Six enhancements to the Health Sentinel: disk-cleanup playbook, trend-aware history tracking, persistent rate-limit state across restarts, configurable thresholds via `openclaw.json`, dashboard surface, and doctor-derived probes.

### New Files

| File                                         | Purpose                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/logging/health-sentinel-history.ts`     | JSONL-based history tracking: `appendSentinelReport()`, `getRecentReports()`, `detectTrends()` (persistent/flapping/improving), `formatTrendContext()`. Auto-truncates at 1MB. |
| `src/logging/health-sentinel-phase2.test.ts` | 28 tests: history, trends, disk-cleanup playbook, configurable thresholds, persistent state, doctor probes, dashboard surface                                                  |

### Modified Files

| File                                       | Change                                                                                                                                                                                                                                                                                                                          | Upstream Risk                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/logging/health-sentinel.ts`           | Added: configurable thresholds via `resolveConfig()`, persistent rate-limit state (load/save JSON), history integration, doctor probes appended before classification, `getLastSentinelReport()` dashboard surface, `disk.log_directory` warn → `auto-fixable` (was `warning`), unknown check types classified by actual status | Low — fully custom file                   |
| `src/logging/health-sentinel-types.ts`     | Added: `SentinelConfig` interface, `DoctorProbes` interface, `SentinelDeps.stateDir/config/doctorProbes` fields                                                                                                                                                                                                                 | Low — fully custom file                   |
| `src/logging/health-sentinel-playbooks.ts` | Added: `disk-cleanup` playbook (rotates event logs, verifies disk size dropped), `RemediationContext.rotateEventLogs/checkDiskSpaceMB`                                                                                                                                                                                          | Low — fully custom file                   |
| `src/logging/diagnostic.ts`                | Wired: `stateDir`, `config`, full `remediationContext` (channel restart + probe + disk ops), `doctorProbes` (state dir exist + ephemeral path)                                                                                                                                                                                  | Low — additive to existing sentinel block |

### Architecture Extension

```
Sentinel Check (every ~30 min)
  ├─ Doctor probes: state dir exists?, ephemeral storage?
  ├─ loadPersistentState() from {stateDir}/sentinel-rate-limit.json
  ├─ Classify: disk warn → auto-fixable (disk-cleanup playbook)
  ├─ Tier 1: channel-restart + disk-cleanup playbooks
  ├─ Tier 2: trend-enriched escalation ("persistent: ..., flapping: ...")
  ├─ appendSentinelReport() → {stateDir}/sentinel-history.jsonl
  ├─ savePersistentState() → survives restarts
  └─ lastReport = report (dashboard surface via getLastSentinelReport())
```

### Configurable Thresholds (`openclaw.json → diagnostics.sentinel`)

| Setting                  | Default       | Purpose                    |
| ------------------------ | ------------- | -------------------------- |
| `maxRemediationsPerHour` | 5             | Cap auto-fixes             |
| `issueCooldownMs`        | 900000 (15m)  | Per-issue retry delay      |
| `escalationCooldownMs`   | 1800000 (30m) | Agent escalation delay     |
| `maxEscalationsPerHour`  | 3             | Cap agent wake-ups         |
| `maxConsecutiveFailures` | 3             | Failures before escalation |
| `diskWarnThresholdMB`    | 500           | Disk warning threshold     |
| `errorRateThreshold`     | 50            | Error count threshold      |

### Tests

- ✅ `health-sentinel-phase2.test.ts`: 28/28 passed
- ✅ `health-sentinel.test.ts`: 12/12 passed (regression)
- ✅ `channel-health-monitor.test.ts`: 28/28 passed (regression)
- ✅ `channel-health-policy.test.ts`: 14/14 passed (regression)

---

**Purpose:** Two-tier self-healing system that runs every ~30 minutes via the diagnostic heartbeat. Tier 1 (deterministic) auto-fixes known issues like channel outages via playbooks. Tier 2 (agent-driven) escalates unresolved issues to the agent as structured system events, enabling AI-powered diagnosis and remediation before involving the user.

### New Files

| File                                       | Purpose                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/logging/health-sentinel.ts`           | Main sentinel orchestrator — classify → fix → verify → escalate pipeline with rate limiting (max 5 fixes/hour, 15-min per-issue cooldown, 30-min escalation cooldown) |
| `src/logging/health-sentinel-types.ts`     | Shared types: `ClassifiedIssue`, `SentinelReport`, `RateLimitState`, `SentinelDeps`, `RemediationPlaybook`                                                            |
| `src/logging/health-sentinel-playbooks.ts` | Remediation playbook registry. DI-based `RemediationContext` for testability. `channel-restart` playbook (stop+start via gateway RPC with verify-after-fix)           |
| `src/logging/health-sentinel.test.ts`      | 12 unit tests: classification, orchestration, escalation, rate limiting, graceful error handling                                                                      |

### Modified Files

| File                        | Change                                                                                                                                                                                  | Upstream Risk                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/logging/diagnostic.ts` | Added `sentinelCycleCount` (every 60th heartbeat = ~30 min). Dynamic imports sentinel + infra modules, wires deps, runs `runSentinelCheck()`. Added to `resetDiagnosticStateForTest()`. | Low — additive counter + conditional block after existing health check |

### Architecture

```
Every ~30 min (diagnostic heartbeat, 60th × 30s cycle)
  ├─ Probes: channel health, error rate, disk, gateway port
  ├─ Classifies: healthy | auto-fixable | needs-agent | warning
  ├─ Tier 1: playbook remediation (channel restart) + verify
  └─ Tier 2: composes structured report → enqueueSystemEvent → requestHeartbeatNow
       └─ Agent receives "[HEALTH SENTINEL] Issues detected..." in heartbeat session
          └─ Agent reasons, fixes, or escalates to user
```

### Rate Limiting

| Limit                           | Value  | Purpose                        |
| ------------------------------- | ------ | ------------------------------ |
| Max remediations/hour           | 5      | Prevent auto-fix storm         |
| Per-issue cooldown              | 15 min | Don't hammer the same fix      |
| Escalation cooldown             | 30 min | Don't spam the agent           |
| Max escalations/hour            | 3      | Cap agent wake-ups             |
| Consecutive failures → escalate | 3      | Auto-fix giving up → ask agent |

### Tests

- ✅ `health-sentinel.test.ts`: 12/12 passed
- ✅ `channel-health-monitor.test.ts`: 28/28 passed (regression)
- ✅ `channel-health-policy.test.ts`: 14/14 passed (regression)

### Upstream Sync Risk

**None for new files** — 3 new source files + 1 test file, fully custom.
**Low for `diagnostic.ts`** — additive counter + conditional block inside existing heartbeat interval.

---

## Comprehensive Codebase Cleanup — DRY, Tests & Code Quality (2026-03-15)

**Purpose:** Extract shared utilities, eliminate boilerplate, fix dead code, add missing test coverage, and improve SQLite resource management.

### Phase 1: Shared File Utility Extraction (DRY)

| File                                              | Change                                                                                                                                                                                              | Risk                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/infra/atomic-file.ts`                        | **[NEW]** Shared module: `atomicWriteFile()` (tmp+rename with auto-mkdir, best-effort cleanup), `readTextFileIfExists()` (ENOENT→undefined), `writeTextFileIfChanged()` (diff-check + atomic write) | None — new file          |
| `src/cron/diary-archive.ts`                       | Replaced 3 inline atomic-write blocks with `atomicWriteFile()` (overflow write, identity write, state write) — **~30 lines removed**                                                                | Low — identical behavior |
| `src/cron/isolated-agent/reflection-artifacts.ts` | Replaced local `readTextFileIfExists`, `writeTextFileIfChanged`, `writeOptionalFile` with imports from shared module — **~30 lines removed**                                                        | Low — identical behavior |
| `src/agents/workspace.ts`                         | Replaced `writeWorkspaceOnboardingState` inline atomic-write with `atomicWriteFile()` — **~10 lines removed**                                                                                       | Low — identical behavior |
| `src/cron/transcript-sweep.ts`                    | Replaced 2 inline atomic-write blocks with `atomicWriteFile()` (state write, redaction write) — **~15 lines removed**. Fixed `filesRedacted++` counter that was inside old atomic block.            | Low — bug fix + DRY      |

### Phase 2: Code Quality & Performance

| File                                      | Change                                                                                                                                                                                                                                          | Risk                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `src/auto-reply/reply/tool-stats.ts`      | Extracted `ToolStatsRow` type + `mapToolStatsRow()` helper — DRY'd row mapping in `getToolStats()` and `getTopTools()` (**~40 lines removed**). Added `closeAll()` static method for SQLite connection cleanup at process shutdown.             | Low — DRY + resource management   |
| `src/agents/tools/session-search-tool.ts` | **Bug fix:** `role_filter` parameter was parsed but discarded (`_roleFilter`). Now parsed into a `Set<string>` and applied as post-filter on search results. Exported `truncateAroundMatches`, `expandQuery`, `mergeSearchResults` for testing. | Low — was a no-op, now functional |
| `src/auto-reply/reply/session-search.ts`  | Added `closeAll()` static method to `SessionSearchIndex` for SQLite connection cleanup                                                                                                                                                          | Low — additive                    |

### Phase 3: New Test Coverage

| File                                             | Tests    | Coverage Target                                                                                                                     |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/infra/atomic-file.test.ts`                  | 10 tests | `atomicWriteFile`, `readTextFileIfExists`, `writeTextFileIfChanged` — happy paths, error cases, idempotency                         |
| `src/infra/ephemeral-path.test.ts`               | 14 tests | `parseMountInfoLine` (valid/invalid/various fs types), `isEphemeralPath` (/tmp, /var/tmp, macOS /private/tmp, non-ephemeral)        |
| `src/auto-reply/reply/session-freshness.test.ts` | 7 tests  | `validateSessionPathFreshness` — exists, missing, file-not-dir, mismatch, multi-reason                                              |
| `src/agents/tools/session-search-tool.test.ts`   | 14 tests | `truncateAroundMatches` (centering, markers), `expandQuery` (empty, short, boolean passthrough), `mergeSearchResults` (dedup, rank) |
| `src/auto-reply/reply/tool-stats.test.ts`        | 10 tests | `ToolStatsIndex` — open/cache, record single/batch, upsert, topTools limit, agent isolation, closeAll                               |

---

## Backup Restore Hardening & Cross-Fork Migration Docs (2026-03-15)

**Purpose:** Harden the backup import → restore pipeline for cross-fork migration reliability, document the migration path for users switching from other OpenClaw forks, and clean up code quality issues in the restore script.

### Entrypoint Reordering (Critical Bug Fix)

| File                   | Change                                                                                                                                                                                                                        | Risk                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `docker-entrypoint.sh` | Moved backup restore block **before** `enforce-config.mjs` execution. Previously, restored configs bypassed model enforcement, gateway binding, and security normalization — causing potential crashes on cross-fork imports. | Low — block order change only, no logic modified |

### Restore Script Hardening

| File                             | Change                                                                                                                                                                | Risk                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `scripts/restore-from-backup.sh` | **JSON validation:** Post-restore check validates `openclaw.json` is parseable JSON; renames invalid files to `.pre-restore-invalid` so entrypoint generates defaults | None — additive guard |
| `scripts/restore-from-backup.sh` | **RESTORE_KEY sanitization:** Rejects keys containing `../`, `;`, `&`, `\|` to prevent path traversal / command injection                                             | None — additive guard |
| `scripts/restore-from-backup.sh` | **Import dedup:** Moved `import shutil` to top of Python block (was duplicated 3x inside loop body)                                                                   | None — cosmetic       |
| `scripts/restore-from-backup.sh` | **Dead variable cleanup:** Removed unused bash `RESTORED_COUNT`/`SKIPPED_COUNT` vars; stats now tracked inside Python block with summary line                         | None — cosmetic       |

### Cross-Fork Migration Documentation

| File                        | Change                                                                                                                          | Risk             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `docs/install/migrating.md` | Added "Coming from another OpenClaw fork" section: 4-step guide (backup create → dashboard import → restore → verify)           | None — docs only |
| `docs/install/migrating.md` | Added "Cross-fork compatibility notes" section: compatibility matrix (fully compatible / needs attention / won't work)          | None — docs only |
| `docs/install/migrating.md` | Fixed admonition syntax: converted `:::tip`/`:::note` to standard `> **Tip:**`/`> **Note:**` to match codebase docs conventions | None — docs only |
| `docs/install/migrating.md` | Updated frontmatter `summary` and `read_when` to reflect cross-fork migration scope                                             | None — docs only |

### Upstream Sync Risk

**Low for `docker-entrypoint.sh`** — block order change within custom section, no upstream code modified.
**None for `scripts/restore-from-backup.sh`** — fully custom file.
**None for `docs/install/migrating.md`** — fully custom additions to existing doc.

---

## Autoresearch-Inspired Stability Features (2026-03-15)

**Purpose:** Six targeted improvements to agent stability and self-improvement, inspired by patterns in [karpathy/autoresearch](https://github.com/karpathy/autoresearch) (by [Andrej Karpathy](https://github.com/karpathy)). Autoresearch's `if math.isnan(loss): exit(1)` circuit-breaker pattern and structured experiment logging directly informed the Session Health Sentinel and Structured Learning Log. The skill revision loop mirrors autoresearch's iterative prompt refinement approach.

### Prompt-Level Enhancements (Phase A)

| #   | Feature                     | File                          | Change                                                                                                                                                                                               |
| --- | --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ------- | ----- | ---------- | --- |
| 1   | **Near-Miss Review**        | `src/agents/system-prompt.ts` | Added `session_search` instruction to Autonomous Problem-Solving — agents review past sessions for similar problems before escalating                                                                |
| 2   | **Skill Quality Scoring**   | `enforce-config.mjs`          | New **Phase 2.5: SKILL CROSS-REFERENCE** in self-review cron — cross-references MISSes with existing skills, logs `MISS-SKILL` or `SKILL-GAP` entries                                                |
| 3   | **Skill Revision Loop**     | `enforce-config.mjs`          | New **Phase 0: REVIEW EXISTING SKILLS** in skill-evolution cron — reviews existing skills, diagnoses SKILL-GAP entries, revises in-place. Introduced `version` and `last_revised` frontmatter fields |
| 4   | **Structured Learning Log** | `enforce-config.mjs`          | Self-review cron output format changed from freeform text to markdown table: `                                                                                                                       | Date | Type | Pattern | Skill | Recurrence | `   |

### Code-Level Enhancements (Phase B)

| #   | Feature                     | Files                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **Crash Taxonomy**          | `pi-embedded-helpers/types.ts`, `pi-embedded-helpers.ts`, `failover-error.ts`                                                            | New `FailoverFixability` type (`retry` / `adapt` / `abandon`). `resolveFixability()` maps each `FailoverReason` to its fixability class. Auto-populated `fixability` property on all `FailoverError` instances. Backward-compatible.                                                                                                                       |
| 6   | **Session Health Sentinel** | `session-health.ts` (NEW), `session-health-integration.ts` (NEW), `session-health.test.ts` (NEW), `sessions/types.ts`, `agent-runner.ts` | Circuit breaker detecting cascading failures. Pure-function state management (`createHealthState`, `recordSuccess`, `recordError`), degradation detection (`isSessionDegraded`, `detectRepeatedPattern`), recovery hint injection (`buildRecoveryHint`). Wired into `agent-runner.ts` at 3 points: success (resets), error (records), exception (records). |

### Bug Fix During Cleanup

| Fix                                    | File                | Detail                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `detectRepeatedPattern` false positive | `session-health.ts` | Original `reduceRight` counted ALL buffer occurrences of the last error, not just consecutive trailing ones. `[timeout, rate_limit, timeout, timeout]` would falsely report a pattern (3 total) despite only 2 being consecutive. Fixed with explicit reverse loop that breaks on first mismatch. Regression test added. |

### Tests

- ✅ `session-health.test.ts`: 18/18 passed (including regression test for the `detectRepeatedPattern` fix)
- ✅ TypeScript compilation: zero new errors

### Upstream Sync Risk

**None for new files** — `session-health.ts`, `session-health-integration.ts`, `session-health.test.ts` are fully custom.
**Low for `agent-runner.ts`** — 4 additive lines (import + 3 function calls) at existing success/error/exception boundaries.
**Low for `sessions/types.ts`** — single optional `healthState` field added to `SessionEntry`.
**None for `enforce-config.mjs`** — fully custom file.
**Low for `system-prompt.ts`** — single line added to existing custom section.
**Low for `failover-error.ts`** — additive property + function, all existing behavior preserved.

---

## ACE-Inspired Stability Features (2026-03-15)

**Purpose:** Close two remaining gaps in the OpenClaw reflection pipeline, inspired by the [ACE Platform](https://github.com/DannyMac180/ace-platform) (by [Danny McAteer](https://github.com/DannyMac180)). ACE tracks `helpful`/`harmful` counters on all playbook bullets and keeps structured outcome logs. OpenClaw lacked post-promotion effectiveness tracking on CRITICAL rules and structured auditing of identity modifications.

### Feature 1 — Post-Promotion Evidence Counters

Promoted CRITICAL rules now include `[0H/0M]` counters (hits/misses). After every reflection job, the postflight deterministically scans self-review HIT/MISS entries, correlates them with existing CRITICAL rules via 4-char prefix stemming (handles inflections like "verify"→"verified"), and increments counters in IDENTITY.md. Zero LLM calls — fully deterministic.

Rules where M ≥ H after 3+ observations are flagged as "problematic" and surfaced in `reflection-inbox.md` for the deep-review cron to evaluate for demotion or rewording.

| File                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Upstream Risk                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/cron/diary-archive.ts`                       | **NEW functions:** `parseEvidenceCounters()`, `stemWord()`/`buildStemSet()` (crude prefix stemmer), `correlateHitMissWithRules()`, `updateEvidenceCounters()`, `flagProblematicRules()`. Updated `extractExistingCriticalRules()` regex to handle `[XH/YM]` tags. Changed `promoteMissPatterns()` format from `**CRITICAL:**` to `**CRITICAL [0H/0M]:**`.                                                                                                                                                                        | Low — additive functions + format change isolated to our CRITICAL promotion pipeline                                   |
| `src/cron/isolated-agent/reflection-artifacts.ts` | **Postflight wiring:** evidence counter correlation, inbox problematic rules section. Added imports for `correlateHitMissWithRules`, `extractExistingCriticalRules`, `flagProblematicRules`, `updateEvidenceCounters`. Extended `ReflectionInboxSummary` with `problematicRules`. `updateReflectionInbox()` reads identity file and calls `flagProblematicRules()`. `buildReflectionInboxMarkdown()` renders `## Problematic Rules`. `applyReflectionRunPostflight()` runs evidence counter update after revert/promotion logic. | Medium — touches shared `ReflectionInboxSummary` type (but flows through `reflection-preflight.ts` via type inference) |

### Feature 2 — Structured Identity Change-Log

JSONL append log at `memory/reflection-change-log.jsonl`. Each entry records: timestamp, job ID, file modified, lines changed, whether reverted, promotions count. Auto-pruned at 200 entries.

| File                                              | Change                                                                                                                                                                                                                                             | Upstream Risk                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/cron/isolated-agent/reflection-artifacts.ts` | **NEW functions:** `appendReflectionChangeLog()`, `pruneReflectionChangeLog()`, `ReflectionChangeLogEntry` type. New constant `REFLECTION_CHANGE_LOG_RELATIVE_PATH`. Postflight writes change-log entry when identity changes or promotions occur. | Low — additive functions, best-effort error handling |

### Tests

- ✅ `diary-archive.test.ts`: 55/55 passed (20 new — `parseEvidenceCounters`, `correlateHitMissWithRules`, `updateEvidenceCounters`, `flagProblematicRules`, updated promotion format)
- ✅ `reflection-artifacts.test.ts`: 5 new tests added (`appendReflectionChangeLog`, `pruneReflectionChangeLog`, `updateReflectionInbox` with problematic rules) — blocked by pre-existing `@modelcontextprotocol/sdk` import chain
- ✅ TypeScript compilation: zero new errors

---

## Stale Snapshot Prevention Guards (2026-03-15)

**Purpose:** Prevent three layered failure modes identified in [Brad Mills' (@bradmillscan)](https://x.com/bradmillscan) multi-day OpenClaw stability analysis: (1) critical data stored in ephemeral `/tmp` paths lost on restart, (2) stale workspace/skill paths in long-lived LCM sessions silently breaking agent functionality, (3) session unification race conditions picking up stale context over fresh context.

### Guard 1 — Ephemeral Path Detection

| File                                     | Change                                                                                                                                                                       | Upstream Risk                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `src/infra/ephemeral-path.ts`            | **NEW** — `isEphemeralPath()` utility. Detects `/tmp`, `os.tmpdir()`, `/var/tmp`, macOS `/private/tmp`, and Linux `tmpfs`/`ramfs` mounts via `/proc/self/mountinfo` parsing. | None — new file                       |
| `src/infra/ephemeral-path.test.ts`       | **NEW** — 15 tests: tmpdir detection, prefix false-positive protection, mountinfo line parsing.                                                                              | None — test file                      |
| `src/commands/doctor-state-integrity.ts` | Added ephemeral path check in `noteStateIntegrity()` for state dir, sessions dir, and store path. CRITICAL warning with remediation step (`OPENCLAW_STATE_DIR=~/.openclaw`). | Low — additive, after existing checks |
| `src/config/sessions/paths.ts`           | Added deduplicated one-time stderr warning in `resolveStorePath()` when resolved path is ephemeral. Non-blocking.                                                            | Low — log-only addition               |

### Guard 2 — Session Context Freshness Validation

| File                                             | Change                                                                                                                                                       | Upstream Risk                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `src/auto-reply/reply/session-freshness.ts`      | **NEW** — `validateSessionPathFreshness()`. Checks workspace dir exists on disk + workspace dir matches session report. Returns `{ fresh, staleReasons[] }`. | None — new file                    |
| `src/auto-reply/reply/session-freshness.test.ts` | **NEW** — 8 tests: fresh/stale workspace, file-not-directory, mismatch, combined staleness.                                                                  | None — test file                   |
| `src/auto-reply/reply/session-updates.ts`        | Integrated freshness validation into `ensureSkillSnapshot()`. When workspace is stale, silently forces skill snapshot refresh via `shouldForceRefresh` flag. | Low — non-breaking behavior change |
| `src/auto-reply/reply/commands-system-prompt.ts` | Added workspace existence check before `buildWorkspaceSkillSnapshot()`. Missing workspace → empty skills (no crash).                                         | Low — defensive guard              |

### Guard 3 — Session Store `createdAt` Tracking

| File                           | Change                                                                                                                                                                                                                                             | Upstream Risk                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `src/config/sessions/types.ts` | Added `createdAt?: number` to `SessionEntry` type. Optional for backward compat.                                                                                                                                                                   | Low — additive field                |
| `src/config/sessions/store.ts` | `recordSessionMetaFromInbound()` now sets `createdAt: Date.now()` on new entries. `resolveSessionStoreEntry()` prefers most recent `createdAt` over `updatedAt` when deduplicating legacy keys. Falls back to `updatedAt` when `createdAt` absent. | Low — behavior change for edge case |

### Tests

- ✅ `ephemeral-path.test.ts`: 15/15 passed
- ✅ `session-freshness.test.ts`: 8/8 passed
- ✅ TypeScript compilation: zero new errors (all errors are pre-existing)

### Cleanup & Refactoring (post-implementation audit)

| File                                             | Change                                                                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/infra/ephemeral-path.ts`                    | **Perf:** Cached ephemeral roots via lazy `getEphemeralRoots()` — avoids rebuilding array and calling `os.tmpdir()` per invocation. Used `Set` for deduplication of resolved roots.                                    |
| `src/config/sessions/paths.ts`                   | **Memory safety:** Capped dedup `Set` at 100 entries to prevent unbounded growth in long-running processes. Replaced raw `process.stderr.write` with `createSubsystemLogger("sessions/paths")` for structured logging. |
| `src/auto-reply/reply/commands-system-prompt.ts` | **Observability:** Added `log.warn` with `createSubsystemLogger("commands-system-prompt")` when workspace directory is missing — previous version silently returned empty skills.                                      |
| `src/infra/ephemeral-path.test.ts`               | **Test quality:** Replaced conditional `if (platform)` with vitest `it.skipIf` for consistent test counts across platforms.                                                                                            |
| `src/config/sessions/store.ts`                   | **Edge case hardening:** Guard 3 `createdAt` comparison now handles mixed presence (only one entry has `createdAt`). Entry WITH `createdAt` wins since it was created under the new guard system.                      |

### Upstream Sync Risk

**None for new files** — 4 new files with no upstream conflict possible.
**Low for modified files** — all changes are additive (imports, fields, conditional guards after existing logic).

---

## Cron Schedule Redesign — Overlap Elimination & Startup Burst Fix (2026-03-15)

**Purpose:** Audit and redesign all cron job schedules across `vercel.json`, `enforce-config.mjs`, and `default-jobs.json` to eliminate overlapping schedules, prevent a 10-job startup burst (all interval jobs using `anchorMs: nowMs` fired simultaneously on boot), and refine sub-agent cron seeding.

### Schedule Changes — Interval → Fixed Cron (6 jobs)

Interval-based jobs with `anchorMs: nowMs` fired unpredictably and all at once on startup. Converted to fixed [croner](https://github.com/hexagon/croner) 5-field cron expressions for wall-clock predictability.

| Job                        | Was                          | Now                                                  |
| -------------------------- | ---------------------------- | ---------------------------------------------------- |
| `self-review`              | every 12h, `anchorMs: nowMs` | `0 6,18 * * *` (06:00 + 18:00 UTC)                   |
| `deep-review`              | every 48h, `anchorMs: nowMs` | `0 4 */2 * *` (every 2 days at 04:00 UTC)            |
| `browser-cleanup`          | every 24h, `anchorMs: nowMs` | `0 14 * * *` (daily 14:00 UTC)                       |
| `brainx-extract-facts`     | every 8h, `anchorMs: nowMs`  | `0 1,9,17 * * *` (3× daily: 01:00, 09:00, 17:00 UTC) |
| `brainx-advisory-warnings` | every 4h, `anchorMs: nowMs`  | `0 3,7,11,15,19,23 * * *` (6× daily, odd hours)      |
| `memory-extraction`        | every 24h, `anchorMs: nowMs` | `0 10 * * *` (daily 10:00 UTC)                       |

### Schedule Changes — Staggered Anchors (4 remaining interval jobs)

Jobs that benefit from interval semantics (variable cadence, `NEXT_WAKE:` overrides) kept `kind: "every"` but got staggered anchor offsets to prevent the startup burst.

| Job                          | Interval | Anchor Offset   |
| ---------------------------- | -------- | --------------- |
| `auto-tidy`                  | 72h      | `nowMs + 1h`    |
| `openclaw-backup`            | 12h      | `nowMs + 30min` |
| `consciousness`              | 12h      | `nowMs + 2h`    |
| `healthcheck-security-audit` | 7d       | `nowMs + 4h`    |

### Vercel Dashboard Fix

| File                            | Fix                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `moltbot-dashboard/vercel.json` | `cleanup-safety-snapshots` moved from `0 0 * * *` → `30 0 * * *` to resolve exact midnight overlap with `server-metrics` |

### Sub-Agent Seeding — `MAIN_ONLY_JOBS` Expansion

Added 3 jobs to the `MAIN_ONLY_JOBS` Set in `enforce-config.mjs` to prevent redundant seeding to sub-agents:

| Job                        | Reason                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `openclaw-backup`          | Platform-level — backs up the entire state directory, not per-agent |
| `brainx-extract-facts`     | Global processor — uses `listAgentIds()` to iterate all agents      |
| `brainx-advisory-warnings` | Global processor — uses `listAgentIds()` to iterate all agents      |

### Safety Bounds — `scanMemoryFiles()` (`advisory-warnings.ts`)

Added `MAX_FILES = 50` and `MAX_FILE_BYTES = 256KB` limits to `scanMemoryFiles()` in `src/brainx/advisory-warnings.ts`. Prevents unbounded memory consumption on workspaces with many memory files or oversized individual files. Uses `fs.statSync()` pre-check before `readFileSync()`.

### `default-jobs.json` Sync

Synced 5 schedule entries in `cron/default-jobs.json` to match the updated schedules in `enforce-config.mjs`.

### Verification

- ✅ All 11 cron expressions confirmed valid 5-field croner format
- ✅ BrainX tests: 3 suites, 63/63 passed
- ✅ No startup burst — interval jobs staggered by 30min–4h offsets

### Upstream Sync Risk

**None** — `enforce-config.mjs` is fully custom. `cron/default-jobs.json` is fully custom. `src/brainx/advisory-warnings.ts` is fully custom. `moltbot-dashboard/vercel.json` is fully custom.

---

## Cron Payload Sync — `enforce-config.mjs` ← `default-jobs.json` (2026-03-15)

**Purpose:** Sync all cron job payloads in `enforce-config.mjs` with the more evolved `default-jobs.json` versions. `default-jobs.json` had accumulated improvements (anti-waste rules, boundary rules, HEARTBEAT_OK guidance, Standing Corrections, content hygiene) that weren't reflected in the enforced seed payloads — meaning newly provisioned agents got the robust version, but the enforce path could overwrite with stale ones.

### Payload Upgrades (7 jobs)

| Job                  | Key Changes                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto-tidy`          | Full Phase 2 content hygiene (WORKING.md, self-review, open-loops, session-context, MEMORY, improvement-backlog, diary). BrainX file awareness — trim at caps (16k/4k), flag if stale >7 days.                                 |
| `self-review`        | Anti-waste rules, `reflection-inbox.md` as starting point, **Phase 4: Cross-Pollinate Corrections** (MISS fixes → `MEMORY.md ## Standing Corrections`), `lightContext: true`, `model: "{{PRIMARY_MODEL}}"`.                    |
| `consciousness`      | Schedule 5h → **12h**. `NEXT_WAKE` default → **12h** (was 2h — mismatch). Anti-waste/boundary rules, `HEARTBEAT_OK` guidance, identity mostly read-only (deep-review owns broad edits), `lightContext`.                        |
| `deep-review`        | New **Phase 0: Mandatory Promotion Scan** (reflection-inbox + self-review MISS patterns → force promote to CRITICAL in IDENTITY.md). BrainX file cleanup in Phase 4 (prune stale facts, resolve old warnings). `lightContext`. |
| `morning-briefing`   | **Correction Check** at top of payload: read `self-review.md` + `MEMORY.md Standing Corrections` before composing. Anti-repeat rule added to RULES section.                                                                    |
| `self-audit-21`      | "Read ENTIRE backlog including 📦 Archive before writing" anti-duplicate rule.                                                                                                                                                 |
| `nightly-innovation` | Already in sync — no changes needed.                                                                                                                                                                                           |

### New Jobs (2)

| Job                       | Schedule | Description                                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memory-extraction`       | 24h      | LLM-powered semantic fact extraction into `memory/extracted-facts.md`. 5 categories: `[preference]`, `[fact]`, `[entity]`, `[decision]`, `[open]`. Deduplicates against existing memory. Complements regex-based `brainx-extract-facts`. Inspired by [OpenViking](https://github.com/volcengine/OpenViking). |
| `workspace-doc-converter` | Disabled | On-demand trigger for the workspace document converter. Background sidecar handles this automatically.                                                                                                                                                                                                       |

### Bug Fixes

| Fix                         | File                 | Detail                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing noise patterns (×5) | `noise-patterns.ts`  | `SYSTEM TASK`, `SKILL EVOLUTION`, `SECURITY AUDIT`, `Run openclaw` patterns missing from `CRON_PROMPT_PATTERNS`. 6 cron jobs (`brainx-extract-facts`, `brainx-advisory-warnings`, `skill-evolution`, `healthcheck-security-audit`, `healthcheck-update-status`, `openclaw-backup`) were leaking into session context as real user messages. |
| Reflection patching gap     | `enforce-config.mjs` | `skill-evolution` uses `reflectionEnabled` at seed time but wasn't toggled in the reflection patching loop for existing agents. Disabling reflection wouldn't disable it for already-provisioned agents. Now included in 4-tier reflection patching.                                                                                        |

### Upstream Sync Risk

**None** — `enforce-config.mjs` is fully custom. `noise-patterns.ts` is fully custom. `cron/default-jobs.json` is fully custom.

---

## OpenViking Feature Adoptions + Codebase Cleanup (2026-03-15)

**Purpose:** Adopt four features from [Volcengine/OpenViking](https://github.com/volcengine/OpenViking) into the OpenClaw memory subsystem: hotness scoring for search results, mechanical query rewriting, per-tool usage statistics, and automatic structured memory extraction. Followed by a comprehensive cleanup pass across all modified files.

### Feature 1 — Hotness Scoring (session-search.ts)

Inspired by [OpenViking's hotness scoring](https://github.com/volcengine/OpenViking) — frequently accessed search results are ranked higher via a decay-weighted access signal.

| File                                     | Change                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-reply/reply/session-search.ts` | Added `access_count` INTEGER and `last_accessed` REAL columns via idempotent `ALTER TABLE` migration. FTS5 query restructured as **subquery + LEFT JOIN** (FTS5 doesn't support table aliases in MATCH clauses). Scoring blends FTS5 rank with `sigmoid(log1p(access_count)) × exp_decay(age_days, half_life=7)`. New `recordAccess()` method auto-increments hits. |

### Feature 2 — Query Rewriting (session-search-tool.ts)

Inspired by [OpenViking's query expansion](https://github.com/volcengine/OpenViking) — mechanical OR-expansion for better recall without LLM latency.

| File                                      | Change                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/tools/session-search-tool.ts` | New `expandQuery()` function — multi-word queries get OR-expanded variants (e.g. `docker networking` → `docker OR networking`). Quoted phrases, single words, and explicit boolean queries skip expansion. New `mergeSearchResults()` deduplicates by `sessionId:timestamp:role`, keeps best rank per entry. Search now runs 2 variants (original + OR-expanded), merges results. |

### Feature 3 — Tool Usage Statistics (NEW: tool-stats.ts)

Inspired by [OpenViking's per-tool statistics accumulation](https://github.com/volcengine/OpenViking).

| File                                     | Change                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-reply/reply/tool-stats.ts`     | **NEW** — `ToolStatsIndex` class backed by `tool_stats` table in shared `sessions.db`. Tracks `call_count`, `success_count`, `fail_count`, `total_duration_ms`, `last_used` per tool per agent. `recordToolCall()` (upsert), `recordToolCalls()` (transaction-wrapped batch), `getToolStats()`, `getTopTools()` (SQL LIMIT). |
| `src/auto-reply/reply/session-search.ts` | `indexTranscriptForSearch()` now extracts tool calls from assistant `toolCall`/`tool_use`/`function` blocks plus tool result success/failure, then records via `ToolStatsIndex.recordToolCalls()`.                                                                                                                           |

### Feature 4 — Automatic Memory Extraction (cron job)

Inspired by [OpenViking's automatic memory extraction](https://github.com/volcengine/OpenViking) — structured fact extraction with deduplication against existing memory files.

| File                                     | Change                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cron/default-jobs.json`                 | New `memory-extraction` job (24h interval). 5-category extraction prompt: `[preference]`, `[fact]`, `[entity]`, `[decision]`, `[open]`. Agent reads recent transcripts, deduplicates against `memory/extracted-facts.md` and `MEMORY.md`, appends only new structured facts. Includes size-check phase (consolidate/prune at 200 lines). |
| `src/auto-reply/reply/noise-patterns.ts` | Added `MEMORY EXTRACTION` to `CRON_PROMPT_PATTERNS` to prevent session-context pollution.                                                                                                                                                                                                                                                |

### Codebase Cleanup (14+ fixes)

Comprehensive cleanup pass across all OpenViking-modified files.

**Performance:**

| Fix                                | Files                                | Detail                                                                                                                                                         |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction-wrapped batch SQL (×3) | `session-search.ts`, `tool-stats.ts` | `indexMessages()` and `recordToolCalls()` wrapped in explicit BEGIN/COMMIT — reduces N fsyncs to 1. `getTopTools()` uses SQL `LIMIT` instead of JS `.slice()`. |
| O(1) cache cleanup (×2)            | `session-search.ts`, `tool-stats.ts` | Stored `workspaceDir` field on instances, replaced O(n) `[...entries()].find()` with direct `Map.delete(this.workspaceDir)`.                                   |

**Code Quality:**

| Fix                             | Files                    | Detail                                                                                                |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Orphaned JSDoc                  | `session-search.ts`      | Stale "Close the database" comment before `recordAccess()` moved to correct location above `close()`. |
| Verbose inline `import()` types | `session-search-tool.ts` | Replaced with proper `SessionSearchResult` import.                                                    |
| Unused constant                 | `session-search-tool.ts` | Removed dead `MAX_SUMMARY_TOKENS`.                                                                    |
| Unused variable                 | `session-search-tool.ts` | Prefixed `roleFilter` → `_roleFilter`.                                                                |

**Robustness:**

| Fix                      | Files               | Detail                                                                                     |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------ |
| Improved error detection | `session-search.ts` | Tool result error heuristic now case-insensitive + catches `"failed:"` and `"exception:"`. |
| Replaced `findLast()`    | `session-search.ts` | ES2023's `findLast()` → plain reverse `for` loop for broader Node.js compatibility.        |
| Transaction rollback     | `tool-stats.ts`     | `recordToolCalls()` catches failures and issues ROLLBACK.                                  |
| Empty batch guard        | `tool-stats.ts`     | Early return on empty call arrays.                                                         |

### Upstream Sync Risk

**None** — all changes are in fully custom files (`session-search.ts`, `tool-stats.ts`, `session-search-tool.ts`, `noise-patterns.ts`, `default-jobs.json`).

---

## Context Injection — Bootstrap Budget & BrainX Files (2026-03-15)

**Purpose:** Wire BrainX-generated memory files into the agent's bootstrap context so extracted facts and advisory warnings are automatically visible every turn. Also tripled the WORKING.md budget to give agents more working-state context.

### Changes

| File                                          | Change                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-helpers/bootstrap.ts` | `WORKING_MAX_CHARS` 4k → **12k**. New constants: `EXTRACTED_FACTS_MAX_CHARS` (16k), `ADVISORY_WARNINGS_MAX_CHARS` (4k). Wired into `buildBootstrapContextFiles()` with `hasBuiltInCap` to suppress truncation warnings. |
| `src/agents/workspace.ts`                     | Registered `memory/extracted-facts.md` and `memory/advisory-warnings.md` as optional bootstrap entries in `loadWorkspaceBootstrapFiles()`. Only included when files exist on disk (after first cron run).               |
| `enforce-config.mjs`                          | Auto-tidy cron updated: agents now know to leave brainx auto-generated files alone and flag stale entries (>7 days).                                                                                                    |

### Upstream Sync Risk

**Low for `workspace.ts`** — new entries appended after session-context block.
**None for `bootstrap.ts`** — MoltBot-custom constants + conditions.
**None for `enforce-config.mjs`** — fully custom cron definition.

---

## Agent Resilience — Autonomous Problem-Solving (2026-03-15)

**Purpose:** Teach agents to exhaust all alternative approaches before escalating failure to the user. Instead of surrendering at the first obstacle, agents now diagnose failures, try different tools, strategies, workarounds, and documentation searches. When escalating is truly necessary, agents report what was tried and why each approach failed. Inspired by emergent behavior observed in [Anthropic Claude](https://www.anthropic.com) agents that autonomously discover workarounds when explicitly encouraged to try alternatives.

### Changes (moltbotserver-source)

| File                                     | Change                                                                                                                                                                                                                                                           | Upstream Risk        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/agents/system-prompt.ts`            | New **"Autonomous Problem-Solving"** section after Operating Discipline: diagnose → try alternatives → escalate with report. Conditionally injected in `full` prompt mode only. +`import path from "node:path"` added for `path.resolve` usage in health nudges. | Low — custom section |
| `src/agents/system-prompt.ts`            | Sharpened **"OVER-DELIVERY IS FAILURE"** wording — distinguished _scope expansion_ (reckless) from _effort within scope_ (thorough and relentless). Original wording treated all extra effort as "over-delivery."                                                | Low — custom section |
| `SOUL.md`                                | Added **"Exhaust Before Escalating"** subsection under "Take Initiative" — philosophical framing: failure isn't always a dead end, and the best agents treat it as a routing problem                                                                             | None — fully custom  |
| `docs/reference/templates/SOUL.md`       | Mirrored "Exhaust Before Escalating" to template for new workspaces                                                                                                                                                                                              | None — fully custom  |
| `IDENTITY.md`                            | Added resilience bullet under "How You Work": try multiple alternatives before escalating, report what was attempted                                                                                                                                             | None — fully custom  |
| `docs/reference/templates/IDENTITY.md`   | Mirrored resilience bullet to template                                                                                                                                                                                                                           | None — fully custom  |
| `docs/reference/templates/OPERATIONS.md` | Added **"First-failure surrender"** entry to Drift Detector section — teaches agents to recognize when they're giving up too easily                                                                                                                              | None — fully custom  |
| `src/agents/system-prompt.test.ts`       | 3 new tests: section present in full prompts, omitted in minimal, sharpened wording verified                                                                                                                                                                     | None — test file     |

### Layered Design

The resilience principle is injected at four layers to reinforce behavior:

```
Hardcoded (system-prompt.ts)  →  Step-by-step procedure when tools/actions fail
Philosophy (SOUL.md)          →  "Failure is a routing problem, not a dead end"
Identity (IDENTITY.md)        →  "I don't surrender at the first obstacle"
Operations (OPERATIONS.md)    →  Drift detector catches premature escalation
```

### Upstream Sync Risk

**Low for `system-prompt.ts`** — new conditionally-injected section + wording tweak in MoltBot-custom "Operating Discipline."
**None for all other files** — fully custom workspace templates and doc files.

---

## system-prompt.ts Cleanup — Bug Fix & Refactoring (2026-03-15)

**Purpose:** Three fixes found during comprehensive codebase audit: a latent bug in health nudges, dead code removal, and a repeated-condition refactor.

### Fix 1 — Bug: `fs.statSync` with relative path (L887-888)

| Before                           | After                                                                                   | Why                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs.statSync(identityFile.path)` | `path.resolve(params.workspaceDir, identityFile.path)` then `fs.statSync(absolutePath)` | `EmbeddedContextFile.path` is a display path (e.g. `./IDENTITY.md`), not an absolute path. `statSync` would only work if `process.cwd()` happened to match the workspace directory — the stale IDENTITY.md health nudge was silently broken in most deployments. |

### Fix 2 — Dead code: no-op ternary (L573)

| Before                               | After   |
| ------------------------------------ | ------- |
| `hasGateway && !isMinimal ? "" : ""` | Removed |

The ternary always produced `""` regardless of condition. Was leftover from a refactor of the self-update section.

### Fix 3 — Refactor: model-alias repeated condition (L609-618)

| Before                                                                                                                                | After                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Same `params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal` condition evaluated **4 times** on consecutive lines | Single conditional spread: `...((params.modelAliasLines?.length ?? 0) > 0 && !isMinimal ? [...] : [])` |

Follows the conditional-spread pattern used elsewhere in the file (e.g. docsSection, sandboxInfo).

### Verification

- ✅ TypeScript compilation — passed (zero `system-prompt.ts` errors)
- ⚠️ Vitest blocked by pre-existing `@modelcontextprotocol/sdk` dependency issue

### Upstream Sync Risk

**Low.** All fixes are in MoltBot-custom sections of `system-prompt.ts`.

---

## BrainX-Inspired Memory Enrichment (2026-03-15)

**Purpose:** Standalone cron-based fact extraction and advisory warning system, adapted from [BrainX](https://github.com/Mdx2025/-BrainX-The-First-Brain-for-OpenClaw). Designed for LCM compatibility (sessions never reset, memory flush inactive). Zero upstream conflicts.

### New Files

| File                                                   | Purpose                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/brainx/paths.ts`                                  | Shared utilities: path resolution, transcript parsing (5MB read cap), CLI arg parsing                                                 |
| `src/brainx/extract-facts.ts`                          | Scans session JSONL transcripts → extracts URLs, repos, ports, branches, env var names, services → writes `memory/extracted-facts.md` |
| `src/brainx/advisory-warnings.ts`                      | Scans diary/memory files → detects deploy failures, dangerous commands, auth errors, crashes → writes `memory/advisory-warnings.md`   |
| `src/brainx/paths.test.ts`                             | 14 tests for shared module                                                                                                            |
| `src/brainx/extract-facts.test.ts`                     | 26 tests for fact extractor                                                                                                           |
| `src/brainx/advisory-warnings.test.ts`                 | 23 tests for advisory warnings                                                                                                        |
| `docs/reference/templates/memory/MEMORY_GUIDELINES.md` | Workspace template — quality guidance for agent diary writes                                                                          |

### Modified Files

| File                      | Change                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `enforce-config.mjs`      | Added 2 cron entries: `brainx-extract-facts` (8h), `brainx-advisory-warnings` (4h) |
| `tsdown.config.ts`        | Added brainx entry points so scripts compile to `dist/brainx/`                     |
| `src/agents/workspace.ts` | Added `memory/MEMORY_GUIDELINES.md` to workspace template seeding (1 line)         |

### Security

- Env var regex captures **key names only** (e.g. `DATABASE_URL`), never values — prevents credential leakage into plaintext memory files.
- Rate limiting regex requires context (`status 429`, `rate limited`) — prevents false positives from bare numeric matches.

### Architecture

Cron-based design: LCM's `session.reset.idleMinutes = 1576800` (3 years) means sessions never reset, `persistSessionContextOnReset` and `shouldRunMemoryFlush` are effectively dead code. Cron jobs are the only reliable periodic hook.

### Tests

3 suites, 63/63 passed: `paths` (14), `extract-facts` (26), `advisory-warnings` (23).

---

## Comprehensive Cleanup & Security Hardening (2026-03-15)

**Purpose:** Full audit and cleanup of all uncommitted changes (23 files). Removed ~185 lines of dead SupaSwarm code, hardened LCM plugin installation against shell injection, and made the Docker LCM prebake step resilient to npm registry failures.

### Dead Code Removal

| File                                       | Lines Removed | What                                                                                                                                                              |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforce-config.mjs`                       | ~135          | `SUPASWARM_MODELS` array (38 lines), `if (false) { ... }` SupaSwarm registration block (87 lines), stale JSDoc on `enforceProviders()`, unused `changed` variable |
| `src/commands/onboard-auth.models.ts`      | ~34           | All SupaSwarm exports: `SUPASWARM_DEFAULT_MODEL_ID`, `SUPASWARM_DEFAULT_MODEL_REF`, cost/window constants, model catalog, `buildSupaSwarmModelDefinition()`       |
| `src/commands/onboard-auth.credentials.ts` | ~16           | `SUPASWARM_DEFAULT_MODEL_REF` re-export, `setSupaSwarmConfig()` function                                                                                          |

**Verification:** `grep -rn` for `supaswarm` across `src/` and `enforce-config.mjs` returns zero matches.

### Security Hardening — `enforceLCM()`

| Before                                              | After                                                              | Why                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `execSync('cp -r "${prebakedDir}" "${pluginDir}"')` | `cpSync(prebakedDir, pluginDir, { recursive: true })`              | Eliminates shell injection surface — `prebakedDir`/`pluginDir` derived from env vars |
| No validation before `chown` execSync               | Path validated against shell metacharacter regex before `execSync` | Defense-in-depth for the remaining shell call (no `cpSync` equivalent for `chown`)   |
| `cpSync` not imported                               | Added to `node:fs` import list                                     | Required for the above change                                                        |

### Dockerfile LCM Prebake Robustness

| Before                                                             | After                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hard `&&` chain — `npm pack` failure kills the entire Docker build | Subshell with `\|\| echo` fallback — logs "non-fatal" and continues; `enforceLCM()` handles the missing prebake gracefully at runtime |

### Tests

5/5 suites, 59/59 tests passed: `diary-archive` (36), `skills` (14), `skills.build-workspace-skills-prompt` (7), `skills.resolveskillspromptforrun` (2).

### Upstream Sync Risk

**None.** All changes are in fully custom files (`enforce-config.mjs`, `Dockerfile`, MoltBot-added TypeScript sections).

---

## Failure-Driven Skill Evolution Cron Job (2026-03-15)

**Purpose:** Automatically generate reusable `SKILL.md` files from recurring failure patterns. Inspired by [MetaClaw](https://github.com/aiming-lab/MetaClaw)'s concept of failure-driven adaptation via structured reflection, adapted to MoltBot's existing self-review → skill auto-discovery pipeline.

### Architecture

```
self-review.md (MISS log, maintained by deep-review cron)
  │  3+ occurrences OR flagged "PROMOTION REQUIRED"
  ▼
skill-evolution cron (weekly)
  ├─ Phase 1: Identify candidates from self-review + diary context
  ├─ Phase 2: Evaluate: behavioral rule → skip (IDENTITY.md handles these)
  │                      procedural skill → generate
  │                      duplicate → skip
  ├─ Phase 3: Generate max 2 SKILL.md files per cycle
  └─ Phase 4: Log to diary.md

.agents/skills/<skill-name>/SKILL.md
  └─ Auto-discovered by workspace skill loader at next agent run
```

### Changes (moltbotserver-source)

| File                 | Change                                                                                               | Upstream Risk            |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `enforce-config.mjs` | Added `skill-evolution` job in `buildCanonicalJobs()` between `deep-review` and `nightly-innovation` | None — fully custom file |

### Job Configuration

| Property       | Value                                           | Rationale                                                      |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Schedule       | Every 7 days (`everyMs: 604800000`), +6h offset | Weekly cadence, offset from reflection jobs                    |
| Scope          | All agents (not in `MAIN_ONLY_JOBS`)            | Each agent evolves its own skill library from its own failures |
| Enabled        | Gated behind `reflectionEnabled`                | Only active when reflection system is enabled                  |
| Delivery       | `none` (silent)                                 | No user-facing output                                          |
| Session        | `isolated`, `next-heartbeat`                    | Dedicated context, doesn't interfere with conversations        |
| Max skills/run | 2                                               | Quality over quantity                                          |

### Prompt Design

The job uses a pure cron-prompt approach (no TypeScript changes). The prompt instructs the agent to:

1. Read `memory/self-review.md` for recurring MISS patterns (3+ occurrences)
2. Cross-reference `memory/diary.md` for failure context
3. Check existing `.agents/skills/` to avoid duplicates
4. Distinguish behavioral rules (→ skip, handled by CRITICAL promotion in IDENTITY.md) from procedural skills (→ generate)
5. Create SKILL.md files with proper YAML frontmatter, `## When to Use`, `## Steps`, `## Common Pitfalls` sections
6. Log results to `memory/diary.md`

### How Existing Agents Get It

The `buildCanonicalJobs()` backfill mechanism in `seedCronJobs()` detects new canonical jobs not yet in `knownJobs` and adds them automatically on the next gateway restart.

### Upstream Sync Risk

**None.** `enforce-config.mjs` is a fully custom file. The new job follows the exact same structure as existing canonical jobs.

---

## Progressive Disclosure Skills — Token-Efficient Skill Index (2026-03-15)

**Purpose:** Reduce system prompt token usage by ~50-60% for the skills index. Instead of embedding full XML skill metadata (name, description, file location) for every skill, the system prompt now shows a compact one-line-per-skill index. The agent loads full SKILL.md content on demand via a new `skill_view` tool. Inspired by the [Hermes Agent](https://github.com/NousResearch/hermes-agent) progressive disclosure architecture.

### Architecture

```
System Prompt → compact index (name + description ≤80 chars per skill)
Agent needs skill → skill_view(name) → loads full SKILL.md content
Agent needs linked file → skill_view(name, file="references/api.md") → loads relative file
```

### Changes (moltbotserver-source)

| File                                           | Change                                                                                                     | Upstream Risk              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| `src/config/types.skills.ts`                   | Added `progressiveDisclosure?: boolean` to `SkillsConfig` (default: `true`)                                | Low — additive field       |
| `src/agents/skills/workspace.ts`               | Added `formatSkillsCompactPrompt()` — Hermes-style `- name: desc (≤80)` format                             | Low — new private function |
| `src/agents/skills/workspace.ts`               | `resolveWorkspaceSkillPromptState()` routes to compact or XML format based on config                       | Low — conditional branch   |
| `src/agents/tools/skill-view-tool.ts`          | **NEW** — `skill_view` tool: O(1) name lookup, path traversal guard, 200K char truncation, ENOENT handling | None — fully custom        |
| `src/agents/openclaw-tools.ts`                 | Conditional `skill_view` registration when progressive disclosure enabled + skills available               | Low — additive             |
| `src/agents/pi-tools.ts`                       | Added `resolvedSkills` option threading to `createOpenClawTools`                                           | Low — additive field       |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Passes `resolvedSkills` from `skillsSnapshot` to tool creation                                             | Low — single field         |
| `src/agents/pi-embedded-runner/compact.ts`     | Same as above for compact runner                                                                           | Low — single field         |
| 4 test files                                   | Updated to pass `progressiveDisclosure: false` for legacy format assertions; added compact format test     | None — test changes        |

### Design Decisions

- **Default: true** — progressive disclosure saves tokens by default. Set `skills.progressiveDisclosure: false` in openclaw.json to revert to upstream XML format.
- **Conditional tool registration** — `skill_view` is only registered when progressive disclosure is active AND resolved skills exist. When disabled, agents use the generic `read` tool with file paths from the XML format.
- **Security** — `skill_view` includes path traversal prevention (resolved path must stay inside skill's `baseDir`), content truncation at 200K chars, and proper ENOENT error messages.
- **Case-insensitive matching** — skill names are indexed both as-is and lowercase for resilient lookup.

### Upstream Sync Risk

**Low for `workspace.ts`** — new private function + conditional branch in `resolveWorkspaceSkillPromptState`. If upstream changes the function signature, re-wire.
**Low for `openclaw-tools.ts`, `pi-tools.ts`** — additive field threading. Clean merge.
**None for `skill-view-tool.ts`** — fully custom new file.

---

## Self-Delegation Guidance in OPERATIONS.md (2026-03-15)

**Purpose:** Teach agents when and how to break their own work into focused subtasks using existing `sessions_spawn` infrastructure. The delegation section already covered planning and orchestration, but was missing the key self-delegation pattern — spawning subtasks to keep your own context clean.

### Changes (moltbotserver-source)

| File            | Change                                                                                          | Upstream Risk          |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| `OPERATIONS.md` | Added "Self-Delegation — When to Break Your Own Work Into Subtasks" subsection under Delegation | None — custom template |

### Content Added

- **4 triggers** for self-delegation: 3+ independent items, research vs execution phases, large tool outputs, different expertise profiles
- **Code examples** showing focused `sessions_spawn(mode="run")` patterns with structured result requests
- **4 anti-patterns**: don't over-delegate, don't delegate context-dependent tasks, keep delegation flat, don't spawn-and-forget
- **Result synthesis guidance**: distill child outputs into coherent answers

### Upstream Sync Risk

**None.** `OPERATIONS.md` is a custom workspace template.

---

## SupaSwarm Integration Hiding (2026-03-15)

**Purpose:** Remove all SupaSwarm references from the onboarding CLI, auth choice menus, and provider config. SupaSwarm remains functional at runtime (enforce-config.mjs handles provider registration when env vars are set) but is no longer visible in the setup flow.

### Changes (moltbotserver-source)

| File                                              | Change                                                                                                                                       | Upstream Risk           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/commands/auth-choice-options.ts`             | Removed `supaswarm` from `API_KEY_TOKEN_PROVIDER_AUTH_CHOICE`                                                                                | None — custom additions |
| `src/commands/auth-choice.apply.api-providers.ts` | Removed entire `supaswarm-api-key` auth choice handler (~43 lines)                                                                           | None — custom code      |
| `src/commands/auth-choice.preferred-provider.ts`  | Removed `supaswarm-api-key` → `supaswarm` mapping                                                                                            | None — custom entry     |
| `src/commands/onboard-auth.config-core.ts`        | Removed `applySupaSwarmProviderConfig()` + `applySupaSwarmConfig()` (~40 lines)                                                              | None — custom code      |
| `src/commands/onboard-auth.ts`                    | Removed SupaSwarm re-exports                                                                                                                 | None — custom exports   |
| `src/commands/onboard-provider-auth-flags.ts`     | Removed `supaswarmApiKey` CLI flag definition                                                                                                | None — custom entry     |
| `src/commands/onboard-types.ts`                   | Removed `supaswarm-api-key` from `BuiltInAuthChoice`, `supaswarm` from group IDs, `supaswarmApiKey`/`supaSwarmBaseUrl` from `OnboardOptions` | None — custom types     |
| `src/secrets/provider-env-vars.ts`                | Removed `supaswarm` from `PROVIDER_ENV_VARS`                                                                                                 | None — custom entry     |
| `enforce-config.mjs`                              | SupaSwarm runtime registration wrapped in `if (false)` guard (dead code, ready for re-enable)                                                | None — custom file      |

### Upstream Sync Risk

**None.** All SupaSwarm code was custom. The `if (false)` guard in enforce-config.mjs preserves the implementation for easy re-enable.

---

## Lossless Claw (LCM) Plugin — Pre-Bake & Enforcement (2026-03-15)

**Purpose:** Pre-bake the [Lossless Claw](https://github.com/martian-engineering/lossless-claw) context engine plugin into the Docker image and auto-install it on container startup. Provides DAG-based conversation memory as an alternative to default compaction.

### Changes (moltbotserver-source)

| File                 | Change                                                                                               | Upstream Risk      |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------ |
| `Dockerfile`         | Added `npm pack @martian-engineering/lossless-claw` + install step in pre-bake layer                 | None — custom file |
| `enforce-config.mjs` | Added `enforceLCM()` — copies pre-baked plugin to extensions dir on startup if not already installed | None — custom file |
| `enforce-config.mjs` | Added `lcm` command + included in `all` command chain                                                | None — custom file |

### Upstream Sync Risk

**None.** All changes are in fully custom files.

---

## Workspace Context Security Scanning (2026-03-15)

**Purpose:** Scan workspace bootstrap files (SOUL.md, IDENTITY.md, AGENTS.md, etc.) for prompt injection before they enter the system prompt. Quarantined content gets wrapped with ACIP boundary markers so the agent treats it as untrusted. Fail-open design: if the scanner crashes, content passes through unchanged.

### Changes (moltbotserver-source)

| File                                        | Change                                                                                                                                | Upstream Risk                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `src/agents/workspace.ts`                   | Added `scanWorkspaceContent()` helper; applied to both `loadWorkspaceBootstrapFiles()` and `loadExtraBootstrapFilesWithDiagnostics()` | Medium — touches core bootstrap loading |
| `src/security/external-content.ts`          | Added `workspace_context` to `ExternalContentSource` type + label                                                                     | Low — additive                          |
| `src/agents/workspace.context-scan.test.ts` | **NEW** — 7 tests: clean pass-through, injection quarantine, mixed files, fail-open, low-severity skip                                | None — test file                        |

### Design Decisions

- **Fail-open** — scanner failure means content passes through unchanged (availability over strictness)
- **ACIP boundary markers** — quarantined content is wrapped, not dropped, so agents can still see it but treat it as untrusted
- **Shared helper** — single `scanWorkspaceContent()` function serves both core and extra bootstrap loaders, eliminating code duplication

### Upstream Sync Risk

**Medium for `workspace.ts`** — `loadWorkspaceBootstrapFiles` is core infrastructure. The scanner adds a thin wrapper around the loaded content. If upstream refactors the bootstrap loading pattern, re-apply.
**Low for `external-content.ts`** — single additive entry in the source type union + labels.

---

## Lossless Claw (LCM) — Deployment Bake-in & Bug Fix (2026-03-15)

**Purpose:** Bake the [Lossless Claw](https://github.com/martian-engineering/lossless-claw) context engine plugin (by [Martian Engineering](https://github.com/martian-engineering)) into the Docker image so it survives container rebuilds, and configure it as the default context engine across all deployments. LCM replaces the default sliding-window compaction with DAG-based conversation memory backed by SQLite, providing persistent summarization and conversation continuity.

### Architecture

```
Docker Build (Dockerfile)
  └─ npm pack @martian-engineering/lossless-claw
     → /app/prebaked-plugins/lossless-claw/

Container Startup (enforce-config.mjs)
  ├─ enforceLCM()    → copies prebaked plugin to extensions dir
  └─ enforceCore()   → sets contextEngine slot, enables plugin, configures 3-year session idle

Runtime
  └─ Gateway loads lossless-claw as contextEngine
     └─ SQLite DAG at $STATE_DIR/lcm.db
```

### Changes (moltbotserver-source)

| File                 | Change                                                                                                                                                                                                                                                   | Upstream Risk            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Dockerfile`         | Pre-bake `@martian-engineering/lossless-claw` from npm into `/app/prebaked-plugins/lossless-claw/` using `npm pack` + `cp -a` (handles dotfiles).                                                                                                        | None — custom section    |
| `enforce-config.mjs` | `enforceCore()`: sets `plugins.slots.contextEngine = "lossless-claw"`, `plugins.entries["lossless-claw"].enabled = true`, adds to `plugins.allow` if array exists. Sets `session.reset.mode = "idle"`, `idleMinutes = 1576800` (3 years).                | None — fully custom file |
| `enforce-config.mjs` | **NEW** `enforceLCM()`: copies pre-baked plugin from `/app/prebaked-plugins/` to extensions dir on startup (skip if already installed). Sets `root:root` ownership for plugin scanner.                                                                   | None — fully custom file |
| `enforce-config.mjs` | Added `lcm` CLI command + wired `enforceLCM()` into `all` command. Updated header comment.                                                                                                                                                               | None — fully custom file |
| `enforce-config.mjs` | **Bug fix**: Added missing `statSync` to `node:fs` import — was used at line 2071 in `seedSubAgentCronJobs()` for symlink resolution but never imported. Would crash with `ReferenceError` on any deploy with symlinked sub-agent workspace directories. | None — fully custom file |

### Configuration Defaults

| Setting                                    | Value               | Rationale                                  |
| ------------------------------------------ | ------------------- | ------------------------------------------ |
| `plugins.slots.contextEngine`              | `"lossless-claw"`   | LCM replaces default compaction            |
| `plugins.entries["lossless-claw"].enabled` | `true`              | Plugin active by default                   |
| `session.reset.idleMinutes`                | `1576800` (3 years) | Preserves LCM conversation DAG continuity  |
| `session.reset.mode`                       | `"idle"`            | Only idle-based reset, no scheduled resets |

### Environment Variables (in `.env`)

| Variable                | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `LCM_FRESH_TAIL_COUNT`  | Messages to keep unsummarized (default: 20)                      |
| `LCM_CONTEXT_THRESHOLD` | Token threshold to trigger summarization                         |
| `LCM_SUMMARY_PROVIDER`  | Summarization model provider (e.g. `google`)                     |
| `LCM_SUMMARY_MODEL`     | Summarization model (e.g. `gemini-2.5-flash-lite-preview-06-17`) |

### Compatibility

No conflicts with existing memory layers:

| Layer                                                                      | Storage                            | Scope                    |
| -------------------------------------------------------------------------- | ---------------------------------- | ------------------------ |
| [**ByteRover**](https://byterover.dev) (`main.sqlite`)                     | Workspace file chunks + embeddings | Semantic recall of files |
| [**LCM**](https://github.com/martian-engineering/lossless-claw) (`lcm.db`) | Conversation message DAG           | Session continuity       |

### Upstream Sync Risk

**None.** `Dockerfile` pre-bake section and `enforce-config.mjs` are fully custom files.

---

## SOUL.md Philosophy Rewrite — BIAS FOR ACTION & Documentation Emphasis (2026-03-15)

**Purpose:** Transform the operating philosophy from cautious "restate and wait" to proactive "act first, report results." Also rewrite the documentation discipline to emphasize proactive recording — WORKING.md updates mid-task, skill creation from complex workflows, and knowledge base writes.

### Changes (moltbotserver-source)

| File                                               | Change                                                                                                                                                                                                                          | Upstream Risk        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `SOUL.md`                                          | **Take Initiative** — removed RESTATEMENT RULE ("restate what you will do, wait for confirmation"), replaced with BIAS FOR ACTION ("act first, report results, reserve confirmation for destructive/irreversible actions only") | None — fully custom  |
| `SOUL.md`                                          | **Think Architecturally** — removed "RESTATEMENT RULE" subsection (mandatory restate-and-wait); replaced with "REVERSIBILITY CHECK" (binary test: reversible → act, irreversible → confirm)                                     | None — fully custom  |
| `SOUL.md`                                          | **Record Everything** — complete rewrite with structured guidance: what to write, where (WORKING.md, memory, skills, knowledge base), and when (mid-task, not just end-of-task)                                                 | None — fully custom  |
| `docs/reference/templates/SOUL.md`                 | Mirrored all changes from main SOUL.md                                                                                                                                                                                          | None — fully custom  |
| `src/agents/system-prompt.ts`                      | Added step 5 "Document" to Operating Discipline sequence (`understand → scope → act → verify → document`)                                                                                                                       | Low — custom section |
| `src/agents/system-prompt.ts`                      | Fixed context summary flow description: was `understand → scope → act → verify`, now includes `→ document` to match full 5-step sequence                                                                                        | Low — custom section |
| `docs/reference/templates/openclaw-business-v1.md` | Added "DOCUMENT AS YOU GO" section after REVERSIBILITY CHECK — WORKING.md updates, skill creation, knowledge capture                                                                                                            | None — fully custom  |

### Philosophy Change

| Before                                                                                            | After                                                                                                     |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "Restate what you will do AND what you will NOT touch. Wait for confirmation. This is mandatory." | "BIAS FOR ACTION: the best version of you is the one people wake up to and think: glad that was handled." |
| Confirmation required for every non-trivial action                                                | Confirmation reserved for destructive/irreversible actions only                                           |
| Documentation as afterthought                                                                     | Documentation as part of action — "Acting includes documenting"                                           |

### Design Decisions

- **Reversibility as the decision boundary** — instead of asking "is this non-trivial?" (subjective), agents now ask "can this be undone?" (objective). Reversible changes (file edits, memory writes) proceed immediately. Irreversible changes (deletes, deploys, external API calls) still require confirmation.
- **Documentation woven into action** — WORKING.md updates happen mid-task, not after. Skill creation happens after completing complex workflows. Knowledge base entries happen when discovering reusable patterns.
- **Consistency across all SOUL.md copies** — main SOUL.md, docs template, Chinese translation template, and system-prompt.ts all updated in sync.

### Upstream Sync Risk

**None.** All modified files are custom SOUL.md variants or MoltBot-custom sections of `system-prompt.ts`.

---

## SupaSwarm — Hidden from UI, Server-Side Auto-Registration (2026-03-14–15)

**Purpose:** Remove SupaSwarm from the user-facing onboarding UI (dropdown, CLI flags, auth flow) while keeping it available as a server-side auto-registered provider via `enforce-config.mjs`. This makes SupaSwarm a managed-platform-only capability — community users don't see it, but MoltBot instances get it automatically when configured.

### UI Removal (moltbotserver-source)

| File                                              | Change                                                                                                                                                                                         | Upstream Risk |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/commands/auth-choice-options.ts`             | Removed `supaswarm-api-key` dropdown option                                                                                                                                                    | Low           |
| `src/commands/auth-choice.apply.api-providers.ts` | Removed `supaswarm-api-key` auth flow (~43 lines), removed imports for `applySupaSwarmConfig`, `setSupaSwarmConfig`, `SUPASWARM_DEFAULT_MODEL_REF`                                             | Low           |
| `src/commands/onboard-auth.config-core.ts`        | Removed `applySupaSwarmProviderConfig` and `applySupaSwarmConfig` functions (~40 lines), removed model imports                                                                                 | Low           |
| `src/commands/onboard-auth.ts`                    | Removed re-exports: `applySupaSwarmConfig`, `applySupaSwarmProviderConfig`, `setSupaSwarmConfig`, `SUPASWARM_DEFAULT_MODEL_REF`, `buildSupaSwarmModelDefinition`, `SUPASWARM_DEFAULT_MODEL_ID` | Low           |
| `src/commands/onboard-provider-auth-flags.ts`     | Removed `supaswarmApiKey` flag definition                                                                                                                                                      | Low           |
| `src/commands/onboard-types.ts`                   | Removed `supaswarm-api-key` from `BuiltInAuthChoice`, `supaswarm` from `BuiltInAuthChoiceGroupId`, `supaswarmApiKey`/`supaSwarmBaseUrl` from `OnboardOptions`                                  | Low           |
| `src/secrets/provider-env-vars.ts`                | Removed `supaswarm: ["SUPASWARM_API_KEY"]` from `PROVIDER_ENV_VARS`                                                                                                                            | Low           |

### Server-Side Registration (moltbotserver-source)

| File                 | Change                                                                                                                                                                                                                   | Upstream Risk       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `enforce-config.mjs` | Added `ensureSupaSwarmProvider()` — registers SupaSwarm as an OpenAI-compatible provider with 4 models (swarm-auto, swarm-pulse, swarm-drive, swarm-overdrive) when `SUPASWARM_BASE_URL` and `SUPASWARM_API_KEY` are set | None — fully custom |
| `enforce-config.mjs` | Self-contained model definitions in `SUPASWARM_MODELS` array (128K context, 8K max tokens, cost metadata)                                                                                                                | None — fully custom |
| `enforce-config.mjs` | Idempotent — only registers if provider not already configured                                                                                                                                                           | None — fully custom |

### Dead Code — Fully Removed

The dead SupaSwarm model definitions in `onboard-auth.models.ts` and `onboard-auth.credentials.ts`, along with the `if (false)` block and `SUPASWARM_MODELS` array in `enforce-config.mjs`, were fully removed in the "Comprehensive Cleanup & Security Hardening" pass (2026-03-15). Zero SupaSwarm references remain anywhere in the codebase.

### Upstream Sync Risk

**Low for UI removal files** — small deletions from enum unions and option arrays. Upstream may add new providers to these lists but won't conflict with removed entries.
**None for `enforce-config.mjs`** — fully custom file.

---

## Lossless Claw (LCM) Context Engine — Docker Pre-Bake (2026-03-15)

**Purpose:** Pre-bake the [Lossless Claw](https://github.com/martian-engineering/lossless-claw) (LCM) context engine plugin (by [Martian Engineering](https://github.com/martian-engineering)) into the Docker image so it's available on first boot without runtime `npm install`. LCM provides DAG-based conversation memory with SQLite-backed summarization, replacing default compaction.

### Changes (moltbotserver-source)

| File         | Change                                                                                                                              | Upstream Risk         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `Dockerfile` | Added `RUN` block: `npm pack @martian-engineering/lossless-claw`, extract, install deps into `/app/prebaked-plugins/lossless-claw/` | None — custom section |

### Architecture

```
Dockerfile (build time)
  └─ npm pack @martian-engineering/lossless-claw
     └─ extract + npm install --omit=dev → /app/prebaked-plugins/lossless-claw/

docker-entrypoint.sh (runtime)
  └─ copies /app/prebaked-plugins/lossless-claw → data volume (if not already present)

enforce-config.mjs (runtime)
  └─ sets contextEngine slot to "lossless-claw" in openclaw.json
```

### Design Decisions

- **Established prebake pattern** — follows the `prebaked-plugins/` pre-bake pattern in the Dockerfile.
- **Build-time install** — `npm pack` from registry + `npm install --omit=dev` ensures all dependencies are resolved at image build time. No network calls at container startup.
- **Cleanup** — tar artifacts removed after extraction to avoid bloating the image layer.

### Upstream Sync Risk

**None.** `Dockerfile` is fully custom. The `prebaked-plugins` directory pattern is established.

---

## Progressive Disclosure for Skills — Compact Prompt Format (2026-03-15)

**Purpose:** Reduce prompt token usage by ~50-60% for the skills index by switching to a compact format with on-demand loading. Inspired by the [Hermes Agent](https://github.com/NousResearch/hermes-agent) progressive disclosure architecture. Instead of including file paths in the system prompt and requiring the agent to use the generic `read` tool, the system prompt now lists only skill names and descriptions. The agent uses a new `skill_view` tool to load full SKILL.md content when needed.

### Changes (moltbotserver-source)

| File                                                                  | Change                                                                                                                                                                                                | Upstream Risk           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/agents/skills/workspace.ts`                                      | `buildWorkspaceSkillsPrompt()` now supports two formats: compact (progressive disclosure, default) and XML (legacy). Compact format emits `- name: description` list + `skill_view(name)` instruction | Low — modified function |
| `src/agents/skills/workspace.ts`                                      | `resolveSkillsPromptForRun()` passes `config` through for progressive disclosure check                                                                                                                | Low — modified function |
| `src/agents/tools/skill-view-tool.ts`                                 | **NEW** — `createSkillViewTool()` factory. Takes `resolvedSkills` array, agent calls with skill name, gets full SKILL.md content                                                                      | None — custom new file  |
| `src/agents/openclaw-tools.ts`                                        | Added `resolvedSkills` option + conditional `skill_view` tool registration when progressive disclosure is enabled                                                                                     | Low — additive          |
| `src/agents/pi-tools.ts`                                              | Added `resolvedSkills` option, forwarded to `createOpenClawTools`                                                                                                                                     | Low — additive          |
| `src/agents/pi-embedded-runner/compact.ts`                            | Added `resolvedSkills` from `skillsSnapshot` to tool creation params                                                                                                                                  | Low — additive          |
| `src/agents/pi-embedded-runner/run/attempt.ts`                        | Added `resolvedSkills` from `skillsSnapshot` to tool creation params                                                                                                                                  | Low — additive          |
| `src/config/types.skills.ts`                                          | Added `progressiveDisclosure?: boolean` config option (default: true)                                                                                                                                 | Low — additive          |
| `src/security/external-content.ts`                                    | Added `"workspace_context"` to `ExternalContentSource` union + label                                                                                                                                  | Low — additive          |
| `src/agents/skills.test.ts`                                           | Added test: "uses compact format when progressive disclosure is enabled (default)"                                                                                                                    | None — test             |
| `src/agents/skills.build-workspace-skills-prompt.*.test.ts` (3 files) | Updated existing tests to pass `progressiveDisclosure: false` for backward compat                                                                                                                     | None — tests            |

### Compact Format Example

```
<available_skills>
- deploy-agent: Deploy an agent to production infrastructure
- create-cron: Set up and configure cron jobs for agents
Use skill_view(name) to load full instructions before using a skill.
</available_skills>
```

vs. legacy XML format:

```xml
<available_skills>
<skill name="deploy-agent" description="Deploy an agent to production">
  Read full instructions at: /workspace/skills/deploy-agent/SKILL.md
</skill>
...
</available_skills>
```

### Design Decisions

- **Default on** — `progressiveDisclosure` defaults to `true`. Set to `false` in config to revert to upstream XML format.
- **Tool-based loading** — `skill_view` is registered alongside the existing `skill_manage` tool. It requires `resolvedSkills` to be passed through the tool creation chain.
- **Backward-compatible tests** — all existing tests explicitly set `progressiveDisclosure: false` to preserve their assertions.

### Upstream Sync Risk

**Low for `skills/workspace.ts`** — modifies `buildWorkspaceSkillsPrompt` and `resolveSkillsPromptForRun` with config-gated branches.
**Low for tool chain files** — additive `resolvedSkills` option threaded through existing parameters.
**None for `skill-view-tool.ts`** — fully custom new file.

---

## Workspace Context Security Scanning (2026-03-15)

**Purpose:** Scan workspace context files (SOUL.md, OPERATIONS.md, etc.) for prompt injection before they are included in the system prompt. These files are loaded from the workspace and could be modified by external users or compromised tools.

### Changes (moltbotserver-source)

| File                               | Change                                                                                                                                        | Upstream Risk  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/agents/workspace.ts`          | Added `scanAndLog()` call on workspace context file contents before system prompt injection. Uses `source: "workspace_context"` for tracking. | Low — additive |
| `src/security/external-content.ts` | Added `"workspace_context"` to `ExternalContentSource` type union and `EXTERNAL_SOURCE_LABELS` map                                            | Low — additive |

### Design Decisions

- **Scan before injection** — workspace context files like SOUL.md, OPERATIONS.md, and WORKING.md are loaded from the filesystem and injected into the system prompt. If any file has been tampered with (e.g., by a tool writing to the workspace), the injection patterns would be caught by the existing content scanner.
- **Non-blocking** — scan results are logged via `scanAndLog()` (which uses the shared EventLogger). High-risk content generates warnings but does not block prompt assembly — avoiding false positives from locking the agent out of its own SOUL.md.
- **Complements existing scanning** — web fetch, browser snapshots, cron hooks, and channel metadata were already scanned. Workspace context was the last unscanned external content source entering the system prompt.

### Upstream Sync Risk

**Low.** Both changes are small, additive, and in MoltBot-custom code paths. `external-content.ts` only adds a new union member; `workspace.ts` adds a few lines after existing file-loading logic.

---

## OPERATIONS.md — Self-Delegation Guidance (2026-03-15)

**Purpose:** Add structured guidance for self-delegation (agent-to-self task scheduling) in OPERATIONS.md, documenting when and how to use `NEXT_WAKE:` directives for follow-up tasks.

### Changes (moltbotserver-source)

| File            | Change                                                                                                                           | Upstream Risk       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `OPERATIONS.md` | Added "Self-Delegation" section with guidelines for using `NEXT_WAKE:` directives, follow-up task patterns, and escalation rules | None — fully custom |

### Upstream Sync Risk

**None.** `OPERATIONS.md` is a fully custom file.

---

## Per-Agent Browser Fix: Variable Substitution & OOM Crash (v1.0.3, 2026-03-11)

**Purpose:** Fix two bugs in `ensure-agent-browsers.sh` that prevented per-agent browser containers from launching correctly.

### Bug 1 — `docker-compose.override.yml` generated with literal `${AGENT}` variables

The shell script built its override file by appending to a `$OVERRIDE` string variable with triple-backslash-escaped variables (`\\\\\\${AGENT}`, etc.). Due to multiple layers of shell + TypeScript template string escaping, these collapsed to literal `${AGENT}` / `${BROWSER_IMAGE}` in the written YAML. Docker Compose then rejected the file as an invalid service name.

**Fix:** Replaced the string-concatenation approach with `printf` calls writing directly to `docker-compose.override.yml` per agent. Shell variables expand naturally in the surrounding `for` loop scope — no escaping required. Added a `docker compose config --quiet` validation step before starting containers so failures are caught with context.

### Bug 2 — Chrome renderer OOM-killed on modern sites (Reddit, etc.)

Per-agent browser containers had `mem_limit: 512m`. Chrome's renderer processes for modern JS-heavy SPAs require more memory. The Linux kernel cgroup was OOM-killing the renderer (confirmed via `dmesg`), producing "Can't open this page" (Chrome error code 9).

**Fix:** Raised `mem_limit` from `512m` to `2g` for all per-agent browser containers (both Chrome and Camofox modes). The managed server has ample RAM available.

### Changes (moltbot-dashboard)

| File                                           | Change                                                                                                           | Upstream Risk       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/lib/services/hetzner-instance-service.ts` | `renderAgentBrowserScript()`: rewrote YAML generation from `$OVERRIDE` string concatenation → `printf` per field | None — fully custom |
| `src/lib/services/hetzner-instance-service.ts` | Added `docker compose config --quiet` validation before `docker compose up -d`                                   | None                |
| `src/lib/services/hetzner-instance-service.ts` | `mem_limit: 512m` → `mem_limit: 2g` for both Chrome and Camofox browser blocks                                   | None                |

### Upstream Sync Risk

**None.** `hetzner-instance-service.ts` is a fully custom dashboard file.

---

## Workspace Document Auto-Converter (2026-03-11)

**Purpose:** Automatically convert non-markdown files (PDF, TXT, DOCX, ODT, CSV, EPUB) dropped into the workspace to markdown so that QMD can index them without any manual steps. The converter is fully deterministic — no LLM involved.

### Architecture

```
docker-entrypoint.sh
  └─ background sidecar: scripts/workspace-doc-converter.sh --interval 300
       │  poll WORKSPACE_DIR every 5 minutes
       │  for each .pdf → pdftotext (poppler-utils)
       │  for each .txt → direct copy with header
       │  for each .docx/.odt/.rtf/.epub → pandoc (gfm output)
       │  for each .csv → awk → markdown table
       └─ write <basename>.md alongside source with AUTO-CONVERTED header
            QMD picks up new .md on next 5-minute workspace collection re-index
```

### Changes (moltbotserver-source)

| File                                 | Change                                                          | Notes                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/workspace-doc-converter.sh` | **NEW** — polling converter script                              | Idempotent (skips if .md is newer than source), never overwrites user-created .md files (only overwrites its own prior output identified by `AUTO-CONVERTED` header). Log rotation at 512KB to `workspace/converter-log/converter.log`. Flags: `--once`, `--force`, `--interval <s>`. |
| `docker-entrypoint.sh`               | Added background sidecar launch before `exec "$@"`              | Gated on `OPENCLAW_DOC_CONVERTER_ENABLED` (default: `true`). Set to `false` or `0` to disable per-instance.                                                                                                                                                                           |
| `cron/default-jobs.json`             | Added `workspace-doc-converter` job entry (disabled by default) | Provides an on-demand forced pass when the agent needs to re-index a batch of newly dropped files immediately.                                                                                                                                                                        |

### Supported Formats

| Extension                        | Converter                              | Tool Required                                       |
| -------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `.pdf`                           | Text extraction with layout            | `pdftotext` (poppler-utils — already in Dockerfile) |
| `.txt`                           | Direct copy with AUTO-CONVERTED header | Built-in                                            |
| `.docx`, `.odt`, `.rtf`, `.epub` | Full document conversion               | `pandoc` (already in Dockerfile)                    |
| `.csv`                           | `awk` → markdown table                 | Built-in                                            |

### Design Decisions

- **Idempotent by default** — if an up-to-date `.md` already exists, the file is skipped. The `AUTO-CONVERTED` marker in the first line is the sentinel; user-created `.md` files alongside the source are never overwritten.
- **No inotifywait dependency** — uses a simple polling loop to avoid adding `inotify-tools` to the Dockerfile. 5-minute poll interval is appropriate for workspace use cases.
- **Both converters already installed** — `pandoc` and `poppler-utils` are in the existing agent CLI tooling `RUN` block in the Dockerfile.
- **Log rotation** — cap at 512KB prevents disk fill from long-running containers.

### Upstream Sync Risk

**None.** `scripts/workspace-doc-converter.sh` is a fully custom new file. `docker-entrypoint.sh` and `cron/default-jobs.json` are fully custom.

---

## `workspace_search` QMD Initialization Hardening (2026-03-11)

**Purpose:** Fix `workspace_search` silently disappearing on fresh container instances. On first deploy, [QMD](https://github.com/nichochar/qmd) binary compilation ([llama.cpp](https://github.com/ggml-org/llama.cpp)) takes longer than the 30-second command timeout, causing `addCollection` to time out. The tool then registered without a backing collection, making every search return empty. Silent failure made this nearly impossible to diagnose.

### Root Cause

Three compounding issues:

1. `addCollection` timed out during initial `qmd` compilation on cold containers.
2. No retry — a single failure permanently left the collection un-registered for the life of the container.
3. No warning — failure was swallowed silently with no log message indicating the tool was degraded.

### Changes (moltbotserver-source)

| File                        | Change                                                                                                                                                                                                                                                                                        | Upstream Risk            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/memory/qmd-manager.ts` | Added `addCollectionWithRetry()` — wraps `addCollection` with 3 attempts, 5-second delay. Collection-already-exists errors short-circuit (not treated as failure).                                                                                                                            | Low — new private method |
| `src/memory/qmd-manager.ts` | Added `warnIfWorkspaceCollectionsEmpty()` — post-boot health check. Queries QMD SQLite index directly; logs a prominent `[workspace_search] WARNING` if any workspace collection has zero indexed documents.                                                                                  | Low — new private method |
| `docker-entrypoint.sh`      | Added `qmd status` pre-warm step after QMD install but before gateway start. Forces llama.cpp compilation during entrypoint phase (no command timeout). Subsequent boots are sub-second.                                                                                                      | None — custom file       |
| `docker-entrypoint.sh`      | Fixed pre-warm env: was using wrong state dir default (`/home/node/data`); now uses `CONFIG_DIR` (already resolved at entrypoint top with correct `/home/node/.clawdbot` default). Added `XDG_CONFIG_HOME` and `QMD_CONFIG_DIR` to mirror the exact env set by `QmdMemoryManager` at runtime. | None — custom file       |

### Design Decisions

- **Three-pronged approach** — pre-warm eliminates the root cause; retry handles edge cases on slow hardware; health-check warns if some failure still slips through. Silent failures become actionable log alerts.
- **`addCollectionWithRetry` distinguishes errors** — collection-already-exists is treated as success (idempotent), other errors are retried, persistent failures log and continue (tool degrades gracefully rather than crashing gateway boot).
- **Pre-warm env exactness matters** — `QmdMemoryManager` sets `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, and `QMD_CONFIG_DIR` at runtime. The pre-warm must set the same env or `qmd status` writes to a different state dir, causing a cache miss on the actual first run.

### Upstream Sync Risk

**Low for `qmd-manager.ts`** — new private methods appended. If upstream changes `addCollection` signature, update the wrapper.
**None for `docker-entrypoint.sh`** — fully custom file.

---

## `workspace_search` Tool Availability & Cleanup (2026-03-11)

**Purpose:** Remove the business-mode-only gate from `workspace_search` so it is available whenever QMD is configured and a workspace collection exists. Also fix 5 bugs found during cleanup audit of the recent workspace_search implementation.

### Changes (moltbotserver-source)

| File                                        | Change                                                                                                                                                                                              | Upstream Risk      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/agents/tools/workspace-search-tool.ts` | Removed `OPENCLAW_BUSINESS_MODE` / `OPENCLAW_BUSINESS_MODE_ENABLED` gate from `resolveWorkspaceToolContext()` — tool now registers whenever QMD backend is active and a workspace collection exists | None — custom file |
| `src/agents/tools/workspace-search-tool.ts` | Eliminated duplicate `resolveMemoryBackendConfig()` call — config resolved once in context check, threaded via `ctx.resolved`, not called again in `execute()` on every search                      | None — custom file |
| `src/memory/qmd-manager.ts`                 | Fixed `warnIfWorkspaceCollectionsEmpty` SQLite bug: `.get(...spread)` with `node:sqlite` `StatementSync` is unreliable for dynamic parameterization; replaced with per-collection `COUNT` loop      | Low                |
| `src/memory/qmd-manager.ts`                 | Cleaned up verbose `[memory]` prefix in log messages — logger subsystem adds context automatically                                                                                                  | Low                |
| `src/agents/system-prompt.ts`               | Updated `workspace_search` description in Memory Recall section from business-specific framing to generic ("search all workspace documents")                                                        | Low                |
| `src/agents/tool-catalog.ts`                | Updated `workspace_search` catalog description from "Search workspace docs (business, project)" to "Search all indexed documents in the workspace"                                                  | Low                |

### Design Decisions

- **Business mode gate removal** — business mode now only influences system prompt directives (mandatory dual-search) rather than tool availability. Any instance with QMD + workspace path configured gets the tool.
- **Three-place description sync** — tool definition, system prompt, and tool catalog all had different descriptions; now consistent.

### Upstream Sync Risk

**Low.** Changes to `system-prompt.ts` and `tool-catalog.ts` are in MoltBot-custom sections. `workspace-search-tool.ts` and `qmd-manager.ts` are primarily custom.

---

## OpenClaw Backup System (2026-03-11)

**Purpose:** Implement a full-lifecycle backup system for OpenClaw instances deployed on MoltBot. Backups protect against accidental data loss, enable migration from community OpenClaw to MoltBot ("import to switch"), and lay the groundwork for disaster recovery. The system operates entirely within the existing Supabase project (no external storage services).

### Architecture

```
Container (backup-upload.sh)
  │  openclaw backup create → .tar.gz archive
  │  openclaw backup verify → integrity check (3 attempts, retry on fail)
  │  POST /api/instances/{id}/openclaw-backups/upload  → stores to Supabase Storage
  │  On permanent failure: POST /api/instances/{id}/alert
  ▼
Supabase Storage ("openclaw-backups" bucket)
  └─ {instance_id}/{timestamp}-openclaw-backup.tar.gz

Dashboard (Next.js API + UI)
  ├─ GET  /api/instances/{id}/openclaw-backups        → list backups
  ├─ GET  /api/instances/{id}/openclaw-backups/{bid}/download → signed URL (60s)
  ├─ DELETE /api/instances/{id}/openclaw-backups      → delete backup
  ├─ POST /api/instances/{id}/openclaw-backups/import → upload .tar.gz from user
  ├─ POST /api/instances/{id}/openclaw-backups/restore → set pending restore target
  ├─ DELETE /api/instances/{id}/openclaw-backups/restore → clear restore target
  ├─ GET|PATCH /api/instances/{id}/backup-config      → read/update schedule config
  ├─ POST /api/cron/cleanup-backups                   → purge expired records + storage
  └─ POST /api/instances/{id}/alert                   → container alert ingestion

Container on next boot (docker-entrypoint.sh):
  If MOLTBOT_RESTORE_BACKUP_KEY set → restore-from-backup.sh → extract all asset kinds
```

### Scripts (moltbotserver-source)

| File                             | Change                                                                                                                                                                                           | Notes                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/backup-upload.sh`       | **NEW** (was placeholder) — full retry loop (3 attempts), `openclaw backup create` + `verify`, Supabase Storage upload, DB insert via dashboard API                                              | Env-driven: `MOLTBOT_BACKUP_MAX_ATTEMPTS`, `MOLTBOT_BACKUP_RETRY_DELAY`, `MOLTBOT_LOCAL_RETENTION_DAYS` (14d), `MOLTBOT_SUPABASE_RETENTION_DAYS` (7d) |
| `scripts/backup-upload.sh`       | `notify_failure()` — builds JSON via Python heredoc into temp file, POSTs to `/alert` endpoint; safe against special chars in titles/messages                                                    | Uses `--data-binary @file` instead of inline `-d` interpolation                                                                                       |
| `scripts/restore-from-backup.sh` | **NEW** — downloads from Supabase Storage, verifies tar integrity, reads `manifest.json`, maps all four asset kinds (`config`, `state`, `credentials`, `workspace`) to correct destination paths | Writes restore-complete marker; idempotent — skips on subsequent boots                                                                                |

### API Routes (moltbot-dashboard)

| File                                                          | Change                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/instances/[id]/openclaw-backups/upload/route.ts`         | `user_id` derived server-side from `instances.user_id` (UUID) — container no longer handles user credentials                                                                                                   |
| `api/instances/[id]/openclaw-backups/import/route.ts`         | Accepts multipart `.tar.gz` upload; extracts `manifest.json` from archive using a zero-dependency pure-Node tar reader; inserts record with `source='import'`; `user_id` from instance row (UUID not Clerk ID) |
| `api/instances/[id]/openclaw-backups/restore/route.ts`        | POST sets `pending_restore_backup_id` + `pending_restore_key` on instance; DELETE clears them. Both have rate limiting, ownership checks, proper error handling                                                |
| `api/instances/[id]/openclaw-backups/[bid]/download/route.ts` | Generates 60-second signed Supabase Storage URL                                                                                                                                                                |
| `api/instances/[id]/backup-config/route.ts`                   | GET/PATCH for `instance_backup_config` (enabled, interval_hours, only_config, retention_days)                                                                                                                  |
| `api/instances/[id]/alert/route.ts`                           | Internal endpoint — Bearer = `SUPABASE_SERVICE_ROLE_KEY`; derives `user_id` from instance row; rate-limited 10/hr per instance; UUID validation on instance ID                                                 |
| `api/cron/cleanup-backups/route.ts`                           | Paginated loop (100 records/batch) — deletes Supabase Storage objects then DB rows; runs until all expired records cleared; GET dry-runs the count                                                             |

### Database Schema

| Table                    | Key Columns                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openclaw_backups`       | `id`, `instance_id`, `user_id` (UUID), `storage_key`, `size_bytes`, `source` (`cron`/`manual`/`import`), `verified`, `manifest` (JSONB), `expires_at`, `label` |
| `instance_backup_config` | `instance_id`, `enabled`, `interval_hours`, `only_config`, `retention_days` (default 7)                                                                        |
| `instance_alerts`        | `id`, `instance_id`, `user_id` (UUID), `kind`, `category`, `title`, `message`, `dismissed`                                                                     |
| `instances` (modified)   | Added `pending_restore_backup_id`, `pending_restore_key`                                                                                                       |

RLS policies: owner-only select/delete on all backup tables; service role only for inserts from container.

### Environment Variables

| Variable                            | Injected By            | Purpose                                  |
| ----------------------------------- | ---------------------- | ---------------------------------------- |
| `MOLTBOT_BACKUP_ENABLED`            | Dashboard              | Enable/disable scheduled backups         |
| `MOLTBOT_INSTANCE_ID`               | Dashboard              | Instance identifier for upload path      |
| `MOLTBOT_SUPABASE_URL`              | Dashboard              | Supabase project URL                     |
| `MOLTBOT_SUPABASE_SERVICE_ROLE_KEY` | Dashboard              | Auth for storage + alert endpoint        |
| `MOLTBOT_BACKUP_INTERVAL_MS`        | Dashboard              | Backup frequency (default 12h)           |
| `MOLTBOT_DASHBOARD_URL`             | Dashboard              | Base URL for alert callback              |
| `MOLTBOT_RESTORE_BACKUP_KEY`        | Dashboard (on restore) | Storage key to restore on next boot      |
| `MOLTBOT_RESTORE_BACKUP_ID`         | Dashboard (on restore) | Backup record ID (cleared after restore) |

`MOLTBOT_USER_ID` has been **removed** — `user_id` is now always derived server-side.

### Design Decisions

- **Retry + verify then upload**: `backup-upload.sh` runs `create` → `verify` as a unit. If verify fails, the corrupt archive is deleted and the cycle retries (up to `MAX_ATTEMPTS`). Only a verified archive is uploaded. On permanent failure, an alert is written via the dashboard (not direct Supabase insert) so the container never needs to know about `user_id`.
- **Retention**: Supabase 7 days (default), local 14 days. Set via env vars per-instance. Cleanup runs via a cron endpoint that batches deletions.
- **Import flow**: User exports via `openclaw backup create`, uploads the `.tar.gz` through the dashboard. We parse `manifest.json` from the archive (pure Node.js tar reader, no dependencies) to validate the schema version and extract asset metadata. Archive is stored and marked `source='import'`.
- **Restore flow**: Dashboard sets `pending_restore_key` on the instance. On next container boot, `docker-entrypoint.sh` detects the key and runs `restore-from-backup.sh`, which downloads and extracts all four asset kinds to their canonical paths. A restore-complete marker prevents double-restore.
- **No Cloudflare / R2**: Intentionally using Supabase Storage only. Simpler architecture, signed URLs for security.

### Upstream Sync Risk

**None.** All modified files are fully custom (`backup-upload.sh`, `restore-from-backup.sh`, `docker-entrypoint.sh` backup hook, `enforce-config.mjs` backup cron seeding, dashboard API routes, migration).

---

**Purpose:** Fix the browser tool not being available to agents despite `OPENCLAW_BROWSER_ENABLED=true`. The live server had `tools.profile = "coding"` which produced an explicit allowlist that excluded `browser`, `canvas`, `nodes`, `agents_list`, and other non-coding tools. Also changed the platform default to `"full"` (no restrictions) for all agents.

### Root Cause

`tools.profile = "coding"` was set during initial provisioning. The `"coding"` profile builds an explicit `allow` list from tools that declare `profiles: ["coding"]`. Since `browser` had `profiles: []` in `tool-catalog.ts`, it was absent from that allowlist — the browser tool was registered in the runtime but silently excluded before reaching the LLM.

### Changes

| File                                   | Change                                                                                                                             | Upstream Risk              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `src/agents/tool-catalog.ts`           | `browser` tool: `profiles: []` → `profiles: ["coding"]` — ensures browser is included even under a coding profile                  | Low — additive array entry |
| `enforce-config.mjs`                   | `enforceCore()`: added `tools.profile = "full"` — overwrites any stale narrower profile on every gateway restart                   | None — fully custom file   |
| `enforce-config.mjs`                   | When `OPENCLAW_BROWSER_ENABLED=true`: adds `"browser"` to `tools.alsoAllow` — belt-and-suspenders guarantee independent of profile | None — fully custom file   |
| `.agents/skills/create-agent/SKILL.md` | Step 1a now asks for tool permissions; defaults to `full`; describes all four profile levels                                       | None — fully custom file   |

### Behavior After Fix

- All existing and new instances: `tools.profile = "full"` enforced on every gateway start (no profile-based tool restrictions)
- Even if profile is somehow set to `"coding"` again, `browser` is now in that profile's allowlist
- Even if only the `alsoAllow` path applies, `"browser"` is always explicitly in the effective allowlist when browser is enabled

### Upstream Sync Risk

**Low for `tool-catalog.ts`** — single field change in a custom-maintained tool entry. If upstream changes the `browser` entry's structure, re-apply.
**None for `enforce-config.mjs`** and skill files — fully custom.

---

## Browser Cleanup Cron Fix (2026-03-11)

**Purpose:** Fix the `browser-cleanup` cron job failing silently. The agent was responding "no browser-control tool here" because (1) the browser tool was blocked by the coding profile (see above), and (2) the cron message used pseudo-syntax (`action=tabs`) without telling the agent to call the `browser` tool by name.

### Changes

| File                     | Change                                                                                                                                                                       | Upstream Risk       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `enforce-config.mjs`     | `browser-cleanup` cron: `enabled: true` → `enabled: isTruthy(env("OPENCLAW_BROWSER_ENABLED", "false"))` — only enabled on browser-configured instances                       | None — fully custom |
| `enforce-config.mjs`     | Cron message rewritten: explicit `browser(action="status")` first with `NO_REPLY` exit if unavailable; explicit `browser(action="tabs")` and `browser(action="close")` calls | None — fully custom |
| `cron/default-jobs.json` | Reference file updated to match new message format                                                                                                                           | None — seed file    |

### Design Decisions

- **Status-first pattern**: Agent calls `browser(action="status")` before doing anything. If browser is unreachable (container down), responds `NO_REPLY` cleanly instead of hallucinating a failure or exhausting retries.
- **Explicit tool calls in message**: Cron prompts now name the tool (`browser(action=...)`) instead of using pseudo-syntax. Models reason from tool descriptions — naming the tool directly eliminates guessing.
- **Disabled on non-browser instances**: The `OPENCLAW_BROWSER_ENABLED` gate prevents the job seeding as `enabled: true` on instances that have no browser container, avoiding persistent cron failures.

### Upstream Sync Risk

**None.** All modified files are fully custom.

---

## Control UI — Exec Approval Modal Viewport Fix (2026-03-11)

**Purpose:** Fix exec approval prompts that were impossible to action when the command being approved was a long inline script (e.g. a Python heredoc). The `.exec-approval-command` code block had no height cap, so the approval card expanded past the viewport and the Approve/Deny buttons were pushed off screen. The gateway approval timeout fired before the user could scroll down and click.

### What Changed

| File                           | Change                                                                                                                | Upstream Risk    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ui/src/styles/components.css` | `.exec-approval-command`: added `max-height: 200px; overflow-y: auto` — long scripts scroll inside a bounded code box | None — custom UI |
| `ui/src/styles/components.css` | `.exec-approval-card`: added `max-height: calc(100vh - 48px); overflow-y: auto` — card can never escape the viewport  | None — custom UI |
| `dist/control-ui/`             | Rebuilt from source (`npm run build` in `ui/`)                                                                        | N/A              |

### Root Cause

`ui/src/ui/views/exec-approval.ts` renders `${request.command}` verbatim with no truncation:

```html
<div class="exec-approval-command mono">${request.command}</div>
```

When an agent runs a multi-line Python heredoc via exec (common for subreddit/web-fetch scripts), the full script — often 800–900 chars, 30+ lines — is the raw `command` value. Without a height cap, the card stretches unconstrained, pushing the action buttons below the fold. The approval window is short-lived (gateway timeout), so the approval expires unreachable.

### Design Decisions

- **CSS-only fix** — no changes to the Lit component state model required. Internal scroll handles any script length gracefully.
- **200px cap** on the command block (~8–10 lines of context) keeps buttons always in view while still showing enough to identify what's running.
- **Card-level `100vh - 48px` cap** is a belt-and-suspenders guard covering cases with many metadata rows or an error message.

### Upstream Sync Risk

**None.** `ui/` is a fully custom directory not present in upstream OpenClaw.

---

## enforce-config.mjs Dead Code Cleanup (2026-03-10)

**Purpose:** Remove ~115 lines of unreachable/dead code from `ensureAgentBrowserContainers` to improve maintainability.

### What Changed

| File                 | Change                                                                                                                                                                                   | Upstream Risk            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `enforce-config.mjs` | `ensureAgentBrowserContainers` — replaced the disabled function body (dead code after early `return`) with a clean no-op stub and a full historical explanation of why this was disabled | None — fully custom file |

### Why

The function was disabled via `return; /* eslint-disable no-unreachable */` after it caused
compose/standalone container conflicts. The ~115 lines of old Docker provisioning code below
the return were unreachable and accumulating as a maintenance liability (dead imports,
dead env var refs, false ESLint suppression). The function signature is preserved so the
`browser-containers` CLI command and the `all` command chain continue to work.

**Upstream sync risk:** None. `enforce-config.mjs` is a fully custom file not present in upstream.

---

## Workspace Auto-Indexing & `workspace_search` Tool (2026-03-10)

**Purpose:** Add a second search layer that is workspace-aware and distinct from personal memory search. Previously, `memory_search` searched everything — QMD indexes personal memory and business documents in the same pool, so there was no clean way for an agent to search only workspace documents (e.g. `business/`, notes, docs) vs only personal memories. This change auto-indexes the workspace root on boot and exposes a `workspace_search` tool that searches only workspace-kind collections.

### Changes (moltbotserver-source)

| File                                        | Change                                                                                                                                                                                      | Why                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/memory/types.ts`                       | Added `"workspace"` to `MemorySource` union                                                                                                                                                 | New source kind for workspace-mapped QMD collections |
| `src/memory/manager-sync-ops.ts`            | Added `"workspace"` to source guards in `resolveConfiguredSourcesForMeta` and `normalizeMetaSources`                                                                                        | Source kind must flow through sync operations        |
| `src/memory/qmd-manager.ts`                 | `bootstrapCollections` maps `kind=workspace` → `source=workspace`; `ensureCollectionPath` type extended                                                                                     | Boot-time workspace collection creation              |
| `src/memory/backend-config.ts`              | Added `"workspace"` to `ResolvedQmdCollection.kind`; added `resolveDefaultWorkspaceCollection()` and `resolveWorkspacePaths()`                                                              | Config resolution for workspace-kind collections     |
| `src/memory/backend-config.test.ts`         | 3 new test cases for workspace collection resolution                                                                                                                                        | Coverage                                             |
| `src/config/types.memory.ts`                | Added `workspacePaths?: MemoryQmdIndexPath[]` to `MemoryQmdConfig`                                                                                                                          | Config schema for custom workspace index paths       |
| `src/agents/tools/workspace-search-tool.ts` | **NEW** — `createWorkspaceSearchTool()`: searches only `source === "workspace"` QMD collections                                                                                             | Clean separation from personal memory search         |
| `src/agents/tool-catalog.ts`                | Added `workspace_search` entry in memory section                                                                                                                                            | Tool registration                                    |
| `src/plugins/runtime/runtime-tools.ts`      | Exported `createWorkspaceSearchTool`                                                                                                                                                        | Plugin runtime export                                |
| `src/plugins/runtime/types-core.ts`         | Added `createWorkspaceSearchTool` to `PluginRuntimeCore.tools`                                                                                                                              | Interface extension                                  |
| `src/agents/system-prompt.ts`               | Updated `buildMemorySection` to mention `workspace_search` availability; updated business-mode KB instructions to mandate both `memory_search` AND `workspace_search` before every response | Agents know to use both tools                        |

### Design Decisions

- **Auto-indexed on boot** — QMD registers `workspace-<agentId>` collection pointing at workspace root (pattern `**/*.md`) whenever QMD backend is active. No manual configuration needed.
- **Business mode gating** — `workspace_search` only appears in the tool catalog when `OPENCLAW_BUSINESS_MODE_ENABLED=true` (or `OPENCLAW_BUSINESS_MODE=1`) AND QMD backend is active.
- **`memory_search` unchanged** — still covers personal memory only. The two tools are intentionally disjoint.
- **Dual env var support** — `OPENCLAW_BUSINESS_MODE_ENABLED` OR `OPENCLAW_BUSINESS_MODE` both activate workspace search (matches human mode pattern and the existing dashboard env var).

### Upstream Sync Risk

**Medium for `src/memory/types.ts`** — `MemorySource` union is actively maintained upstream. Check for new source kinds that might conflict with `"workspace"`.
**Medium for `src/memory/qmd-manager.ts`** — `bootstrapCollections` and `ensureCollectionPath` are core memory infrastructure. If upstream restructures these, the workspace collection registration needs re-wiring.
**Medium for `src/memory/backend-config.ts`** — `resolveMemoryBackendConfig` and `ResolvedQmdCollection` are extended. Check for upstream changes to `kind` discriminator.
**Low for `src/agents/tool-catalog.ts`** — single array entry, additive.
**Low for `src/agents/system-prompt.ts`** — targeted `buildMemorySection` addition and business-mode section update.
**None for `workspace-search-tool.ts`** — fully custom new file.

---

## Docker QMD Find Path Fix (2026-03-10)

**Purpose:** Fix Docker build failures caused by bun installing `@tobilu/qmd` to a non-deterministic path that changes between bun versions. The previous `find` searched only `/root/.bun/install/global` and `/root/.bun`, which stopped matching after a bun update.

### Changes

| File         | Change                                                                                                                                    | Why                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile` | Changed `find /root/.bun/install/global /root/.bun` to `find / -not -path "/proc/*" -not -path "/sys/*"` in the QMD source detection step | Searches the entire filesystem (excluding noisy kernel paths), so the build succeeds regardless of where bun installs the package |

### Design Decisions

- **Belt-and-suspenders** — the broader `find /` is slightly slower at build time but eliminates fragility. A faster fix would be `$(bun pm ls -g 2>/dev/null | ...)` but that requires bun to expose a stable pkg path API.
- **Excluded paths** — `/proc` and `/sys` excluded to avoid kernel file descriptor crawling.

### Upstream Sync Risk

**Low.** `Dockerfile` is fully custom. If upstream updates the QMD install step, check whether their path resolution matches the current bun global install layout.

---

## Remove Slim Docker Build Variant (2026-03-09)

**Purpose:** Drop the `bookworm-slim` Docker image variant from CI. The slim base saved ~270MB upfront but the runtime stage installs the full agent CLI tooling (python3, ffmpeg, pandoc, etc.) unconditionally, negating most of the size savings. Building both variants doubled CI build time for negligible benefit.

### Changes

| File                                   | Change                                               | Why                                                 |
| -------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `.github/workflows/docker-release.yml` | Removed slim tag resolution and slim build-push step | Eliminates the second full image build+push from CI |

### Upstream Sync Risk

**None.** CI workflow is fully custom.

---

## Hermes-Inspired Features — Trajectory Compression, Session Search & Skill Auto-Creation (2026-03-09)

**Purpose:** Implement three agent-improvement features inspired by the [Hermes Agent](https://github.com/NousResearch/hermes-agent) architecture (by [Nous Research](https://nousresearch.com/)): smarter context carryover via trajectory compression, exact keyword search for conversation history, and autonomous skill document management.

### Code Changes (moltbotserver-source)

| File                                                 | Change                                                                                                                                                                                                                      | Why                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/auto-reply/reply/trajectory-compressor.ts`      | **NEW** — `compressTrajectory` (async, with optional LLM callback) and `compressTrajectorySync` (mechanical). Protects first/last turns, compresses middle turns by extracting key decisions, tool usage, and user intents. | Richer session context summaries than the legacy extraction |
| `src/auto-reply/reply/trajectory-compressor.test.ts` | **NEW** — 18 tests (parsing, compression, LLM callback, fallback, metrics)                                                                                                                                                  | Comprehensive coverage                                      |
| `src/auto-reply/reply/session-context-summary.ts`    | Modified `persistSessionContextOnReset` to use `compressTrajectorySync`; added optional `summarize` callback for async LLM upgrade (fire-and-forget). Bumped error logs from `debug` → `warn`.                              | Trajectory compression integration + observability          |
| `src/auto-reply/reply/session-search.ts`             | **NEW** — `SessionSearchIndex` class using SQLite FTS5 for exact keyword search of past conversations. LIKE-based fallback when FTS5 unavailable. `indexTranscriptForSearch` helper.                                        | Complements embedding-based memory search                   |
| `src/auto-reply/reply/session-search.test.ts`        | **NEW** — 13 tests (indexing, search, filtering, phrases, limits)                                                                                                                                                           | Comprehensive coverage                                      |
| `src/agents/tools/session-search-tool.ts`            | **NEW** — `createSessionSearchTool()` factory. Sub-agents restricted to searching their own sessions.                                                                                                                       | Agent-facing tool wrapper                                   |
| `src/agents/tools/skill-manage-tool.ts`              | **NEW** — `createSkillManageTool()` with create/update/delete/list actions. Agent-created skills stored in `workspace/skills/`. 10KB size limit, name validation, human-authored protection.                                | Autonomous skill creation                                   |
| `src/agents/tools/skill-manage-tool.test.ts`         | **NEW** — 15 tests (CRUD, validation, safety, edge cases)                                                                                                                                                                   | Comprehensive coverage                                      |
| `src/agents/openclaw-tools.ts`                       | Registered `session_search` and `skill_manage` tools with agent ID resolution and sub-agent detection                                                                                                                       | Runtime tool wiring                                         |
| `src/agents/tool-catalog.ts`                         | Added `session_search` (sessions section) and `skill_manage` (advanced section) entries                                                                                                                                     | Tool catalog registration                                   |
| `src/agents/system-prompt.ts`                        | Added `session_search` and `skill_manage` to `coreToolSummaries` + `toolOrder`. Added "Skill Auto-Creation" guidance section (conditional on `skill_manage` availability).                                                  | Agent prompt guidance                                       |
| `src/auto-reply/reply/session.ts`                    | Hooked `indexTranscriptForSearch` into session reset flow. Added `log.warn` on catch block for indexing failures.                                                                                                           | FTS5 indexing integration + observability                   |

### Design Decisions

- **Trajectory compression preserves boundaries** — first 3 and last 4 turns kept verbatim, middle compressed mechanically. Optional LLM upgrade runs fire-and-forget after immediate sync persist.
- **FTS5 per-agent database** — stored at `workspace/memory/sessions.db`. Sub-agents search only their own sessions.
- **Agent-created skills are local** — stored in `workspace/skills/` (not global skills dir) with `created_by: agent` frontmatter. Human-authored skills protected from modification.
- **Error observability** — all background failure paths log at `warn` level, not `debug`. Features degrade gracefully but failures are visible.

### Upstream Sync Risk

**Low for `openclaw-tools.ts`** — two import + conditional push additions following existing patterns.
**Low for `tool-catalog.ts`** — two array entries added to existing sections.
**Low for `system-prompt.ts`** — two entries in `coreToolSummaries` + `toolOrder`, one conditional block after memory section.
**Low for `session.ts`** — small addition after existing `persistSessionContextOnReset` call.
**None for all other files** — fully custom new files.

---

## Business Mode — Operator OS™ Integration (2026-03-09)

**Purpose:** Add a toggleable "Business Mode" that transforms the agent into a strategic business partner using the Operator OS™ persona. When enabled, a 22KB guide and 64 organized knowledge documents are seeded into the workspace, the SOUL.md gets a business partner section, and the system prompt injects partner persona + knowledge base search guidance.

### Server Changes (moltbotserver-source)

| File                                               | Change                                                                                                                                                    | Why                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/workspace.ts`                          | Added `resolveBusinessModeEnabled()` — reads `OPENCLAW_BUSINESS_MODE` + `OPENCLAW_BUSINESS_MODE_ENABLED` env vars                                         | Consistent with human mode dual-env-var pattern                                                                                           |
| `src/agents/workspace.ts`                          | Refactored `removeHumanModeSectionFromSoul()`, `removeBusinessModeSectionFromSoul()` into generic `stripConditionalBlock()` helper (−80 lines)            | Three identical 37-line functions with only marker strings different                                                                      |
| `src/agents/workspace.ts`                          | Added `copyDirectoryRecursive()` with `writeFileIfMissing` semantics + `.DS_Store` filtering                                                              | Seed template directories without overwriting user edits                                                                                  |
| `src/agents/workspace.ts`                          | Business mode seeding block: seeds `openclaw-business-v1.md` + copies `business/` docs when enabled                                                       | Knowledge base seeded on first enable                                                                                                     |
| `src/agents/workspace.ts`                          | Business mode deletion block: removes `business/` folder + guide when `OPENCLAW_BUSINESS_DELETE_FILES=true` and mode disabled                             | Two-step disable: user can optionally delete all files                                                                                    |
| `src/agents/workspace.ts`                          | Added `DEFAULT_BUSINESS_GUIDE_FILENAME` to `VALID_BOOTSTRAP_NAMES`, `WorkspaceBootstrapFileName`, and `loadWorkspaceBootstrapFiles()` extra context array | Business guide loaded into agent context when file exists                                                                                 |
| `src/agents/system-prompt.ts`                      | Added `hasBusinessModeFiles` detection + 12-line "Business Mode (Active)" context injection                                                               | System prompt tells agent it's in partner mode and how to search knowledge base                                                           |
| `docs/reference/templates/SOUL.md`                 | Added `<!-- if-business-mode -->` conditional block with "Business Partner Mode" section                                                                  | Agents get SOUL.md business section when enabled, stripped when disabled                                                                  |
| `docs/reference/templates/openclaw-business-v1.md` | **NEW** — 22KB guide merging v3.7 base + v6 inquisitive-partner improvements + SOUL.md principles                                                         | Core business partner persona: diagnostic gate, instruction challenge, opposing views, conviction calibration, knowledge base integration |
| `docs/reference/templates/business/`               | **NEW** — 64 organized knowledge documents across 8 categories                                                                                            | strategy/, content/, copywriting/, operations/, lead-generation/, books/, feedback/, database/                                            |

### Dashboard Changes (moltbot-dashboard)

| File                                                       | Change                                                                                                                                                          | Why                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/app/dashboard/instances/components/SettingsModal.tsx` | New "Business Mode" tab with `Briefcase` icon, amber toggle, two-step disable confirmation dialog with optional file deletion                                   | UI for enabling/disabling business mode with delete-files option |
| `src/app/dashboard/instances/actions.ts`                   | `InstanceSettings` type + `updateInstanceSettings()` + `redeployInstance()` + `getInstanceSettings()` updated for `businessModeEnabled` + `businessDeleteFiles` | Full type chain and persistence pipeline                         |
| `src/app/dashboard/instances/actions.ts`                   | `redeployInstance()` clears `businessDeleteFiles` from config after consumption (same pattern as `pendingApiKey`)                                               | Transient flag only fires once, not on subsequent restarts       |
| `src/app/api/instances/[id]/settings/route.ts`             | GET returns `businessModeEnabled`; PATCH accepts via Zod schema; sets `OPENCLAW_BUSINESS_MODE_ENABLED` + `OPENCLAW_BUSINESS_DELETE_FILES` env vars              | API persistence for business mode toggle and file deletion flag  |
| `src/lib/services/instance-env.ts`                         | Config type + `buildInstanceEnvVars()` emits `OPENCLAW_BUSINESS_MODE_ENABLED` and `OPENCLAW_BUSINESS_DELETE_FILES`                                              | Env var bridge between DB config and Docker container            |

### Design Decisions

- **Business mode defaults to OFF** — must be explicitly enabled (opposite of human mode which defaults on)
- **File seeding uses `writeFileIfMissing`** — user modifications are never overwritten on restart
- **Two-step disable:** (1) toggle off = exclude from context, (2) optional "also delete all business files" = `rm -rf business/` + guide
- **`businessDeleteFiles` is transient** — consumed once on redeploy, then cleared from DB config
- **Business mode supplements SOUL.md** — it adds partner mindset on top instead of replacing core principles
- **Knowledge base via `memory_search`** — no special tooling needed, QMD indexes the `business/` folder automatically

### Upstream Sync Risk

**Low for `workspace.ts`** — business mode additions are in MoltBot-custom blocks. Generic `stripConditionalBlock()` refactor touches the existing human-mode strippers but is a clean consolidation.
**Low for `system-prompt.ts`** — 12-line addition in existing `buildProjectContextSection` after the human mode block.
**None for all other files** — `SOUL.md` and `openclaw-business-v1.md` are custom templates. Dashboard files are fully custom.

---

## Browser Control Resilience — Parallel Profiles, Health Checks & Auto-Restart (2026-03-06)

**Purpose:** Fix intermittent "Can't reach the OpenClaw browser control service (timed out after 3000ms)" errors caused by serial profile checking, tight client timeouts, and unhealthy Chrome containers that Docker never restarted.

### Code Changes (moltbotserver-source)

| File                            | Change                                                        | Why                                                        |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/browser/server-context.ts` | `listProfiles()` serial `for` loop → `Promise.all` + `.map()` | 7 profiles × ~500ms serial = 3.5s; parallel = ~500ms total |
| `src/browser/client.ts`         | `browserProfiles` timeout `3000` → `5000`                     | Safety margin for parallel checks + network latency        |

### Infrastructure Changes (moltbot-dashboard)

| File                          | Change                                                                                         | Why                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- | --- | ---------------- |
| `hetzner-instance-service.ts` | Docker `healthcheck` (curl CDP every 30s, 3 retries) + `mem_limit: 512m` per browser container | Detect + prevent Chrome bloat            |
| `hetzner-instance-service.ts` | `browser-watchdog.sh` cron (every 5 min)                                                       | Auto-restart containers marked unhealthy |
| `hetzner-instance-service.ts` | Fixed `pipefail`-incompatible `grep` for `OPENCLAW_SANDBOX_BROWSER_IMAGE`                      | `{ grep ...                              |     | true; }` pattern |

### Upstream Sync Risk

**Medium for `server-context.ts`** — the `listProfiles` function is actively maintained upstream. The change replaces the body of a `for` loop with `Promise.all`.
**Low for `client.ts`** — single constant change (`3000` → `5000`).
**None for dashboard** — `hetzner-instance-service.ts` is fully custom.

---

## Managed Platform Mode Gating — Community Self-Hosting Support (2026-03-05)

**Purpose:** Enable community users to self-host the enhanced OpenClaw fork with full security, while managed (OCS/MoltBot) deployments remain unaffected. Previously, SaaS-mode security bypasses (disabled device auth, auto-onboard, auto-approve device pairing) were hardcoded. Now they're gated behind `OPENCLAW_MANAGED_PLATFORM=1`, which the dashboard already injects via docker-compose.

### Changes

| File                   | Change                                                                                                                 | Why                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `docker-entrypoint.sh` | Removed hardcoded `export OPENCLAW_MANAGED_PLATFORM=1`                                                                 | Env var now injected by dashboard docker-compose only                                       |
| `docker-entrypoint.sh` | Gated auto-onboard block (lines 252–437) behind `OPENCLAW_MANAGED_PLATFORM`                                            | Community users go through normal `openclaw onboard` setup                                  |
| `docker-entrypoint.sh` | Gated auto-approve device pairing (lines 786–813) behind `OPENCLAW_MANAGED_PLATFORM`                                   | Community users get normal device pairing flow for security                                 |
| `enforce-config.mjs`   | Gated `dangerouslyDisableDeviceAuth` and `dangerouslyAllowHostHeaderOriginFallback` behind `OPENCLAW_MANAGED_PLATFORM` | Community users get full device auth security                                               |
| `enforce-config.mjs`   | Added `healthcheck-security-audit` cron job for non-managed deployments                                                | Community users get weekly security audits (managed platform has dedicated scanner modules) |
| `enforce-config.mjs`   | Added `healthcheck-security-audit` to `MAIN_ONLY_JOBS`                                                                 | Sub-agents don't run duplicate audits                                                       |

### Deployment Modes

| Mode                        | How                                                            | Security Bypasses                                                    |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Managed (OCS)**           | Dashboard sets `OPENCLAW_MANAGED_PLATFORM=1` in docker-compose | Active: auto-onboard, auto-approve, disabled device auth             |
| **Community (self-hosted)** | Deploy Docker image without the env var                        | Inactive: normal setup flow, full device auth, weekly security audit |

### Upstream Sync Risk

**None.** `docker-entrypoint.sh` and `enforce-config.mjs` are fully custom files.

---

## Chromium Stealth Hardening & [Playwright](https://playwright.dev) Anti-Detection (2026-03-05)

**Purpose:** Reduce browser detectability by anti-bot systems (Twitter/X, Cloudflare, etc.) through two layers: Docker/Chrome-level hardening and [Playwright](https://playwright.dev)-level JavaScript evasions.

### Layer 1 — Docker & Chrome Flags

| File                                        | Change                                                                                                                                                                                                                                                                          | Why                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Dockerfile.sandbox-browser`                | Added `fonts-noto`, `fonts-dejavu-core`, `fonts-freefont-ttf`                                                                                                                                                                                                                   | Missing system fonts is a trivial fingerprint                 |
| `scripts/sandbox-browser-entrypoint.sh`     | Xvfb resolution `1280x800` → `1920x1080`; WebGL default **on** (`DISABLE_GRAPHICS_FLAGS=0`); `--disable-blink-features=AutomationControlled`; `--lang=en-US`; `--disable-features=AutofillServerCommunication`; `TZ_OVERRIDE` + `UA_OVERRIDE` env vars; window size `1920,1080` | Each addresses a known detection vector                       |
| `dashboard/.../hetzner-instance-service.ts` | `hetznerLocationToTimezone()` helper; `TZ` + `LANG` env vars in main + per-agent browser Compose blocks                                                                                                                                                                         | Region-aware timezone prevents TZ/locale mismatch fingerprint |

### Layer 2 — Playwright Stealth Scripts

| File                             | Change                                                            | Why                                                                   |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/browser/stealth-scripts.ts` | **NEW** — 8 evasion scripts injected via `addInitScript()`        | Patches CDP/Playwright fingerprints that Chrome flags alone can't fix |
| `src/browser/pw-session.ts`      | `context.addInitScript(getStealthScript())` in `observeContext()` | Every page in every context gets evasions before site JS runs         |

**Evasions included:**

| #   | Target                    | What it patches                                          |
| --- | ------------------------- | -------------------------------------------------------- |
| 1   | `navigator.webdriver`     | Force `undefined` (belt-and-suspenders with Chrome flag) |
| 2   | `navigator.plugins`       | Spoof 3-item PluginArray (Chrome PDF, NaCl)              |
| 3   | `navigator.languages`     | Ensure `['en-US', 'en']`                                 |
| 4   | `chrome.runtime`          | Stub `connect`/`sendMessage` to hide CDP artifacts       |
| 5   | `Notification.permission` | Return `'default'` instead of `'denied'`                 |
| 6   | WebGL renderer            | Override `UNMASKED_VENDOR/RENDERER` to Intel Iris        |
| 7   | `window.chrome`           | Ensure `chrome.app`/`csi`/`loadTimes` exist              |
| 8   | iframe `contentWindow`    | Patch cross-origin `webdriver` leak                      |

### Upstream Sync Risk

**None for Docker/entrypoint files** — fully custom.
**Low for `pw-session.ts`** — single `import` + 3-line `addInitScript` call in `observeContext()`.
**None for `stealth-scripts.ts`** — fully custom new file.

### Verification

- `navigator.webdriver` → `undefined`
- `navigator.plugins.length` → `3`
- `window.chrome` → object with `app`/`csi`/`loadTimes`
- `bot.sannysoft.com` → all checks green
- WebGL renderer → "Intel Iris OpenGL Engine"

---

## Browser Startup Sweep — Auto-Update Stale Containers (2026-03-05)

**Purpose:** Automatically update sandbox browser containers to the latest image when the gateway starts. Previously, deploying a new browser image (e.g., with the CDP proxy fix) required manually `docker pull` + `docker rm` + `docker create` for every agent browser container. Now, `docker compose pull && docker compose up -d` is all that's needed — the gateway handles the rest.

### How It Works

1. Gateway starts → `sweepStaleBrowserContainers()` fires (fire-and-forget, never blocks boot)
2. Pulls the latest browser image from GHCR (`docker pull`)
3. Lists all containers with label `openclaw.sandboxBrowser=1`
4. Compares each container's image digest to the freshly pulled image
5. Stale containers are removed and recreated with the same env/volumes/labels/name, then connected to `OPENCLAW_DOCKER_NETWORK`
6. Up-to-date containers are untouched

### Changes

| File                                       | Change                                                                                                                                                          | Why                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/agents/sandbox/browser-sweep.ts`      | **NEW** — `sweepStaleBrowserContainers()` + helpers (`pullBrowserImage`, `listSandboxBrowserContainers`, `inspectBrowserContainer`, `recreateBrowserContainer`) | Core sweep logic                                                   |
| `src/agents/sandbox/browser-sweep.test.ts` | **NEW** — 12 unit tests (pull failure, no containers, up-to-date skip, stale recreation, network connect, per-container error isolation)                        | Comprehensive coverage                                             |
| `src/agents/sandbox/docker.ts`             | Added `readDockerImageId()` and `readDockerContainerImageId()`                                                                                                  | Image digest comparison utilities                                  |
| `src/gateway/server-startup.ts`            | Fire-and-forget `sweepStaleBrowserContainers()` call in `startGatewaySidecars()` after browser control server starts                                            | Hook into gateway boot                                             |
| `docker-compose.yml`                       | Added `OPENCLAW_DOCKER_NETWORK` env var to gateway service                                                                                                      | Ensures dynamically created browsers join the right Docker network |

### Design Decisions

- **Fire-and-forget**: Sweep runs async, never blocks gateway startup. Errors logged, not thrown.
- **Per-container isolation**: One container failing doesn't abort the sweep for others.
- **Label-based filtering**: Only touches `openclaw.sandboxBrowser=1` containers — won't affect non-browser sandboxes.
- **Config preservation**: Reads env, volumes, and labels from the old container via `docker inspect` to faithfully recreate.
- **Only when sandbox enabled**: Skipped entirely when `agents.defaults.sandbox.mode === "off"`.

### Upstream Sync Risk

**Low for `docker.ts`** — two new exported functions appended after `dockerContainerState()`, no existing code modified.
**Low for `server-startup.ts`** — small import + fire-and-forget call block added after browser control server. If upstream restructures `startGatewaySidecars`, the insertion point is obvious.
**None for `browser-sweep.ts`** — fully custom new file.

---

## SQL Tool Integration — `sql_query` & `sql_execute` (2026-03-05)

**Purpose:** Give agents direct SQL access to structured data. Two new tools: `sql_query` for read-only access to the memory index database (supports both QMD and builtin backends), and `sql_execute` for read-write access to custom SQLite databases within the agent workspace.

### Changes

| File                                | Change                                                                                                  | Why                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/agents/tools/sql-tool.ts`      | **NEW** — `createSqlQueryTool()` and `createSqlExecuteTool()` factory functions                         | Core tool implementations                                    |
| `src/agents/tools/sql-tool.test.ts` | **NEW** — 22 unit tests covering both tools                                                             | Validation of permissions, path sandboxing, CRUD, edge cases |
| `src/agents/openclaw-tools.ts`      | Added import + registration of both SQL tools                                                           | Tools available to agents via the standard tool pipeline     |
| `src/agents/tool-catalog.ts`        | Added `sql_query` and `sql_execute` entries in `CORE_TOOL_DEFINITIONS` (memory section, coding profile) | Agents with `coding` profile get these tools                 |

### Tool Details

**`sql_query`** — Read-only memory index queries:

- Detects active backend via `resolveMemoryBackendConfig()`: QMD → resolves `$stateDir/agents/$agentId/qmd/xdg-cache/qmd/index.sqlite`; builtin → standard memory store path
- QMD schema introspected dynamically via `PRAGMA table_info()`; builtin uses known static schema hint
- Blocked: INSERT, UPDATE, DELETE, DROP, ATTACH, DETACH, dangerous PRAGMAs
- Max 100 rows, 50K chars result cap

**`sql_execute`** — Custom workspace databases:

- Read-write `.db` files within agent workspace (independent of memory backend)
- Path sandboxed (no traversal, no symlinks, must end `.db`), creates on first use, WAL mode
- Supports SELECT, INSERT, UPDATE, DELETE, CREATE/DROP/ALTER TABLE, CREATE INDEX
- Blocked: ATTACH, DETACH, dangerous PRAGMAs

### Upstream Sync Risk

**Low.** Two new custom files (no conflict). `openclaw-tools.ts` has a small import + array append. `tool-catalog.ts` has two array entries added after `memory_get`. Both are simple additions that merge cleanly.

---

## Typing TTL "Still Thinking" Callback & Auto-Reply Cleanup (2026-03-03)

**Purpose:** When long-running LLM tool calls exceed the 2-minute typing indicator TTL, the user previously saw the typing indicator stop with no feedback. Now the system sends a "⏳ Still thinking, hang tight..." status message so users know the agent is still working.

### Changes

| File                                       | Change                                                                              | Why                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/auto-reply/reply/typing.ts`           | Added `onTtlExpired` callback, fired when TTL expires while LLM run is still active | Core hook for the "still thinking" feature                            |
| `src/auto-reply/reply/reply-dispatcher.ts` | Added `onTtlExpired` option; default sends status message via `deliver`             | Provides sensible default without requiring per-channel configuration |
| `src/auto-reply/reply/get-reply.ts`        | Passes `opts.onTtlExpired` into `createTypingController`                            | Wires the callback through the reply pipeline                         |
| `src/auto-reply/dispatch.ts`               | Destructures + forwards `onTtlExpired` from dispatcher into reply options           | Connects the buffered dispatch path                                   |
| `src/auto-reply/types.ts`                  | Added `onTtlExpired` field on `GetReplyOptions`                                     | Type safety for the new option                                        |

### Upstream Sync Risk

**Medium.** Five upstream auto-reply files touched with small additions (new optional field + callback plumbing). Each change is a few lines — conflicts will be straightforward single-line resolves if upstream modifies these signatures.

---

## Browser Auto-Download to Agent Workspace (2026-03-02)

**Purpose:** When an agent clicks a download link during browser tool use, the file is automatically saved to the agent's `workspace/downloads/` directory. Previously downloads were lost unless the agent explicitly used `waitfordownload`.

### Changes

| File                                         | Change                                                                                              | Why                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/browser/download-workspace-registry.ts` | **NEW** — Per-CDP-URL workspace registry + shared `sanitizeAutoDownloadFilename()` helper           | Maps browser profiles to agent workspace paths               |
| `src/browser/control-service.ts`             | Registers per-profile workspace paths on start; clears on stop                                      | Wires browser profiles to download destinations              |
| `src/browser/pw-tools-core.interactions.ts`  | Auto-download capture on `clickViaPlaywright` — 3s download race after every click                  | Catches downloads triggered by navigation-free links         |
| `src/browser/pw-tools-core.downloads.ts`     | Uses shared `sanitizeAutoDownloadFilename()` instead of inline sanitizer                            | DRY: consolidated duplicate sanitization logic               |
| `src/browser/pw-session.ts`                  | `findPageByTargetId` uses `fetchJson` instead of raw `fetch()` for Docker Host header compatibility | Fixes target resolution failures when using Docker hostnames |

### Upstream Sync Risk

**Medium.** `control-service.ts`, `pw-tools-core.interactions.ts`, `pw-tools-core.downloads.ts`, and `pw-session.ts` are actively maintained upstream. The download registry is a new custom file (no conflicts). The `pw-session.ts` change replaces `fetch()` with `fetchJson()` in one function — same fix pattern as the CDP Host header work.

---

## Per-Agent OAuth Isolation (2026-03-02)

**Purpose:** OAuth tokens are now scoped per-agent instead of being silently shared across all agents. Previously, `adoptNewerMainOAuthCredential()` would overwrite a sub-agent's OAuth token with the main agent's whenever the main agent's was fresher, and a fallback path would inherit main-agent credentials when refresh failed. This broke per-agent OAuth isolation (e.g., different Google accounts per agent).

### Changes

| File                                       | Change                                                                                    | Why                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/agents/auth-profiles/oauth.ts`        | Removed `adoptNewerMainOAuthCredential()` (~37 lines) and main-agent fallback (~22 lines) | Each agent must be authenticated independently                       |
| `src/cli/program/register.onboard.ts`      | Added `--agent <agentId>` and `--sync-all` CLI flags                                      | Scope credential writes to a specific agent; opt-in legacy broadcast |
| `src/commands/auth-choice.apply.openai.ts` | `syncSiblingAgents` default changed `true` → `opts?.syncSiblingAgents === true`           | Per-agent isolation is the new default                               |
| `src/commands/configure.gateway-auth.ts`   | Added `agentDir?: string` parameter to `promptAuthConfig()`                               | Auth wizard can target a specific agent directory                    |
| `src/commands/onboard-types.ts`            | Added `syncSiblingAgents` and `targetAgentId` fields on `OnboardOptions`                  | Type definitions for the new CLI options                             |

### Upstream Sync Risk

**High for `oauth.ts`** — ~60 lines of code removed from an actively-maintained upstream file. Upstream may add new credential-sharing logic that conflicts.
**Medium for CLI/commands** — small additions to option definitions that upstream may extend.

---

## Heartbeat Default Interval: 30m → 1h (2026-03-02)

**Purpose:** Reduce heartbeat frequency from every 30 minutes to every 1 hour. The 30-minute interval was generating too much traffic and unnecessary model invocations for agents that don't need frequent check-ins.

### Changes

| File                                 | Change                                                   | Why                            |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------ |
| `src/auto-reply/heartbeat.ts`        | `DEFAULT_HEARTBEAT_EVERY` changed from `"30m"` to `"1h"` | Reduced unnecessary heartbeats |
| `src/config/types.agent-defaults.ts` | Updated JSDoc comment `default: 30m` → `default: 1h`     | Documentation alignment        |

### Upstream Sync Risk

**Low.** Single-line constant change. If upstream changes the default, the conflict is trivial.

---

## Telegram Media Download Timeout (2026-03-01)

**Purpose:** Prevent hung media downloads (stuck Telegram API calls) from blocking processing of entire message groups. Added a 15-second timeout on all `resolveMedia` calls. Previously, a single stuck download could block an entire media group indefinitely.

### Changes

| File                           | Change                                                                                            | Why                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/telegram/bot-handlers.ts` | Added `MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000`; wrapped `resolveMedia` in `Promise.race` with timeout | Hard cap on media download wait time                         |
| `src/telegram/bot-handlers.ts` | Timeout errors treated as recoverable in `isRecoverableMediaGroupError`                           | One hung image doesn't abort the whole media group           |
| `src/telegram/bot-handlers.ts` | Replaced swallowed `.catch(() => undefined)` with error logging                                   | Failures are now visible in logs instead of silently dropped |

### Upstream Sync Risk

**Medium.** `bot-handlers.ts` is actively maintained upstream. Changes are localized (timeout wrapping + error classification) but touch the media processing hot path.

---

## NEXT_WAKE Parsing Fix (2026-03-02)

**Purpose:** Fix `NEXT_WAKE:` directive being missed when the agent's response is long enough that the directive falls outside the truncated summary. Now parses from the full `outputText`. Also added `NEXT_WAKE` support for main session jobs by parsing from the static payload text.

### Changes

| File                        | Change                                                                                | Why                                                      |
| --------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/cron/service/timer.ts` | `parseNextWakeDuration()` reads from full `outputText` instead of truncated `summary` | Directives in long responses were being silently dropped |
| `src/cron/service/timer.ts` | Main session jobs parse `NEXT_WAKE` from static payload text                          | Session jobs now support dynamic scheduling              |

### Upstream Sync Risk

**Medium.** `timer.ts` is core cron infrastructure. Changes are in the MoltBot-custom `parseNextWakeDuration` function and its call sites.

---

## Alibaba Cloud / Bailian Provider (2026-03-01)

**Purpose:** Add [Alibaba Cloud (Bailian/DashScope)](https://dashscope.aliyun.com) as an implicit AI provider, removing the preset system and enabling reasoning-mode support for Qwen3 and Kimi models. Also removed the `healthcheck-security-audit` cron job (the security scanner modules handle this better).

### Changes

| File                     | Change                                               | Why                                    |
| ------------------------ | ---------------------------------------------------- | -------------------------------------- |
| `enforce-config.mjs`     | Bailian provider configuration + model normalization | Alibaba Cloud integration              |
| `enforce-config.mjs`     | Removed `healthcheck-security-audit` from cron seed  | Redundant with content-scanner modules |
| `cron/default-jobs.json` | Removed `healthcheck-security-audit` job definition  | Same                                   |

### Upstream Sync Risk

**None.** All files are fully custom.

---

## Gateway Self-Restart & Rate Limit Enforcement (2026-02-28)

**Purpose:** Enable the gateway to self-restart inside Docker managed-platform containers (for config reloads that require a process restart), and enforce `gateway.auth.rateLimit` configuration.

### Changes

| File                   | Change                                                           | Why                                                   |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `docker-entrypoint.sh` | Gateway self-restart support for managed-platform containers     | Config reloads that need a restart now work in Docker |
| `enforce-config.mjs`   | Added `gateway.auth.rateLimit` enforcement in `enforceGateway()` | Rate limiting applied consistently across deployments |

### Upstream Sync Risk

**None.** Both files are fully custom.

---

## Self-Audit-21 Weekly Job & agentId Browser Fix (2026-02-28)

**Purpose:** Two unrelated fixes: (1) Add a weekly 21-question strategic self-audit cron job that feeds an improvement backlog, (2) Pass `agentId` to `createBrowserTool()` in `openclaw-tools.ts` so agents route to their dedicated browser containers instead of all sharing the main browser.

### Changes

| File                           | Change                                                            | Why                                                |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| `cron/default-jobs.json`       | Added `self-audit-21` job (Sun 11 PM)                             | Weekly strategic audit for continuous improvement  |
| `enforce-config.mjs`           | `self-audit-21` in seed array + `MAIN_ONLY_JOBS`                  | Only main agent runs the audit                     |
| `src/agents/openclaw-tools.ts` | `agentId: resolveSessionAgentId()` added to `createBrowserTool()` | Agents use their own browser, not the main agent's |

### Upstream Sync Risk

**Low.** `openclaw-tools.ts` is the only upstream file touched — single-line addition. Cron files are fully custom.

---

## Gateway Browser Routing & Extension Ownership Fix (2026-02-28)

**Purpose:** Wire the per-agent browser proxy into the gateway HTTP/WS router so the dashboard can display and interact with agent browsers, and fix extension folder ownership issues.

### Root Causes & Fixes

#### 1. Extensions Re-Chown — Global `chown` Reset Root Ownership

**Problem:** Line 695 runs `chown -R node:node "$CONFIG_DIR"` to fix config file permissions. But `$CONFIG_DIR` includes `extensions/`, resetting plugin files from `uid=0` back to `uid=1000`. The plugin scanner then rejects them.

| File                   | Change                                                                                     | Why                                              |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `docker-entrypoint.sh` | Added `chown -R root:root "$CONFIG_DIR/extensions"` after the global chown (lines 696–700) | Restores root ownership specifically for plugins |

#### 2. Sandbox Browser Handlers — Dead Code in Gateway Router

**Problem:** `handleSandboxBrowserRequest` and `handleSandboxBrowserUpgrade` were defined and exported in `sandbox-browsers.ts` but **never imported or called** in `server-http.ts`. The gateway's HTTP router served the SPA HTML at `/api/sandbox-browsers` instead of the browser list JSON, and the WebSocket proxy for noVNC was unreachable.

| File                         | Change                                                                                                                     | Why                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/gateway/server-http.ts` | Imported `handleSandboxBrowserRequest` and `handleSandboxBrowserUpgrade` from `sandbox-browsers.js`                        | Dead code needed to be wired in                                                |
| `src/gateway/server-http.ts` | Inserted `handleSandboxBrowserRequest` in HTTP chain after `handleToolsInvokeHttpRequest`, before `handleSlackHttpRequest` | Route must be checked before the Control UI SPA catch-all                      |
| `src/gateway/server-http.ts` | Inserted `handleSandboxBrowserUpgrade` in WebSocket upgrade chain before the general WS server                             | WebSocket upgrades for noVNC must be intercepted before the gateway WS handler |

#### 3. noVNC Auth — Static Assets & WebSocket

**Problem:** The sandbox browser proxy required gateway auth for **all** `/sbx-browser/` requests. noVNC loads CSS/JS/images as sub-resources in an iframe — these requests don't carry the auth token. Additionally, noVNC builds a bare `wss://host/path` WebSocket URL with no auth token or query params.

| File                              | Change                                                                                                         | Why                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/gateway/sandbox-browsers.ts` | Added `isSensitiveBrowserPath()` helper — only `vnc.html`, `vnc_lite.html`, `/`, and `websockify` require auth | Static assets (CSS/JS/images/fonts) pass through unauthenticated |
| `src/gateway/sandbox-browsers.ts` | HTTP proxy: auth check gated by `isSensitiveBrowserPath(parsed.subPath)`                                       | Sub-resources load without 401 errors                            |
| `src/gateway/sandbox-browsers.ts` | WebSocket upgrade: removed auth check entirely (parameter renamed to `_opts`)                                  | noVNC doesn't pass tokens in WS upgrade requests                 |

**Security model:** Matches Caddy's pattern for the main browser — `vnc.html` is the auth gate, static assets and the WebSocket pass through. The VNC session can't be accessed without first loading the authenticated entry page.

### Verification Results

| System                              | Status                        |
| ----------------------------------- | ----------------------------- |
| Gateway                             | Stable, all providers running |
| `/api/sandbox-browsers`             | Returns JSON (requires auth)  |
| Static assets (`app/ui.js`, images) | HTTP 200 (no auth required)   |
| `vnc.html` without token            | HTTP 401 (auth required)      |
| All 5 Telegram providers            | Running                       |

### Upstream Sync Risk

**Low for `server-http.ts`** — the import and two insertion points touch upstream code but are small additions.
**None for `sandbox-browsers.ts`** — fully custom file.
**None for `docker-entrypoint.sh`** — fully custom file.

---

## Run Gateway as Root & Fix npm Global Install Permissions (2026-02-28)

**Purpose:** Remove the `gosu node` privilege drop so the OpenClaw gateway process runs as `root` inside the container. This eliminates permission issues when skills use `npm i -g` (e.g. ClawHub CLI install failing with `EACCES: permission denied, mkdir '/usr/local/lib/node_modules/clawhub'`).

### Root Cause

The entrypoint ran setup as `root` then dropped to `node` (uid 1000) via `gosu node` on the final `exec` line. The base Node.js Docker image owns `/usr/local/lib/node_modules` and `/usr/local/bin` as `root`, so when OpenClaw's skill install mechanism ran `npm i -g clawhub` as `node`, it failed with EACCES.

### Changes

| File                   | Change                                                                            | Why                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docker-entrypoint.sh` | Removed `gosu node` privilege drop — final `exec` now runs as `root`              | Eliminates all permission issues; agent already had passwordless sudo anyway   |
| `docker-entrypoint.sh` | Added `chown -R node:node /usr/local/lib/node_modules /usr/local/bin` (defensive) | Safety net for any code that still expects `node` ownership of npm global dirs |

### Security Assessment

No practical security impact:

- The `node` user already had **passwordless sudo** (`/etc/sudoers.d/node`), so the privilege boundary was security theater
- **Docker container isolation** is the real security boundary — root inside the container ≠ root on the Hetzner host
- The gateway is behind Caddy with token auth; no VNC/CDP ports are exposed to the internet

### Upstream Sync Risk

**None.** `docker-entrypoint.sh` is fully custom.

---

## Nightly Innovation & Morning Briefing Cron Jobs (2026-02-28)

**Purpose:** Two new default cron jobs that create a daily rhythm: the AI works autonomously overnight building improvements, then delivers a personalized morning briefing to start the user's day.

### Changes

| File                     | Change                                                                        | Why                                                   |
| ------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| `cron/default-jobs.json` | Added `nightly-innovation` job (2 AM) — 5-phase prompt with announce delivery | Agents proactively build improvements overnight       |
| `cron/default-jobs.json` | Added `morning-briefing` job (8 AM) — 3-phase prompt with announce delivery   | Users get a personalized daily briefing every morning |
| `enforce-config.mjs`     | Added both jobs to `seedCronJobs()` fresh-seed array                          | Fresh installs get both jobs automatically            |
| `enforce-config.mjs`     | Added both jobs to `MAIN_ONLY_JOBS` set                                       | Sub-agents excluded — only main agent runs these      |

### Nightly Innovation (2 AM)

- **Tiered approach**: Quick wins built immediately, medium efforts self-assigned via follow-up cron jobs ("love loops"), big/irreversible items drafted as proposals requiring user approval
- **Safety**: Prompt explicitly prohibits irreversible actions without user consent

### Morning Briefing (8 AM)

- Reviews all available context: MEMORY.md, WORKING.md, open loops, diary, knowledge base, identity, recent sessions
- Checks the nightly innovation job's output and weaves overnight findings into the briefing
- Sections: Today's Focus, What's In Motion, Needs Attention, Overnight Update, Suggestions, Upcoming
- Self-improving template — AI learns user preferences and calibrates over time
- Users can refine the briefing by simply chatting with the AI

### Upstream Sync Risk

**None.** `cron/default-jobs.json` is a seed file, not upstream code. Additive change only.

---

## Gateway Auto-Approve & Sub-Agent Cron Filtering (2026-02-28)

**Purpose:** Fix two issues that blocked CLI management after fresh deploys and caused new sub-agents to receive an incomplete cron job set.

### Issue 1: Gateway Pairing Blocks CLI

The gateway requires device pairing for CLI RPC access even with token auth. Inside a Docker container, no one is around to manually approve. The entrypoint now backgrounds a loop that waits for the gateway to start (up to 15s), then auto-approves the pending device.

| File                   | Change                                                    | Why                                                                                            |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docker-entrypoint.sh` | Added backgrounded device auto-approve loop before `exec` | CLI commands (`cron list`, `agents update`, etc.) no longer fail with `1008: pairing required` |

### Issue 2: Sub-Agents Get Wrong Cron Set

The `create-agent` skill's main agent was using `openclaw cron add` (RPC-based, blocked by pairing) and falling back to a manual 4-job subset. `enforce-config.mjs cron-seed` writes directly to disk and produces the full set — this is the canonical method.

Additionally, `healthcheck-security-audit` and `healthcheck-update-status` only need to run on the main agent, not all sub-agents. Added `MAIN_ONLY_JOBS` filtering so sub-agents get 8 jobs.

| File                                   | Change                                                                                                                 | Why                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `enforce-config.mjs`                   | Added `MAIN_ONLY_JOBS` set and `excludeNames` parameter to `seedCronJobs()`                                            | Sub-agents get 8 jobs; main-only healthcheck jobs excluded |
| `enforce-config.mjs`                   | `seedSubAgentCronJobs()` passes `{ excludeNames: MAIN_ONLY_JOBS }`                                                     | Automatic filtering for all sub-agent workspace cron seeds |
| `.agents/skills/create-agent/SKILL.md` | Step 10 rewritten: emphasizes disk-based seeding, warns against RPC method, adds reseed instructions for legacy agents | Prevents future agents from getting partial cron sets      |

### Fixing Existing Agents

Agents created before this fix (mm-ezra, mm-david, ocs-solomon, ocs-nehemiah) have legacy partial cron sets. To fix:

```bash
# Delete stale jobs and re-seed from enforce-config
for agent in mm-ezra mm-david ocs-solomon ocs-nehemiah; do
  rm -f /home/node/data/workspace-$agent/.openclaw/cron/jobs.json
done
node /app/enforce-config.mjs cron-seed
```

### Issue 3: MEMORY.md Never Seeded

`MEMORY.md` is referenced in 40+ places (deep-review cron, memory_search, doctor-workspace, system prompt) but had no template and was never created during workspace bootstrap.

| File                                 | Change                                                | Why                                                     |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------- |
| `docs/reference/templates/MEMORY.md` | **NEW** — Structured skeleton with section headers    | Agents get a consistent MEMORY.md layout on first boot  |
| `src/agents/workspace.ts`            | Added `MEMORY.md` seeding to `ensureAgentWorkspace()` | Both main and sub-agent workspaces get it automatically |

### Upstream Sync Risk

**None.** `docker-entrypoint.sh`, `enforce-config.mjs`, `create-agent/SKILL.md`, and `workspace.ts` MEMORY.md seeding are all fully custom. The new template is additive.

---

## CDP Host Header Fix — Dual-Layer (2026-02-27)

**Purpose:** Fix Chrome DevTools Protocol (CDP) connection failures when using Docker hostname URLs like `http://browser:9222`. Chromium 107+ rejects HTTP requests where the `Host` header isn't `localhost` or an IP address. Node.js `fetch()` silently ignores `Host` header overrides (forbidden per Fetch spec), so the existing `getHeadersWithAuth()` fix in `cdp.helpers.ts` had no effect on HTTP requests.

### Layer 1 — Node.js Client Fix

| File                         | Change                                                                                                       | Why                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/browser/cdp.helpers.ts` | Added `httpRequestWithHostOverride()` — uses `http.request()` instead of `fetch()` when Host override needed | `http.request()` respects custom Host headers; `fetch()` silently drops them                        |
| `src/browser/cdp.helpers.ts` | Modified `fetchChecked()` to route through `httpRequestWithHostOverride` when a Host header override is set  | All CDP HTTP requests (via `fetchJson`/`fetchOk`) now properly send `Host: localhost`               |
| `src/browser/chrome.ts`      | Changed `fetchChromeVersion()` to use `fetchJson()` instead of direct `fetch()`                              | Routes through the fixed `fetchChecked` path; was previously bypassing the Host header fix entirely |

### Layer 2 — Container-Level Proxy

| File                                    | Change                                                                                            | Why                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `scripts/cdp-host-proxy.py`             | **NEW** — Python HTTP+WebSocket reverse proxy that rewrites Host header to `localhost`            | Belt-and-suspenders: fixes the Host header at the container level for any client            |
| `scripts/sandbox-browser-entrypoint.sh` | Replaced `socat` TCP proxy with the Python CDP proxy; socat retained as fallback for older images | The Python proxy rewrites Host headers; socat just forwards TCP without header manipulation |
| `Dockerfile.sandbox-browser`            | Added `COPY scripts/cdp-host-proxy.py /usr/local/bin/openclaw-cdp-host-proxy`                     | Makes the proxy script available in the container image                                     |

### Upstream Sync Risk

**⚠️ HIGH for `cdp.helpers.ts` and `chrome.ts`.** These files exist in upstream and are actively modified. The upstream merge on 2026-02-27 silently overwrote this fix. See `LOCAL_PATCHES.md` for verification commands.

**None for Layer 2.** All container files (`cdp-host-proxy.py`, `sandbox-browser-entrypoint.sh`, `Dockerfile.sandbox-browser`) are fully custom.

---

## Architect-First Reinforcement, Memory Seeding & Sub-Agent Heartbeats (2026-02-27)

**Purpose:** Deeply embed the principle of "think like an architect" (plan before acting, ask clarifying questions) throughout all agent-facing surfaces, seed structured memory files for all agents including sub-agents at workspace bootstrap, and enable heartbeat functionality for sub-agents.

### Changes

| File                                    | Change                                                                                                                            | Impact                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `SOUL.md`                               | Strengthened architect-first language — added "Count the Cost" framing, explicit plan-before-act requirements                     | All agents get clearer think-first guidance    |
| `SOUL_DELEGATION_SNIPPET.md`            | Reinforced delegation principles with architect-first thinking                                                                    | Sub-agents inherit architectural mindset       |
| `OPERATIONS.md`                         | Added architect-first reminders in operational guidance                                                                           | Operational context reinforces planning        |
| `BOOTSTRAP.md`                          | Added startup verification of planning mindset                                                                                    | Boot sequence reinforces think-first           |
| `IDENTITY.md`                           | Minor alignment with architect-first principles                                                                                   | Identity context consistency                   |
| `docs/reference/templates/PRACTICAL.md` | Added lightweight architect-first guidance for new agent templates                                                                | New agents start with planning mindset         |
| `src/agents/system-prompt.ts`           | Enhanced system prompt injection with architect-first framing                                                                     | Runtime prompt reinforcement                   |
| `src/agents/workspace.ts`               | Seed `diary.md`, `self-review.md`, `open-loops.md`, `identity-scratchpad.md` for all agents including sub-agents during bootstrap | Sub-agents get structured memory from creation |
| `enforce-config.mjs`                    | Added `heartbeat: {}` for sub-agents when not already configured                                                                  | Sub-agents can now run heartbeat cycles        |

### Tests Added

- `src/agents/system-prompt.test.ts` — 22 new lines covering architect-first prompt injection
- `src/agents/workspace.test.ts` — 29 new lines covering memory file seeding
- `src/agents/workspace.e2e.test.ts` — 25 new lines covering sub-agent workspace bootstrap

### Upstream Sync Risk

**Low.** `SOUL.md`, `OPERATIONS.md`, `BOOTSTRAP.md`, `IDENTITY.md` are fully custom. `workspace.ts` changes are additive (new seeding logic). `enforce-config.mjs` is fully custom. `system-prompt.ts` change is a small addition to an existing MoltBot-only block.

---

## noVNC Sandbox Browser Viewport Sizing (2026-02-27)

**Purpose:** Fix the noVNC browser viewing area having excessive blank space by making the display adapt to the browser window size instead of using a fixed oversized resolution.

### Changes

| File                                    | Change                                                                                                                          | Why                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/sandbox-browser-entrypoint.sh` | Added viewport sizing configuration — set `DISPLAY_WIDTH` and `DISPLAY_HEIGHT` to sane defaults, added `-geometry` flag to Xvfb | Browser viewport matches container window instead of oversized default |

### Upstream Sync Risk

**None.** `sandbox-browser-entrypoint.sh` is fully custom to MoltBot.

---

## Fix: humanDelay Crash Loop (2026-02-26)

**Purpose:** Remove invalid `messages.humanDelay` config key from `enforce-config.mjs` that caused the gateway container to crash-loop on every restart. The key doesn't exist in the OpenClaw config schema — the correct location for human typing delay is within the messages config under a different structure.

### Changes

| File                 | Change                                          | Why                                                        |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `enforce-config.mjs` | Removed `messages.humanDelay` setting (7 lines) | Invalid config key caused instant crash on gateway startup |

### Upstream Sync Risk

**None.** `enforce-config.mjs` is fully custom.

---

## Human Mode Dual Env Var & Bootstrap Allowlist Fix (2026-02-26)

**Purpose:** Accept both `OPENCLAW_HUMAN_MODE` and `OPENCLAW_HUMAN_MODE_ENABLED` environment variables for toggling human voice mode, and fix the bootstrap file allowlist so `howtobehuman.md` and `writelikeahuman.md` are correctly loaded at startup.

### Changes

| File                                                      | Change                                                                                                       | Why                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/agents/workspace.ts`                                 | `resolveHumanModeEnabled()` now checks both `OPENCLAW_HUMAN_MODE` and `OPENCLAW_HUMAN_MODE_ENABLED` env vars | Different deployment configs used different env var names                                    |
| `src/agents/workspace.ts`                                 | Added `howtobehuman.md` and `writelikeahuman.md` to `MINIMAL_BOOTSTRAP_ALLOWLIST`                            | Files were being rejected by the allowlist despite being configured as extra bootstrap files |
| `enforce-config.mjs`                                      | Updated bootstrap file configuration to reference correct filenames                                          | Aligns enforce-config with the two-file human voice model                                    |
| `src/agents/workspace.load-extra-bootstrap-files.test.ts` | Added 27 new test lines for allowlist validation                                                             | Ensures bootstrap files are correctly loaded                                                 |
| `docs/reference/templates/naturalvoice.md`                | **DELETED** (955 lines)                                                                                      | Obsolete — replaced by `howtobehuman.md` + `writelikeahuman.md` in a previous change         |

### Upstream Sync Risk

**None.** All files are MoltBot-only. `workspace.ts` changes are within MoltBot custom logic blocks.

---

## CI & Entrypoint Infrastructure (2026-02-26)

**Purpose:** Fix GHCR Docker image push permissions and wire `enforce-config.mjs` as the final config layer in the container entrypoint.

### Changes

| File                                   | Change                                                                   | Why                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `.github/workflows/docker-build.yml`   | Added `provenance: false` to Docker build-push action                    | Disabled attestation/provenance to fix `denied: permission_denied: write_package` errors on GHCR push     |
| `docker-entrypoint.sh` (via `8dee7ec`) | Added `enforce-config all` call as the final step before gateway startup | Ensures all MoltBot config overrides are applied as the last config layer, after any other config sources |

### Upstream Sync Risk

**None.** `docker-entrypoint.sh` changes are in MoltBot-only blocks. CI workflow is fully custom.

---

## Cron Seeding & System Prompt Alignment (2026-02-26)

**Purpose:** Align `enforce-config.mjs` cron seeding with the documented 3-tier reflection system and fix the SOUL.md system prompt description.

### Changes

| File                          | Change                                                                                                | Impact                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `enforce-config.mjs`          | Removed legacy `diary` and `identity-review` cron jobs from fresh-seed path                           | New agents no longer get conflicting duplicate reflection jobs              |
| `enforce-config.mjs`          | Updated patching logic to target 3-tier jobs (`consciousness`, `self-review`, `deep-review`)          | Reflection frequency changes now correctly toggle the right jobs            |
| `enforce-config.mjs`          | Added legacy job disabling on patch — `diary`/`identity-review` set to `enabled: false`               | Existing deployments get cleaned up on next restart                         |
| `enforce-config.mjs`          | Removed unused `diaryMs`/`identityMs` from fresh-seed destructuring                                   | Consciousness loop uses fixed 2h interval with NEXT_WAKE dynamic scheduling |
| `src/agents/system-prompt.ts` | Updated SOUL.md injection text — added identity continuity, 3 growth axes, Ship of Theseus protection | System prompt now accurately describes the custom SOUL.md template          |

### Upstream Sync Risk

- **`enforce-config.mjs`**: Fully custom file — no upstream conflict risk
- **`src/agents/system-prompt.ts`**: Custom modification — text-only change in `hasSoulFile` block, low conflict risk

---

## Human Voice System Restoration (2026-02-26)

**Purpose:** Restore three customizations lost during the v2026.2.23 upstream rebase merge.

### What Was Lost and Restored

| Item                                                                 | Root Cause                                      | Fix                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `hasHumanModeFiles` in `system-prompt.ts` detected `naturalvoice.md` | Old intermediate filename left behind by rebase | Updated to detect `howtobehuman.md` + `writelikeahuman.md`            |
| Voice injection text referenced `naturalvoice.md`                    | Same                                            | Updated to describe the two-file model                                |
| `resolveHumanModeEnabled()` missing from `workspace.ts`              | Rebase conflict resolution dropped the addition | Added (exported, reads `OPENCLAW_HUMAN_MODE=1`)                       |
| `removeHumanModeSectionFromSoul()` missing from `workspace.ts`       | Same                                            | Added (exported, strips `<!-- if-human-mode -->` blocks in `SOUL.md`) |

### Files Modified

| File                               | Change                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/agents/system-prompt.ts`      | `hasHumanModeFiles`: detect `howtobehuman.md`/`writelikeahuman.md`; updated injection text                  |
| `src/agents/workspace.ts`          | Added `resolveHumanModeEnabled()` + `removeHumanModeSectionFromSoul()`; wired into `ensureAgentWorkspace()` |
| `src/agents/system-prompt.test.ts` | Added 3 new tests for two-file detection (35/35 pass)                                                       |

### Upstream Sync Risk

**None.** All three changes are within MoltBot-only logic blocks. `workspace.ts` is noted in `OPENCLAW_CONTEXT.md` as a file requiring manual merge attention.

---

## Chromium Infobar Suppression (2026-02-25)

**Purpose:** Suppress the yellow "You are using an unsupported command-line flag: --disable-setuid-sandbox" Chromium infobar that appears in the noVNC browser when `--no-sandbox` is enabled. This is expected in Docker containers but visually distracting and irrelevant.

### Files Modified

| File                                    | Change                                                                      | Why                                                           |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `scripts/sandbox-browser-entrypoint.sh` | Added `--disable-infobars` to `CHROME_ARGS` in the `ALLOW_NO_SANDBOX` block | Suppresses all Chromium infobars in the container environment |
| `src/browser/chrome.ts`                 | Added `--disable-infobars` to args in the `noSandbox` block                 | Same treatment for local/host Chrome launches                 |

### Upstream Sync Risk

**None.** `sandbox-browser-entrypoint.sh` is fully custom. The `chrome.ts` change is a single `args.push()` line inside an existing MoltBot-only `noSandbox` block.

---

## noVNC No-Auth Mode (2026-02-25)

**Purpose:** Prevent the noVNC password dialog when accessing browser views from the dashboard. The host browser container generated a random VNC password on every startup that was never passed to the dashboard URL, causing a password prompt on every connection.

### Files Modified

| File                                        | Change                                                                                                  | Why                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `scripts/sandbox-browser-entrypoint.sh`     | Added `OPENCLAW_BROWSER_NOVNC_NO_AUTH` env var (default `0`). When `1`, x11vnc runs without `-rfbauth`. | Disables VNC-level password; external auth (Caddy gateway token) handles access control |
| `dashboard/.../hetzner-instance-service.ts` | Added `OPENCLAW_BROWSER_NOVNC_NO_AUTH=1` to main browser + per-agent browser docker-compose templates   | All deployed browser containers skip VNC password                                       |

### Security Model

Safe because: x11vnc binds to `-localhost` (Docker-internal only), Caddy gates `/browser/vnc.html` and `/browser/websockify` behind the gateway token, and no VNC port is exposed to the internet.

### Upstream Sync Risk

**None.** `sandbox-browser-entrypoint.sh` is fully custom (not in upstream). The env var defaults to `0`, so if the entrypoint is ever reset, existing behavior is preserved.

---

## Merge Artifact Cleanup (2026-02-25)

**Purpose:** Remove duplicate function/variable declarations left behind by the upstream rebase. These caused esbuild compilation failures in ~5 test files.

### Files Fixed

| File                                    | Duplicates Removed                                                                                                             | Lines Saved                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `src/security/audit-extra.sync.ts`      | 4 functions (`hasConfiguredDockerConfig`, `normalizeNodeCommand`, `listKnownNodeCommands`, `looksLikeNodeCommandPattern`)      | 55                         |
| `src/agents/workspace.ts`               | 2 variables (`workspaceTemplateCache`, `gitAvailabilityPromise`) + 1 function (`loadExtraBootstrapFiles`)                      | 70                         |
| `src/config/io.ts`                      | 3 functions (`resolveConfigAuditLogPath`, `resolveConfigWriteSuspiciousReasons`, `appendConfigWriteAuditRecord`)               | 49                         |
| `src/agents/models-config.providers.ts` | 1 function (`discoverVllmModels`)                                                                                              | 53                         |
| `src/agents/workspace.ts`               | Added missing `resolveHonchoEnabled()` + `stripHonchoConditionals()` (referenced but never defined after rebase) — now removed | +47 (added, later removed) |
| `src/agents/system-prompt.test.ts`      | Updated owner line format (`Owner numbers:` → `Authorized senders:`) + Skills section assertion                                | 3 lines changed            |

### Impact

- **~225 lines of dead duplicate code removed**
- **5 previously-broken test files now compile and pass** (audit, audit-extra.sync, dm-policy-shared, fix, system-prompt)
- **314/315 tests pass** (1 remaining failure is a pre-existing `trusted-proxy` auth guardrail test)

---

## Security & Observability Infrastructure (2026-02-25)

**Purpose:** Add four new security/observability modules and wire them into the agent pipeline: content scanning for external inputs, structured event logging, data classification for privacy controls, and system health checks.

### New Modules

| File                                  | Purpose                                                                                                                                                                                                    | Tests |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/security/content-scanner.ts`     | Two-stage content scanner (40+ regex patterns + optional frontier model). Detects prompt injection, SQL injection, role spoofing, data exfiltration, command injection. Risk scoring via `sqrt(sum) * 15`. | 48    |
| `src/logging/event-log.ts`            | Structured JSONL event logger with per-event files + unified stream. PII redaction, log rotation, queryable history.                                                                                       | 30    |
| `src/security/data-classification.ts` | Three-tier data classification (Confidential/Internal/Public) with context-aware gating and PII detection.                                                                                                 | 47    |
| `src/logging/diagnostics-toolkit.ts`  | System health checks: PID file, port reachability, error rate, disk space. Cron job debugging.                                                                                                             | 21    |
| `src/security/scan-and-log.ts`        | Shared `scanAndLog()` helper — DRY wrapper for scan + log + warn. Lazy singleton EventLogger.                                                                                                              | —     |

### Integration Points

| File                               | Integration                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `src/agents/tools/web-fetch.ts`    | Scanner on all fetched page content via `scanAndLog()`                           |
| `src/agents/tools/browser-tool.ts` | Scanner on browser snapshots, console output, tab data via `scanAndLog()`        |
| `src/cron/isolated-agent/run.ts`   | Scanner on external hook content + cron outcome event logging via `scanAndLog()` |
| `src/agents/system-prompt.ts`      | Data sharing policy injected per channel context type (DM/group/channel)         |
| `src/logging/diagnostic.ts`        | Periodic health check every ~5min via heartbeat counter                          |

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

| File                 | Change                                                        | Why                                                                     |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
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

| File                                           | Change                                                                  | Why                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/agents/workspace.ts`                      | Added `resolveHumanModeEnabled()` helper (Honcho helpers later removed) | Runtime checks for human mode                            |
| `src/agents/workspace.ts`                      | Added conditional markers for template processing                       | Workspace docs can include/exclude mode-specific content |
| `src/agents/workspace.ts`                      | Added `removeHumanModeSectionFromSoul()` and conditional stripping      | Processes template conditionals at bootstrap             |
| `src/commands/onboard-interactive.e2e.test.ts` | **NEW** — E2E test for onboarding flow                                  | Validates onboard command works end-to-end               |

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
