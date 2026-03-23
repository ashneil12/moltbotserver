---
name: cron-setup
description: |
  Set up, configure, and troubleshoot cron jobs for any agent. Covers custom job creation,
  delivery configuration (announce/webhook/none), workspace-scoped jobs, and common pitfalls.
  Use when adding custom scheduled tasks, fixing broken cron jobs, or debugging delivery failures.
  Also covers sub-agent default cron seeding prerequisites — read this before assuming cron-seed
  will work automatically.
---

# Cron Job Setup — Agent Guide

Use this skill when you need to create, modify, or troubleshoot cron jobs.

---

## Workflow

Determine what you need and read the relevant file:

### Creating Custom Jobs

Read `instructions/creating-jobs.md` for:

- **`add-cron.mjs` script** — preferred: validates inputs, prevents duplicates, auto-resolves delivery targets, supports dry-run
- Schedule formats (cron, every, at, milliseconds, one-shot)
- Delivery configuration: `none` (silent) vs `announce` to a channel
- Manual `cron` tool pattern (fallback for edge cases)
- Common operations: list, update, disable, delete

### Sub-Agent Default Cron Seeding

Read `instructions/sub-agent-seeding.md` for:

- The 5 prerequisites that must ALL be met (cron-seed silently skips agents missing any)
- What jobs get seeded and where they live
- Manual seeding script
- Understanding `cron.entries` vs disk-based `jobs.json`
- Verifying jobs are active

### Troubleshooting

Read `references/troubleshooting.md` for:

- "Sub-agent has no cron jobs / jobs never fire"
- "Job ran but no message was delivered"
- "Job isn't running"
- "File not found" errors in job output

### Job Templates

Read `references/job-templates.md` for copy-paste templates:

- Daily report (delivered to chat)
- Silent maintenance task
- One-shot follow-up ("Love Loop")

---

## Don'ts

- **Don't hand-craft cron JSON** — use `add-cron.mjs` instead (validates, deduplicates, previews).
- **Don't guess delivery IDs or formats** — use `--auto-to` (resolves exact ID from credentials).
- **Don't use usernames/handles as `to` values** — use `--auto-to`. Only use explicit numeric/internal IDs (e.g. Telegram: `5614099189`) if `--auto-to` fails.
- **Don't create cron jobs from within a cron job** unless it's a deliberate "love loop".
- **Don't duplicate seeded jobs** — run `--list` or `cron list` first.
- **Don't set `sessionTarget: "main"` with `agentTurn` payloads** — invalid combo.

---

## Related Skills

- **create-agent**: Full agent lifecycle (includes cron seeding as part of setup)
- **channel-team-setup**: Channel configuration for message delivery targets
