# 🦞 MoltBot Server — SaaS-Hardened OpenClaw Fork

> **Upstream**: [openclaw/openclaw](https://github.com/openclaw/openclaw) · **This fork**: [ashneil12/moltbotserver](https://github.com/ashneil12/moltbotserver)

**MoltBot Server** is a production-hardened fork of [OpenClaw](https://github.com/openclaw/openclaw), the open-source personal AI assistant platform. While OpenClaw is designed as a self-hosted, single-user assistant you run on your own devices, MoltBot Server re-packages it as a **managed, multi-tenant SaaS backend** — deployed as Docker containers behind a dashboard that handles provisioning, billing, and lifecycle management.

We track upstream closely (merging regularly) and push all changes on top, never modifying upstream files in-place when possible.

---

## What Changed vs. Upstream OpenClaw

### 🔒 Security Hardening

| Layer                                            | What we added                                                                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ACIP (Advanced Cognitive Inoculation Prompt)** | A bundled prompt-injection defense framework (`ACIP_SECURITY.md`) that protects against direct/indirect injection, data exfiltration, and policy bypass. Loaded on-demand for external-facing tasks.                                      |
| **SOUL.md extensions**                           | Extended the upstream `SOUL.md` with MoltBot-specific operational rules: secrets management, content quarantine, destructive-action circuit breakers, privacy enforcement, root access safety, and security escalation protocols for sub-agents. |
| **Read-only prompt hardening**                   | `SOUL.md` and `ACIP_SECURITY.md` are deployed as `chmod 444` (read-only) in the agent workspace so the AI cannot modify its own security rules.                                                                                           |
| **mDNS/Bonjour disabled**                        | `OPENCLAW_DISABLE_BONJOUR=1` — prevents information disclosure on shared networks.                                                                                                                                                        |
| **Device auth disabled**                         | SaaS mode uses token-only authentication; Control UI device pairing is disabled.                                                                                                                                                          |

### 🐳 Docker & Entrypoint (`docker-entrypoint.sh`)

The entire entrypoint is a MoltBot addition. Upstream OpenClaw has no Docker entrypoint — it's designed to run via the CLI. Our entrypoint:

- **Auto-generates `openclaw.json`** from environment variables (gateway token, port, bind address, trusted proxies, models, memory backend).
- **Auto-onboards** new instances non-interactively (`openclaw onboard --non-interactive`) when `OPENCLAW_AUTO_ONBOARD=true`.
- **Model routing** — injects model names into SOUL.md template placeholders (`{{PRIMARY_MODEL}}`, `{{CODING_MODEL}}`, etc.) at container startup.
- **Credential safety** — enforces `chmod 700` on config directory, `chmod 600` on config file. API keys are never logged.
- **AI Gateway (credits mode)** — configures `vercel-ai-gateway` provider when `OPENCLAW_AI_GATEWAY_URL` is set, routing all model calls through the dashboard's billing proxy.
- **Config re-enforcement** — re-applies gateway token, trusted proxies, and model settings on every boot (guards against onboard overwriting them).
- **`openclaw doctor --fix`** runs automatically before gateway start.

### 🧠 Agent Intelligence Layer

| Feature                   | Description                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human Mode**            | Humanization system with comprehensive guide (`writelikeahuman.md`) loaded into agent context by default. Teaches natural communication, AI-tell avoidance, tone matching, and authentic voice development. Toggled via `OPENCLAW_HUMAN_MODE_ENABLED` env var. |
| **IDENTITY.md**           | Writable self-evolution file — the agent updates it as it learns user preferences, promoted patterns from self-review, and critical rules. Deployed once, never overwritten.                                                                                                           |
| **WORKING.md**            | Short-term working memory — current task state persisted across compactions.                                                                                                                                                                                                           |
| **HEARTBEAT.md**          | Configurable heartbeat checklist — the agent runs periodic self-checks, system update evaluation, and self-review.                                                                                                                                                                     |
| **Memory infrastructure** | `memory/` directory with `self-review.md` (MISS/HIT logging), `open-loops.md` (pending follow-ups), `diary.md` (reflective entries), and `identity-scratchpad.md`.                                                                                                                     |
| **QMD memory search**     | Configured as default memory backend — hybrid BM25 + vector search with LLM re-ranking.                                                                                                                                                                                                |
| **OTA update protocol**   | Signal-file based update flow (`.update-available` → `.update-ready` → `.update-applied`) — the AI decides when to apply updates based on activity.                                                                                                                                    |

### 🎛️ Dashboard Integration

MoltBot Server is designed to be provisioned and managed by the [MoltBot Dashboard](https://github.com/ashneil12/moltbot-dashboard) (separate repo):

- **Environment-driven configuration** — all settings flow from dashboard → env vars → entrypoint → `openclaw.json`. No manual config editing.
- **Model presets & routing** — dashboard provides preset profiles (cost-saving, balanced, power) and sets `OPENCLAW_CODING_MODEL`, `OPENCLAW_WRITING_MODEL`, `OPENCLAW_SEARCH_MODEL`, `OPENCLAW_IMAGE_MODEL` independently.
- **Brave Search integration** — optional `BRAVE_API_KEY` injected into the instance for web search capabilities.
- **Residential proxy / Camoufox** — optional proxy and anti-detection browser settings for enhanced web browsing.
- **Concurrency controls** — `OPENCLAW_MAX_CONCURRENT` and `OPENCLAW_SUBAGENT_MAX_CONCURRENT` for per-instance tuning.
- **Human mode toggle** — `OPENCLAW_HUMAN_MODE_ENABLED` controls whether humanization guides are loaded into agent context.
- **Human delay** — configurable natural response timing for messaging channels.

### 📦 Build & CI

- **`Dockerfile`** — custom multi-stage build producing a production image with `SOUL.md`, `ACIP_SECURITY.md`, `IDENTITY.md`, `WORKING.md`, `HEARTBEAT.md`, and memory templates baked in.
- **`Dockerfile.sandbox` / `Dockerfile.sandbox-browser`** — sandbox containers for isolated agent tool execution.
- **GitHub Actions** — `docker-build.yml` pushes images to GHCR on every push to `fresh-deploy`.

---

## What We Did NOT Change

Everything else is upstream OpenClaw. The gateway runtime, channel integrations (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, etc.), agent loop, session model, tools, browser control, Canvas/A2UI, CLI, companion apps, skills platform — all upstream, all working as documented at [docs.openclaw.ai](https://docs.openclaw.ai).

We benefit from upstream's active development (15k+ stars, 200+ contributors) and merge regularly to stay current.

---

## Staying in Sync

```bash
# Add upstream (one-time)
git remote add upstream https://github.com/openclaw/openclaw.git

# Fetch + merge
git fetch upstream
git merge upstream/main

# Our changes live on top — conflicts are rare since we mostly add new files
```

See [`.agent/workflows/sync-upstream.md`](.agent/workflows/sync-upstream.md) for the full sync workflow.

---

## Quick Start (for MoltBot deployments)

MoltBot Server is not designed to be run standalone — it's deployed by the dashboard. But for local development:

```bash
# Clone
git clone https://github.com/ashneil12/moltbotserver.git
cd moltbotserver

# Install + build
pnpm install
pnpm ui:build
pnpm build

# Run with required env vars
OPENCLAW_GATEWAY_TOKEN=dev-token \
OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-20250514 \
OPENCLAW_AUTO_ONBOARD=true \
  node dist/openclaw.mjs gateway --port 18789
```

Or via Docker:

```bash
docker build -t moltbotserver .
docker run -e OPENCLAW_GATEWAY_TOKEN=dev-token \
           -e OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-20250514 \
           -e OPENCLAW_AUTO_ONBOARD=true \
           -p 18789:18789 \
           moltbotserver
```

---

## File Map (MoltBot additions)

| File                                          | Purpose                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `ACIP_SECURITY.md`                            | Prompt injection defense framework (ACIP v1.3)                                    |
| `SOUL.md`                                     | Extended with MoltBot security rules, delegation, memory, Human Mode, OTA updates |
| `IDENTITY.md`                                 | Writable agent identity template                                                  |
| `WORKING.md`                                  | Short-term task memory template                                                   |
| `HEARTBEAT.md`                                | Periodic self-check checklist                                                     |
| `docs/reference/templates/writelikeahuman.md` | Humanization guide — natural communication, AI-tell avoidance, authentic voice     |
| `docker-entrypoint.sh`                        | SaaS entrypoint — config generation, auto-onboard, security hardening             |
| `Dockerfile`                                  | Production image build                                                            |
| `Dockerfile.sandbox`                          | Sandbox container for agent tools                                                 |
| `Dockerfile.sandbox-browser`                  | Browser sandbox container                                                         |
| `.github/workflows/docker-build.yml`          | CI — build and push to GHCR                                                       |

---

## Upstream

This project is a fork of **[OpenClaw](https://github.com/openclaw/openclaw)** by Peter Steinberger and the community. OpenClaw is MIT-licensed and we gratefully build on their work.

- [OpenClaw Website](https://openclaw.ai)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [OpenClaw Discord](https://discord.gg/clawd)

---

## License

[MIT](LICENSE) — same as upstream.
