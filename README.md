# Optimized Claw

<p align="center">
    <img src="docs/assets/optimized-claw-banner.png" alt="Optimized Claw" width="800">
</p>

<p align="center">
  <strong>Production-hardened OpenClaw for multi-agent teams</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node ≥22">
  <a href="https://github.com/openclaw/openclaw"><img src="https://img.shields.io/badge/Fork%20of-OpenClaw-FF4500?style=for-the-badge" alt="Fork of OpenClaw"></a>
  <a href="https://openclawservers.com"><img src="https://img.shields.io/badge/OpenClaw-Servers-7C3AED?style=for-the-badge" alt="OpenClaw Servers"></a>
</p>

---

## What is Optimized Claw?

**Optimized Claw** is a production-hardened fork of [OpenClaw](https://github.com/openclaw/openclaw) — the open-source personal AI assistant. It tracks upstream closely but ships battle-tested fixes, multi-agent structure, security hardening, and infrastructure improvements needed to run OpenClaw reliably in production with multiple agents.

Everything from upstream works as-is. Optimized Claw adds the layer on top: per-agent browser containers, autonomous consciousness loops, content security, a deep memory stack, session health monitoring, Docker reliability fixes, and tooling that makes multi-agent deployments actually stable.

If you want a single-agent personal assistant, upstream OpenClaw is great. If you want to run a **team of agents** on a server, keeping them secure, self-aware, and structured for multi-agent operation — this fork is for you.

The public brand is **Optimized Claw**, but the runtime, CLI, package layout, and config paths stay `openclaw` for upstream compatibility.

---

## Best Fit

Optimized Claw is a better fit than stock upstream if you are:

- running multiple long-lived agents on one gateway
- deploying primarily with Docker or server-hosted infrastructure
- relying on per-agent browser isolation and scoped credentials
- wanting agents that autonomously self-improve, reflect, and maintain their own memory
- using upstream channels like Matrix/Element, Telegram, Discord, Slack, or WhatsApp but wanting a more production-oriented baseline
- keeping a fork in sync with upstream while preserving a known patch set

---

## What's Different from Upstream OpenClaw?

### 🔒 Security

| Feature                    | Description                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ACIP](ACIP_SECURITY.md)   | Advanced Cognitive Inoculation Prompt — baked into every agent. Defends against prompt injection, data exfiltration, and instruction manipulation across all external content and tool outputs |
| Content Scanner            | Automatic content scanning with risk scoring on all external inputs (browser, web-fetch, cron). Scans everything agents touch from the outside world                                           |
| Workspace Context Scanning | Bootstrap files (SOUL.md, IDENTITY.md, etc.) are scanned for prompt injection before entering the system prompt. Quarantined content is wrapped with ACIP boundary markers. Fail-open design   |
| Data Classification        | Three-tier classification (Confidential / Internal / Public) with PII detection                                                                                                                |
| Event Logger               | Structured JSONL event logging with PII redaction, log rotation, and queryable history                                                                                                         |

### 🤖 Multi-Agent Architecture

| Feature                          | Description                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured Agent Workspaces      | Each agent gets a purpose-built directory layout (`memory/`, `knowledge/`, `skills/`, `diary.md`, `open-loops.md`, `IDENTITY.md`, etc.) seeded automatically at creation — no manual setup required                                                                        |
| **Full Tool Profile by Default** | All agents default to `tools.profile = "full"` — no arbitrary tool restrictions. The previous `"coding"` profile silently blocked browser, canvas, nodes, and agents_list. This is enforced on every gateway restart, so stale narrow profiles are automatically corrected |
| Per-Agent Browser Containers     | Each agent gets a dedicated browser sandbox via Docker, not a shared browser                                                                                                                                                                                               |
| Per-Agent OAuth                  | Removed credential inheritance — agents use only their own OAuth tokens                                                                                                                                                                                                    |
| Autonomous Self-Improvement      | Each agent runs its own consciousness loop, self-review, deep review, and nightly innovation — standalone by default, not relying on external orchestration                                                                                                                |
| Pre-Seeded Cron Jobs             | 12+ default cron jobs (reflection, maintenance, briefings, innovation, audits, memory extraction, skill evolution) automatically seeded per agent with `MAIN_ONLY_JOBS` filtering for sub-agents                                                                           |
| Browser-Only Sandbox Mode        | `browser-only` sandbox mode for agents that need browser access without full containers                                                                                                                                                                                    |
| Agent Browser Routing            | `createBrowserTool()` passes `agentId` so agents route to their own containers                                                                                                                                                                                             |
| Per-Agent CLI Onboarding         | `--agent` and `--sync-all` flags for scoped credential setup                                                                                                                                                                                                               |
| Self-Delegation Guidance         | Agents taught when and how to break their own work into focused subtasks via `sessions_spawn`, keeping context clean across independent workstreams                                                                                                                        |

### 🧠 Consciousness & Memory

This fork has a significantly deeper memory stack than upstream. Rather than treating each session as isolated, agents carry context forward across resets — and actively reflect on their own behavior.

**How context carryover works:**

1. When a session resets, `session-context-summary.ts` runs trajectory compression: the first/last turns of the conversation are preserved verbatim, and the middle is compressed into key decisions, tool usage, and user intents. This gets written to `memory/session-context.md` and is loaded automatically on the next session boot.
2. Every session is indexed into an FTS5 SQLite database (`memory/sessions.db`) so the `session_search` tool can do fast keyword lookup across all past conversations — complementing the embedding-based `memory_search`.
3. The 3-tier reflection system runs entirely autonomously: self-review (06:00 + 18:00 UTC), consciousness loop (every 12h), and deep review (every 2 days at 04:00 UTC). These are not just prompts — they write structured entries to `memory/self-review.md`, `diary.md`, and the improvement backlog, which feed back into future heartbeats.

The result: agents remember what they did, learn from their patterns, and carry their state forward even after compactions.

| Feature                       | Description                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3-Tier Reflection System      | Self-review (2× daily), consciousness loop (12h), deep-review (every 2 days) — runs autonomously per agent on fixed cron schedules                                                                                                                                                                                                                       |
| Lossless Claw (LCM)           | [DAG-based conversation memory](https://github.com/martian-engineering/lossless-claw) pre-baked into Docker image. Replaces default sliding-window compaction with SQLite-backed persistent summarization. Sessions never reset (3-year idle timeout)                                                                                                    |
| Pre-Reset Memory Flush        | Deterministic memory flush before session reset — ensures no context is lost between compactions                                                                                                                                                                                                                                                         |
| Trajectory Compression        | Smarter session context carryover — preserves first/last turns verbatim, compresses middle via key decisions, tool usage, and user intents                                                                                                                                                                                                               |
| Session Search                | FTS5-powered keyword search across past conversations with [OpenViking](https://github.com/volcengine/OpenViking)-inspired hotness scoring (access count + recency decay) and mechanical query rewriting (OR-expansion)                                                                                                                                  |
| Session Context Carryover     | Rolling `memory/session-context.md` persists context across session resets                                                                                                                                                                                                                                                                               |
| BrainX Memory Enrichment      | Cron-based [fact extraction](https://github.com/Mdx2025/-BrainX-The-First-Brain-for-OpenClaw) from session transcripts (URLs, repos, env vars, services) + advisory warning detection (deploy failures, dangerous commands, auth errors) — writes to `memory/extracted-facts.md` and `memory/advisory-warnings.md`, auto-injected into bootstrap context |
| Memory Extraction             | [OpenViking](https://github.com/volcengine/OpenViking)-inspired LLM-powered semantic fact extraction — 5 categories (`[preference]`, `[fact]`, `[entity]`, `[decision]`, `[open]`) with deduplication against existing memory                                                                                                                            |
| Tool Usage Statistics         | [OpenViking](https://github.com/volcengine/OpenViking)-inspired per-tool usage tracking — call counts, success/failure rates, durations. Stored in shared `sessions.db`                                                                                                                                                                                  |
| QMD Always-On                 | When `OPENCLAW_QMD_ENABLED=true`, QMD is enforced as the primary memory backend with 5-minute update intervals, boot-time sync, and hybrid vector+text search. No manual config required                                                                                                                                                                 |
| Skill Auto-Creation           | Agents create and manage their own skill documents autonomously in `workspace/skills/`                                                                                                                                                                                                                                                                   |
| Skill Evolution               | Weekly cron generates `SKILL.md` files from recurring failure patterns — inspired by [MetaClaw](https://github.com/aiming-lab/MetaClaw). Reviews self-review MISS logs, distinguishes behavioral rules from procedural skills, auto-discovers from 3+ occurrences                                                                                        |
| Progressive Disclosure Skills | Token-efficient skill indexing — compact one-line-per-skill index in system prompt, full SKILL.md loaded on demand via `skill_view` tool. Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent). ~50-60% token savings                                                                                                                |
| Knowledge Base Indexer        | Auto-scans `memory/knowledge/*.md` and builds a queryable `_index.md`                                                                                                                                                                                                                                                                                    |
| Improvement Backlog           | Structured backlog system for self-generated improvement proposals with tiered triage (auto-implement / build-then-approve / propose-only)                                                                                                                                                                                                               |
| Nightly Innovation            | 5-phase autonomous building cron (2 AM) with backlog integration — agents build improvements overnight                                                                                                                                                                                                                                                   |
| Morning Briefing              | Personalized daily summary (8 AM) with backlog surfacing, correction-awareness, and Standing Corrections from `MEMORY.md`                                                                                                                                                                                                                                |
| Weekly Self-Audit             | 21-question strategic audit feeding the improvement backlog                                                                                                                                                                                                                                                                                              |
| Diary Archival & Continuity   | Automatic diary rotation with continuity summaries across archive boundaries                                                                                                                                                                                                                                                                             |
| Auto-Tidy                     | Scheduled workspace cleanup — prunes stale entries from MEMORY.md, open-loops, self-review, session-context, backlog, and BrainX files                                                                                                                                                                                                                   |

### 🛡️ Stability & Resilience

| Feature                          | Description                                                                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session Health Sentinel          | [Autoresearch](https://github.com/karpathy/autoresearch)-inspired circuit breaker detecting cascading failures. Pure-function state management, degradation detection, and recovery hint injection. Wired into agent-runner at success/error/exception boundaries                        |
| Crash Taxonomy                   | Every failover error is classified as `retry`, `adapt`, or `abandon` via `resolveFixability()`. Backward-compatible with existing `FailoverError` handling                                                                                                                               |
| Post-Promotion Evidence Counters | [ACE Platform](https://github.com/DannyMac180/ace-platform)-inspired `[0H/0M]` hit/miss counters on promoted CRITICAL rules. Fully deterministic (prefix stemming, zero LLM calls). Rules where M ≥ H after 3+ observations are flagged for review                                       |
| Identity Change-Log              | JSONL append log at `memory/reflection-change-log.jsonl` — tracks every identity file modification with timestamp, job ID, lines changed, promotions count. Auto-pruned at 200 entries                                                                                                   |
| Stale Snapshot Prevention        | Three guards against ephemeral/stale data: (1) ephemeral path detection for `/tmp` and `tmpfs` mounts, (2) workspace freshness validation with auto-refresh, (3) session store `createdAt` tracking for deduplication — credit: [Brad Mills (@bradmillscan)](https://x.com/bradmillscan) |
| Autonomous Problem-Solving       | Agents exhaust all alternative approaches before escalating. Layered at 4 levels: system prompt procedure, SOUL.md philosophy, IDENTITY.md behavior, OPERATIONS.md drift detection                                                                                                       |
| Cron Schedule Redesign           | All cron jobs converted from unpredictable interval-based (`anchorMs: nowMs`) to fixed [croner](https://github.com/hexagon/croner) expressions or staggered anchors — eliminates the 10-job startup burst on boot                                                                        |

### 💾 Backup & Restore

A full lifecycle backup system runs on a configurable schedule (default: every 12 hours):

1. **Create** — `openclaw backup create` produces a verified `.tar.gz` archive containing config, state, credentials, and workspace
2. **Verify** — archive integrity is checked before upload. If corrupt, the cycle retries (up to 3 attempts) before alerting
3. **Upload** — verified archive is stored in Supabase Storage (`openclaw-backups` bucket) with a 7-day expiry
4. **Local copy** — a local copy is saved to `~/.clawdbot/local-backups/` (configurable via `MOLTBOT_LOCAL_BACKUP_DIR`), retained for 14 days
5. **Alert on failure** — if all attempts fail, the dashboard is notified via the `/alert` endpoint

Restores are one-click from the dashboard, or import any `.tar.gz` from a community self-hosted instance to migrate to managed hosting. Cross-fork migration is supported — restored configs are validated and normalized before the gateway starts (JSON validation, `RESTORE_KEY` sanitization for path traversal/injection prevention).

### 🐳 Docker & Deployment

| Feature                   | Description                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LCM Pre-Baked             | [Lossless Claw](https://github.com/martian-engineering/lossless-claw) plugin pre-installed in Docker image — no runtime `npm install` needed. Subshell fallback for build resilience |
| CDP Host Header Fix       | `http.request()` workaround for Node.js `fetch()` silently dropping `Host` headers — without this, Docker hostnames fail                                                             |
| Browser Startup Sweep     | Auto-updates stale browser containers on gateway boot                                                                                                                                |
| Pre-Installed CLI Tooling | `ffmpeg`, `imagemagick`, `pandoc`, `yt-dlp`, `sqlite3`, `ripgrep`, and 15+ more tools baked into Docker image                                                                        |
| Diagnostics Toolkit       | System health checks: PID file, port reachability, error rate, disk space                                                                                                            |
| Document Converter        | Background sidecar converting `.pdf`, `.docx`, `.csv`, `.odt`, `.rtf`, `.epub` to markdown in agent workspaces                                                                       |

### 🌐 Browser Control

| Feature                                                       | Description                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Camofox](https://github.com/nicedaycode/camofox) Integration | Browser camouflage baked into container images — realistic fingerprint spoofing for anti-detection         |
| Playwright Anti-Detection                                     | 8 evasion scripts covering `navigator.webdriver`, plugins, WebGL, `chrome.runtime`, iframe leaks, and more |
| Parallel Profile Listing                                      | `Promise.all` replaces serial `for` loop — prevents timeout cascades with multiple remote profiles         |
| Auto-Download Capture                                         | Browser downloads automatically route to per-agent workspace directories                                   |
| Profile Timeout Tuning                                        | Bumped from 3s to 5s for reliability with 5+ remote profiles                                               |
| Sandbox Browser API                                           | HTTP/WebSocket proxy with noVNC for browser container access                                               |

### ⚡ Performance & Reliability

| Feature                    | Description                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared File Utilities      | Crash-safe `atomicWriteFile()`, `readTextFileIfExists()`, `writeTextFileIfChanged()` extracted to shared `atomic-file.ts` — eliminates ~85 lines of duplicated patterns across 5 files |
| Telegram Media Timeout     | 15s timeout on media downloads prevents hung downloads from blocking groups                                                                                                            |
| Typing TTL Callback        | "⏳ Still thinking" feedback when LLM runs exceed the typing indicator TTL                                                                                                             |
| Heartbeat Tuning           | Default interval changed from 30m to 1h to reduce unnecessary wakeups                                                                                                                  |
| Exec Approval UX           | Long commands (e.g. multi-line heredocs) are height-capped and scrollable in the approval modal — buttons are always reachable within the timeout window                               |
| Shell Injection Prevention | `enforceLCM()` uses `cpSync` + path validation instead of `execSync` with shell commands                                                                                               |

### 🛠️ Agent Identity & Tooling

| Feature                    | Description                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SOUL.md                    | Actionable identity framework — 3-tier reflection, **Bias for Action** philosophy (act first, report results, confirm only for irreversible actions), Ship of Theseus protection |
| IDENTITY.md                | Per-agent identity document — relationship model, personality traits, communication preferences, CRITICAL rules promoted from self-review patterns with evidence counters        |
| System Prompt Enhancements | Architect-first thinking, stale identity nudges (72h mtime check), comprehensive tool guidance, human voice detection, autonomous problem-solving procedure                      |
| SQL Tools                  | `sql_query` (read-only memory index) + `sql_execute` (read-write workspace databases)                                                                                            |
| Session Search Tool        | Agent-facing FTS5 search across past conversations with query rewriting and hotness scoring                                                                                      |
| Skill Management Tool      | Autonomous skill CRUD with safety boundaries and human-authored protection                                                                                                       |
| Skill View Tool            | Progressive disclosure — loads full SKILL.md content on demand by name. Path traversal prevention, 200K char truncation                                                          |
| Workspace Search Tool      | `workspace_search` — searches only workspace-kind QMD collections, distinct from personal `memory_search` (QMD required)                                                         |

> [!IMPORTANT]
> **Migrating from another setup? Read this before copying identity files.**
>
> In this fork, **`SOUL.md` is intentionally left unchanged** across all agents — it acts as a shared constitutional framework (reflection tiers, core principles, identity continuity protections) and is not the place for personalisation. **Do not customise it per-agent.**
>
> **`IDENTITY.md` is where the agent's actual personal identity lives** — their name, personality, relationship model, communication style, and self-defined rules. If you're transferring an agent from another OpenClaw setup, port their identity into `IDENTITY.md`, not `SOUL.md`.

---

### 🧰 Pre-Installed Team Skills

This fork ships a set of **team-level skills** available to all agents out of the box. These are seeded into each agent's workspace at creation and cover the most common operational tasks for a multi-agent team. More will be added over time.

| Skill                | Description                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-agent`       | Full lifecycle setup for a new team member — identity, workspace, channels (Telegram/Discord), browser container, cron jobs, and memory seeding. Use this when adding a new agent, not just a new channel                                               |
| `channel-team-setup` | Configure multi-agent messaging across Telegram and Discord. Covers `openclaw.json` bindings, `groupPolicy`, `requireMention`, sandbox settings, agent-to-agent communication, and platform quirks (Telegram privacy mode, Discord bot intents, etc.)   |
| `cron-setup`         | Create, configure, and troubleshoot custom cron jobs for any agent. Covers job templates, delivery targets, schedule types, and common failure modes. Does **not** cover the standard seeded job set — that's handled by `enforce-config.mjs cron-seed` |
| `review-pr`          | Read-only GitHub PR analysis using the `gh` CLI — structured feedback and readiness assessment. Does not merge or push                                                                                                                                  |
| `prepare-pr`         | Rebase a PR branch onto main, fix review findings, run gates, and push to the PR head branch. Use after review, never merges directly                                                                                                                   |
| `merge-pr`           | Squash-merge a reviewed and prepared PR via the `gh` CLI. Cleans up worktrees after success                                                                                                                                                             |

---

## Deployment Paths

Optimized Claw supports the same runtime surfaces as upstream OpenClaw, but the recommended fork install paths are:

- **Git checkout** for direct control and easy upstream syncs
- **GHCR images** for Docker deployments

If your deployment tooling pulls container images directly, point it at:

- `ghcr.io/ashneil12/optimized-claw:main`
- `ghcr.io/ashneil12/optimized-claw-browser:main`

If your workflow depends on Matrix/Element or other upstream channels, the existing upstream channel docs and setup flow still apply unless this fork explicitly documents an override.

---

## Fresh Install

> [!CAUTION]
> **Do NOT use the official `openclawai/openclaw` image or the upstream installer** for any step below. The official image does not include any of the patches in this fork. Using it — even once, even just to bootstrap — will give you an unconfigured baseline missing multi-agent support, browser wiring, the full-tool-profile enforcement, and the entire memory stack. Use only the images and installer URLs shown below.

### Self-Hosted: macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/ashneil12/optimized-claw/main/scripts/install.sh | bash
```

This installer now defaults to a **git checkout of this fork**, not a package-manager install.

### Self-Hosted: Windows

```powershell
iwr -useb https://raw.githubusercontent.com/ashneil12/optimized-claw/main/scripts/install.ps1 | iex
```

### Manual Source Install

Runtime: **Node ≥22**.

```bash
git clone https://github.com/ashneil12/optimized-claw.git
cd optimized-claw

pnpm install
pnpm build

pnpm openclaw onboard --install-daemon
pnpm openclaw gateway --port 18789 --verbose
```

Install note: the public brand is **Optimized Claw**, but the command stays `openclaw`. For this fork, prefer **git** or **Docker** installs. A plain `npm install -g openclaw` targets the upstream package unless you publish a separate forked npm package.

### Docker

```bash
docker compose up -d
```

Published images:

- `ghcr.io/ashneil12/optimized-claw:main`
- `ghcr.io/ashneil12/optimized-claw-browser:main`

### Browser Containers (Self-Hosted)

Per-agent browser containers are one of the core design principles of this fork — **every agent gets their own isolated browser**, not a shared one. This is **opt-in and requires explicit setup**. The main server container does not spin up browser containers automatically.

**How it works:**

1. The `optimized-claw-browser` image runs Playwright/Chrome with a CDP endpoint exposed on port `9222`
2. On every gateway restart, `enforce-config.mjs` auto-creates browser profiles in `openclaw.json` pointing each agent to their own `browser-<agentId>:9222` container — no manual config editing needed
3. You control scaling: one shared container works for small teams; for full isolation, run one browser container per agent (the `create-agent` skill handles this automatically)

**To enable browsers**, set the following environment variable in your `docker-compose.yml` or `.env`:

```env
OPENCLAW_BROWSER_ENABLED=1
```

Then add a browser service for each agent. Paste this prompt into any AI coding agent (Antigravity, Claude Code, Cursor, etc.) to wire it up:

```
I'm self-hosting Optimized Claw. My project has a docker-compose.yml.
Please:
1. Add a `browser` service using the image ghcr.io/ashneil12/optimized-claw-browser:main
   with the correct ports (9222 for CDP) and a named volume for browser data
2. Add OPENCLAW_BROWSER_ENABLED=1 and BROWSER_ENDPOINT_URL=http://browser:9222
   to the main server service's environment
3. Add `depends_on: [browser]` to the main server service so the browser
   starts first
4. Update .env.example with the new vars and comments explaining them
```

> [!NOTE]
> When you add a new agent via the `create-agent` skill, a dedicated `browser-<agentId>` container is provisioned automatically on the next gateway restart — no manual steps. The browser tool is routed to that agent's container, not a shared one.

---

## Upgrading from an Existing OpenClaw Setup

If your current OpenClaw setup is already stable and doing everything you need, you probably **do not** need to move.

Switch to Optimized Claw if you specifically want the fork-only behavior: multi-agent structure, browser-container hardening, consciousness loops, LCM session memory, or the other production patches listed above.

### Existing Source Checkout

Safest path:

1. Back up `~/.openclaw`
2. Stop the currently running gateway/service
3. Clone this fork into a new directory
4. Build it and run onboarding/install-daemon from the new checkout
5. Run `openclaw doctor`
6. Restart the gateway from the new install

The runtime and config paths stay `openclaw` / `~/.openclaw`, so your existing configuration can carry over. That also means you should keep a backup before switching.

### Existing Docker Deployment

> [!WARNING]
> **Do not pull the official `openclawai/openclaw` image to update.** That is the upstream image — it does not include any of the patches in this fork. Pulling it will silently revert your full-profile enforcement, browser tool wiring, memory stack, and every other customisation described in this README.

Update your image references to this fork's images:

- `ghcr.io/ashneil12/optimized-claw:main`
- `ghcr.io/ashneil12/optimized-claw-browser:main`

Then pull and restart:

```bash
docker compose pull
docker compose up -d
```

### Existing npm Install

There is no direct fork-owned npm upgrade path yet. If you installed with `npm install -g openclaw`, you are still on the official package stream.

To move to this fork, reinstall via:

- the git-based installer above
- a manual source checkout
- Docker / GHCR images

---

## Keeping Optimized Claw Up to Date

> [!CAUTION]
> **Do NOT update through the official OpenClaw update mechanism (`openclaw update`, `npm update openclaw`, or pulling the upstream Docker image).** Because the source code in this fork has diverged significantly from upstream — different `enforce-config.mjs`, patched Docker entrypoint, custom tool wiring, modified CDP helpers, and more — running an upstream update will revert most of those changes. You will likely end up with broken browser containers, agents locked to a narrow tool profile, missing backup scripts, and a non-functional memory stack. It is not a simple undo.

### The Correct Update Path

When upstream OpenClaw releases a new version:

1. **Wait** — Optimized Claw typically updates within **24–48 hours** of each upstream release. The update is tested to ensure all the fork-specific features continue to work before it's published.
2. **Pull this fork's images** (Docker) or merge from this fork's `main` branch (source checkout). Do **not** merge directly from `openclaw/openclaw` unless you know what you're doing and have read `OPENCLAW_CONTEXT.md` front to back.
3. **Verify the patches survived** using the commands below.

If you use Docker (the recommended path), updating is just:

```bash
docker compose pull
docker compose up -d
```

The fork image already has everything tested and rebased.

### If You Have Your Own Local Changes

If you've made additional modifications on top of Optimized Claw, make sure they're documented **before** you pull any update:

- Write down which files you changed and why — even a quick comment at the top of the file is enough
- Check `OPENCLAW_CONTEXT.md` to see if your change touches a file that's already patched; if so, note what you added so you can re-apply it after updating
- Consider keeping a `LOCAL_CHANGES.md` in your checkout as a personal diff log

Updates that aren't documented are almost always lost. A 3-line note written before updating saves hours of debugging after.

### Upstream Sync Reference (for fork maintainers)

Optimized Claw tracks `openclaw/openclaw` main branch. Custom patches are documented in:

- **[LOCAL_PATCHES.md](LOCAL_PATCHES.md)** — Critical patches with per-file verification commands
- **[OPENCLAW_CONTEXT.md](OPENCLAW_CONTEXT.md)** — Complete modification inventory with post-sync checklist
- **[OPENCLAW_CHANGELOG.md](OPENCLAW_CHANGELOG.md)** — Full history of every custom change with rationale

After every upstream sync, verify all patches survived:

```bash
grep -c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts  # expect ≥ 1
grep -c 'Promise.all' src/browser/server-context.ts               # expect ≥ 1
grep -c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts  # expect ≥ 1
grep -c 'tools.profile = "full"' enforce-config.mjs              # expect ≥ 1
```

---

## Configuration

Optimized Claw uses the same configuration as upstream OpenClaw. See:

- [Full configuration reference](https://docs.openclaw.ai/gateway/configuration)
- [Getting started guide](https://docs.openclaw.ai/start/getting-started)
- [Channel setup](https://docs.openclaw.ai/channels)

Fork-specific additions are documented in `OPENCLAW_CONTEXT.md`.

### Fork-Specific Environment Variables

These environment variables control features unique to Optimized Claw. Set them in your `docker-compose.yml` or shell environment:

| Variable                         | Default                     | Description                                                                                                                                                                            |
| -------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCLAW_QMD_ENABLED`           | `0`                         | Enable QMD as the primary memory backend (enforced on every restart). When enabled, sets hybrid vector+text search, 5m update intervals, and boot-time sync                            |
| `OPENCLAW_BUSINESS_MODE_ENABLED` | `0`                         | Enable Business Mode — transforms the agent into a strategic business partner with a 22KB guide and 64 knowledge documents across strategy, content, copywriting, operations, and more |
| `OPENCLAW_HUMAN_MODE_ENABLED`    | `0`                         | Enable human voice mode — makes agent communication more natural and conversational                                                                                                    |
| `OPENCLAW_BROWSER_ENABLED`       | `0`                         | Enable per-agent browser containers. When set, `browser` is added to every agent's effective tool allowlist regardless of profile                                                      |
| `MOLTBOT_BACKUP_ENABLED`         | —                           | Set to `true` to enable scheduled automatic backups. Requires `MOLTBOT_SUPABASE_URL`, `MOLTBOT_SUPABASE_SERVICE_ROLE_KEY`, and `MOLTBOT_INSTANCE_ID`                                   |
| `MOLTBOT_LOCAL_BACKUP_DIR`       | `~/.clawdbot/local-backups` | Local directory for 14-day backup retention alongside cloud copies                                                                                                                     |
| `LCM_FRESH_TAIL_COUNT`           | `20`                        | Messages to keep unsummarized in LCM context assembly                                                                                                                                  |
| `LCM_CONTEXT_THRESHOLD`          | —                           | Token threshold to trigger LCM summarization                                                                                                                                           |
| `LCM_SUMMARY_PROVIDER`           | —                           | Provider for LCM summarization model (e.g. `google`)                                                                                                                                   |
| `LCM_SUMMARY_MODEL`              | —                           | Model for LCM summarization (e.g. `gemini-2.5-flash-lite-preview-06-17`)                                                                                                               |

---

## Credits & Attribution

Optimized Claw is built on top of [OpenClaw](https://github.com/openclaw/openclaw) by Peter Steinberger and the OpenClaw community. All upstream contributors are recognized.

This fork incorporates ideas, techniques, and patterns from across the AI agent community. Key inspirations include:

- **[Lossless Claw](https://github.com/martian-engineering/lossless-claw)** by [Martian Engineering](https://github.com/martian-engineering) — DAG-based conversation memory engine
- **[BrainX](https://github.com/Mdx2025/-BrainX-The-First-Brain-for-OpenClaw)** — fact extraction and advisory warning patterns
- **[OpenViking](https://github.com/volcengine/OpenViking)** by Volcengine — hotness scoring, query rewriting, per-tool statistics, automatic memory extraction
- **[karpathy/autoresearch](https://github.com/karpathy/autoresearch)** by [Andrej Karpathy](https://github.com/karpathy) — session health sentinel circuit-breaker pattern and structured learning log
- **[ACE Platform](https://github.com/DannyMac180/ace-platform)** by [Danny McAteer](https://github.com/DannyMac180) — post-promotion evidence counters and structured outcome logging
- **[MetaClaw](https://github.com/aiming-lab/MetaClaw)** — failure-driven skill evolution via structured reflection
- **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** by NousResearch — progressive disclosure architecture for token-efficient skill indexing
- **[Brad Mills (@bradmillscan)](https://x.com/bradmillscan)** — stale snapshot prevention analysis and ephemeral path failure modes
- **[Camofox](https://github.com/nicedaycode/camofox)** — browser fingerprint camouflage

Many other improvements were drawn from ideas shared on Twitter/X, GitHub, Discord servers, and elsewhere. I didn't always keep track of the original sources while iterating quickly, so not everything has a traceable attribution link.

**If you recognize a pattern, technique, or feature in this fork that originated in your repo or your work, please reach out.** I'm happy to add proper credit and a link. Email [info@openclawservers.com](mailto:info@openclawservers.com) and I'll get it sorted.

- [OpenClaw](https://github.com/openclaw/openclaw) — upstream project
- [OpenClaw Docs](https://docs.openclaw.ai) — documentation (applies to this fork)
- [OpenClaw Servers](https://openclawservers.com) — managed hosting

## License

[MIT](LICENSE) — same as upstream OpenClaw.
