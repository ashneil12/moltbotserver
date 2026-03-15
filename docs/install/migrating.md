---
summary: "Move (migrate) a OpenClaw install from one machine to another, or switch from another OpenClaw fork"
read_when:
  - You are moving OpenClaw to a new laptop/server
  - You want to preserve sessions, auth, and channel logins (WhatsApp, etc.)
  - You are switching from another OpenClaw fork
  - You want to import a backup from a different OpenClaw installation
title: "Migration Guide"
---

# Migrating OpenClaw to a new machine

This guide migrates a OpenClaw Gateway from one machine to another **without redoing onboarding**.

The migration is simple conceptually:

- Copy the **state directory** (`$OPENCLAW_STATE_DIR`, default: `~/.openclaw/`) — this includes config, auth, sessions, and channel state.
- Copy your **workspace** (`~/.openclaw/workspace/` by default) — this includes your agent files (memory, prompts, etc.).

But there are common footguns around **profiles**, **permissions**, and **partial copies**.

## Before you start (what you are migrating)

### 1) Identify your state directory

Most installs use the default:

- **State dir:** `~/.openclaw/`

But it may be different if you use:

- `--profile <name>` (often becomes `~/.openclaw-<profile>/`)
- `OPENCLAW_STATE_DIR=/some/path`

If you’re not sure, run on the **old** machine:

```bash
openclaw status
```

Look for mentions of `OPENCLAW_STATE_DIR` / profile in the output. If you run multiple gateways, repeat for each profile.

### 2) Identify your workspace

Common defaults:

- `~/.openclaw/workspace/` (recommended workspace)
- a custom folder you created

Your workspace is where files like `MEMORY.md`, `USER.md`, and `memory/*.md` live.

### 3) Understand what you will preserve

If you copy **both** the state dir and workspace, you keep:

- Gateway configuration (`openclaw.json`)
- Auth profiles / API keys / OAuth tokens
- Session history + agent state
- Channel state (e.g. WhatsApp login/session)
- Your workspace files (memory, skills notes, etc.)

If you copy **only** the workspace (e.g., via Git), you do **not** preserve:

- sessions
- credentials
- channel logins

Those live under `$OPENCLAW_STATE_DIR`.

## Migration steps (recommended)

### Step 0 — Make a backup (old machine)

On the **old** machine, stop the gateway first so files aren’t changing mid-copy:

```bash
openclaw gateway stop
```

(Optional but recommended) archive the state dir and workspace:

```bash
# Adjust paths if you use a profile or custom locations
cd ~
tar -czf openclaw-state.tgz .openclaw

tar -czf openclaw-workspace.tgz .openclaw/workspace
```

If you have multiple profiles/state dirs (e.g. `~/.openclaw-main`, `~/.openclaw-work`), archive each.

### Step 1 — Install OpenClaw on the new machine

On the **new** machine, install the CLI (and Node if needed):

- See: [Install](/install)

At this stage, it’s OK if onboarding creates a fresh `~/.openclaw/` — you will overwrite it in the next step.

### Step 2 — Copy the state dir + workspace to the new machine

Copy **both**:

- `$OPENCLAW_STATE_DIR` (default `~/.openclaw/`)
- your workspace (default `~/.openclaw/workspace/`)

Common approaches:

- `scp` the tarballs and extract
- `rsync -a` over SSH
- external drive

After copying, ensure:

- Hidden directories were included (e.g. `.openclaw/`)
- File ownership is correct for the user running the gateway

### Step 3 — Run Doctor (migrations + service repair)

On the **new** machine:

```bash
openclaw doctor
```

Doctor is the “safe boring” command. It repairs services, applies config migrations, and warns about mismatches.

Then:

```bash
openclaw gateway restart
openclaw status
```

## Common footguns (and how to avoid them)

### Footgun: profile / state-dir mismatch

If you ran the old gateway with a profile (or `OPENCLAW_STATE_DIR`), and the new gateway uses a different one, you’ll see symptoms like:

- config changes not taking effect
- channels missing / logged out
- empty session history

Fix: run the gateway/service using the **same** profile/state dir you migrated, then rerun:

```bash
openclaw doctor
```

### Footgun: copying only `openclaw.json`

`openclaw.json` is not enough. Many providers store state under:

- `$OPENCLAW_STATE_DIR/credentials/`
- `$OPENCLAW_STATE_DIR/agents/<agentId>/...`

Always migrate the entire `$OPENCLAW_STATE_DIR` folder.

### Footgun: permissions / ownership

If you copied as root or changed users, the gateway may fail to read credentials/sessions.

Fix: ensure the state dir + workspace are owned by the user running the gateway.

### Footgun: migrating between remote/local modes

- If your UI (WebUI/TUI) points at a **remote** gateway, the remote host owns the session store + workspace.
- Migrating your laptop won’t move the remote gateway’s state.

If you’re in remote mode, migrate the **gateway host**.

### Footgun: secrets in backups

`$OPENCLAW_STATE_DIR` contains secrets (API keys, OAuth tokens, WhatsApp creds). Treat backups like production secrets:

- store encrypted
- avoid sharing over insecure channels
- rotate keys if you suspect exposure

## Verification checklist

On the new machine, confirm:

- `openclaw status` shows the gateway running
- Your channels are still connected (e.g. WhatsApp doesn’t require re-pair)
- The dashboard opens and shows existing sessions
- Your workspace files (memory, configs) are present

## Related

- [Doctor](/gateway/doctor)
- [Gateway troubleshooting](/gateway/troubleshooting)
- [Where does OpenClaw store its data?](/help/faq#where-does-openclaw-store-its-data)
- [Backup CLI reference](/cli/backup)

---

## Coming from another OpenClaw fork

If you're switching from upstream `openclaw/openclaw` or another fork, you can migrate your setup using the **backup import** flow — no manual file copying required.

### What transfers

A backup archive from any OpenClaw fork with `schemaVersion: 1` includes:

- **Config** (`openclaw.json`) — gateway settings, model config, channel setup
- **State** — session history, agent state, cron jobs
- **Credentials** — OAuth tokens, API keys, WhatsApp session
- **Workspace** — SOUL.md, MEMORY.md, USER.md, skills, memory files

### Step 1 — Create a backup on the old fork

On the machine running the other fork:

```bash
openclaw backup create --verify
```

This generates a timestamped `.tar.gz` archive with an embedded manifest.

> **Tip:** Use `--verify` to confirm the archive is intact before transferring it. The archive is self-contained — it includes everything needed to restore your setup.

### Step 2 — Import via the Dashboard

1. Open the **Dashboard** → navigate to your instance
2. Go to the **OpenClaw Backups** section
3. Click **Import Backup** and upload the `.tar.gz` file
4. The system validates the manifest and stores the archive

### Step 3 — Restore the backup

1. In the backup list, find the newly imported archive (labelled "Imported")
2. Click **Restore** → confirm
3. **Rebuild** or **restart** your instance

On the next boot, the entrypoint extracts the backup and normalizes the config (model settings, gateway binding, security enforcements).

### Step 4 — Verify

After the instance restarts:

- Check that channels are connected (Telegram, Discord, etc.)
- Verify your workspace files are present (memory, skills)
- Open the Control UI and confirm sessions loaded

> **Note:** If the imported config has fields from a different fork version, `enforce-config` and `openclaw doctor` automatically normalize them on boot. You don't need to manually fix the config in most cases.

## Cross-fork compatibility notes

### Fully compatible

| Data                                                  | Notes                                       |
| ----------------------------------------------------- | ------------------------------------------- |
| Workspace files (SOUL.md, MEMORY.md, USER.md, skills) | Standard markdown — works across all forks  |
| Session history                                       | Same SQLite schema across forks             |
| OAuth credentials                                     | Stored in the same `credentials/` structure |
| Channel state (WhatsApp, Telegram)                    | Same provider format                        |

### May need attention

| Data                   | Risk   | What happens                                                                                           |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `openclaw.json` config | Low    | Unknown keys are silently dropped by Zod; missing required keys get defaults applied                   |
| Cron job store         | Low    | Format differences may reset custom schedules — they'll be re-seeded with defaults                     |
| Plugin config          | Medium | If the source fork had plugins not available on this fork, those entries generate warnings (non-fatal) |
| Custom extensions      | Low    | Extensions in `$STATE_DIR/extensions/` transfer, but must be root-owned                                |

### Won't work

- **Non-OpenClaw platforms** (e.g. Hermes Agent, Claude Desktop) use completely different file layouts and cannot be imported via backup. A dedicated migration tool would be needed.
- **Backups from forks with `schemaVersion` > 1** — the import API rejects archives with unrecognized schema versions.
