# Phase 2: Execution Steps

Replace `[id]` with the agent's ID and `[Name]` with their display name throughout.

---

## Step 1: Provision the Workspace (Deterministic Script)

Run the provisioning script to handle ALL mechanical setup:

```bash
bash /app/scripts/provision-agent.sh --id [id] --name "[Name]" --emoji "[Emoji]"
```

This script handles:

- ✅ Creating workspace directory structure
- ✅ Copying shared operational files (SOUL.md, AGENTS.md, OPERATIONS.md, etc.)
- ✅ Seeding memory templates (diary, self-review, open-loops)
- ✅ Copying shared skills
- ✅ Linking shared team directory
- ✅ Copying auth profiles from main agent
- ✅ Marking workspace as bootstrapped
- ✅ Running verification checks

Review the script output. Every check should show ✅. If any show ❌, fix the issue before continuing.

> [!TIP]
> **Preview first**: Use `--dry-run` to see what the script will do without making changes:
>
> ```bash
> bash /app/scripts/provision-agent.sh --id [id] --name "[Name]" --dry-run
> ```

---

## Step 2: Register the Agent via CLI

```bash
openclaw agents add [id] --workspace /home/node/data/workspace-[id] --agent-dir /home/node/data/agents/[id]/agent --non-interactive
```

If the agent already exists in `agents.list`, skip this step.

> [!IMPORTANT]
> **Sandbox MUST be `"off"` for named agents.** The default `browser-only` sandbox requires
> a filesystem bridge that doesn't support per-agent workspaces — it throws
> `"Sandbox filesystem bridge is unavailable"` at runtime.

After the CLI creates the agent, patch to ensure sandbox is off:

```bash
openclaw agents update [id] --sandbox-mode off
```

---

## Step 3: Write IDENTITY.md (Creative — AI's Job)

Write to `/home/node/data/workspace-[id]/IDENTITY.md` with ONLY user-provided details:

```markdown
# IDENTITY.md - Who You Are

> Your foundation lives in SOUL.md. This file is YOU.

## Identity Card

- **Name:** [USER-PROVIDED NAME]
- **Creature:** [USER-PROVIDED or "AI [role]"]
- **Vibe:** [USER-PROVIDED VIBE]
- **Emoji:** [USER-PROVIDED EMOJI]

## How You Work

[Write 3-5 bullets based on the role description]

## Personal Preferences

> Add learned preferences about the user here as you discover them.

- To be filled in as you learn about the user.

## Communication Style

[Write 3-4 bullets based on the personality description]
```

**VERIFY**: Re-read what you wrote. If the name matches YOUR name, DELETE and rewrite.

---

## Step 4: Write role.md (Creative — AI's Job)

Write to `/home/node/data/workspace-[id]/role.md` with role-specific content based on user input.

---

## Step 5: Add Channel Bindings

Read `references/channel-config.md` for the full channel configuration details.

Edit `/home/node/data/openclaw.json` to add channel accounts and bindings.

> [!IMPORTANT]
> **Use `safe-config-edit.mjs` for all config edits.** Never edit `openclaw.json` with raw shell
> redirects or string manipulation. Use: `node /app/safe-config-edit.mjs set "path.to.key" '<json-value>'`
> This validates JSON, creates automatic backups, and prevents corruption.

---

## Step 6: Set Identity and Restart

```bash
openclaw agents set-identity --agent [id] --name "[Name]" --emoji "[Emoji]"
openclaw gateway restart
```

Wait for restart, then verify:

```bash
# Check agent is registered
openclaw agents list --bindings

# Check cron jobs
openclaw cron list

# Check channels started
docker logs $(hostname) --since 30s 2>&1 | grep -iE 'starting provider|logged in'
```

Expected output should show the new account starting:

```
[telegram] [new-agent] starting provider (@NewAgentBot)
[discord] [new-agent] starting provider (@NewAgent)
```

---

## Step 7: Post-Provisioning Verification

Run the verification mode to confirm everything is correct:

```bash
bash /app/scripts/provision-agent.sh --id [id] --name "[Name]" --verify-only
```

All checks should pass. If any fail, the output will tell you exactly what's missing.

> [!NOTE]
> Browser containers and cron jobs are provisioned automatically by `enforce-config.mjs`
> on gateway restart. You do NOT need to set these up manually.
