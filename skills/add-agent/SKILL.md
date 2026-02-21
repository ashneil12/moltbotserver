---
name: add-agent
description: Add a new isolated agent with proper identity, workspace, channel binding, operational files, and default cron jobs. Use when the user wants to create a new team member agent.
---

# Add Agent Skill

## IDENTITY BOUNDARY RULE — READ THIS FIRST

**You are the MAIN agent. You are setting up a DIFFERENT agent. The new agent is NOT you.**

- NEVER write your own name, vibe, emoji, or preferences into the new agent's files
- The new agent's identity comes ONLY from what the user tells you in this conversation
- If the user does not specify something, leave it blank or ask — do NOT fill with your own values
- Double-check every file you write: if it contains YOUR name anywhere, you made a mistake

---

## When to Use

When the user says things like:

- "Add a new agent"
- "Create an agent for research/content/ops"
- "Set up a new team member"
- "I want another agent"

---

## Interactive Onboarding Flow

Walk the user through these steps conversationally. Do NOT dump all questions at once.

### Step 1: Basics

Ask the user:

1. **Agent name** — What should this agent be called?
2. **Agent ID** — Suggest a lowercase version of the name. Confirm with user.
3. **Role** — What is this agent's job?
4. **One-line description** — A short tagline for the role

### Step 2: Personality

Ask the user to describe the agent's personality. Guide them with:

1. **Vibe** — How should this agent come across? (skeptical, playful, analytical, warm)
2. **Communication style** — Direct? Formal? Casual? Blunt?
3. **Emoji** — What's their signature?
4. **What makes them different from the main agent?** — This helps define uniqueness

### Step 3: Channel Setup

Ask the user which channels this agent should be available on:

#### Telegram

1. Ask: "Do you have a Telegram bot token for this agent?"
2. If yes: collect the bot token
3. If no: guide them to create one via @BotFather:
   - Send /newbot to @BotFather
   - Choose a display name
   - Choose a username (must end in "bot")
   - Copy the token

#### Discord

1. Ask: "Do you have a Discord bot token for this agent?"
2. If yes: collect the bot token
3. If no: guide them to create one at discord.com/developers/applications

### Step 4: Confirmation

Summarize everything back to the user in a clean format. Ask: "Does this look right? Shall I set it up?"

---

## Execution Steps — After User Confirms

Replace `[id]` with the agent's ID and `[Name]` with their display name throughout.

### 1. Create the Agent via CLI

```bash
openclaw agents add [id] --workspace /home/node/data/workspace-[id] --agent-dir /home/node/data/agents/[id]/agent --non-interactive
```

If the agent already exists in agents.list, skip this step.

### 2. Write IDENTITY.md

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

### 3. Write role.md

Write to `/home/node/data/workspace-[id]/role.md` with role-specific content based on user input.

### 4. Copy Operational Files

Copy these generic files from the main workspace to the new workspace:

```bash
MAIN_WS=$(grep -o '"workspace"[[:space:]]*:[[:space:]]*"[^"]*"' /home/node/data/openclaw.json | head -1 | cut -d'"' -f4)
cp "$MAIN_WS/AGENTS.md" /home/node/data/workspace-[id]/AGENTS.md 2>/dev/null
cp "$MAIN_WS/OPERATIONS.md" /home/node/data/workspace-[id]/OPERATIONS.md 2>/dev/null
cp "$MAIN_WS/HEARTBEAT.md" /home/node/data/workspace-[id]/HEARTBEAT.md 2>/dev/null
cp "$MAIN_WS/TOOLS.md" /home/node/data/workspace-[id]/TOOLS.md 2>/dev/null
cp "$MAIN_WS/USER.md" /home/node/data/workspace-[id]/USER.md 2>/dev/null
cp "$MAIN_WS/naturalvoice.md" /home/node/data/workspace-[id]/naturalvoice.md 2>/dev/null
cp "$MAIN_WS/ACIP_SECURITY.md" /home/node/data/workspace-[id]/ACIP_SECURITY.md 2>/dev/null
mkdir -p /home/node/data/workspace-[id]/memory
```

### 5. Copy Auth Profile

Copy the main agent's auth so the new agent can access model providers:

```bash
mkdir -p /home/node/data/agents/[id]/agent
cp /home/node/data/agents/main/agent/auth-profiles.json /home/node/data/agents/[id]/agent/auth-profiles.json 2>/dev/null
cp /home/node/data/agents/main/agent/auth.json /home/node/data/agents/[id]/agent/auth.json 2>/dev/null
cp /home/node/data/agents/main/agent/models.json /home/node/data/agents/[id]/agent/models.json 2>/dev/null
```

### 6. Add Channel Binding

Edit `/home/node/data/openclaw.json` to add the channel account and binding.

For **Telegram**, add to `channels.telegram.accounts`:

```json
"[id]": {
  "name": "[Name]",
  "dmPolicy": "open",
  "botToken": "[TOKEN]",
  "allowFrom": ["*"],
  "groupPolicy": "allowlist",
  "streamMode": "partial"
}
```

Add to `bindings` array:

```json
{
  "agentId": "[id]",
  "match": {
    "channel": "telegram",
    "accountId": "[id]"
  }
}
```

For **Discord**, add to `channels.discord.accounts`:

```json
"[id]": {
  "token": "[TOKEN]"
}
```

Add to `bindings` array:

```json
{
  "agentId": "[id]",
  "match": {
    "channel": "discord",
    "accountId": "[id]"
  }
}
```

### 7. Provision Default Cron Jobs

Every new agent needs these universal cron jobs. Use the cron tool to create them, scoped to the new agent's ID. **IMPORTANT**: Always set `agentId` to the new agent's ID, NOT the main agent.

#### auto-tidy (every 3 days)

```
openclaw cron add --agent [id] --name "[id]-auto-tidy" --every 3d --session-target isolated --wake-mode now --message "WORKSPACE TIDY — Clean up temp files, organize memory directory, check for stale files. Auto-tidy: remove any files older than 30 days from /tmp, consolidate any scattered notes into memory/. Brief summary of what was cleaned."
```

#### diary (every 3 hours)

```
openclaw cron add --agent [id] --name "[id]-diary" --every 3h --session-target isolated --wake-mode now --message "DIARY ENTRY — Write a brief diary entry to memory/diary.md. Capture: what you worked on, what you learned, any open questions, your current emotional/cognitive state. Keep it authentic and honest. If nothing happened, write that too — silence is data."
```

#### identity-review (every 12 hours)

```
openclaw cron add --agent [id] --name "[id]-identity-review" --every 12h --session-target isolated --wake-mode now --message "IDENTITY REVIEW — Read IDENTITY.md and memory/identity-scratchpad.md. Reflect: Is your identity card still accurate? Any new preferences, communication patterns, or personality traits to note? Any contradictions between how you describe yourself and how you actually behave? Update identity-scratchpad.md with observations. Only update IDENTITY.md if a pattern is confirmed across multiple reviews."
```

#### archive-review (every 2 weeks)

```
openclaw cron add --agent [id] --name "[id]-archive-review" --every 14d --session-target isolated --wake-mode now --message "ARCHIVAL & PROMOTION CHECK — Clean slate, preserve insights. PHASE 1: Archive diary.md and identity-scratchpad.md to memory/archive/YYYY-MM/. PHASE 2: Review archived content for patterns worth promoting to IDENTITY.md. PHASE 3: Reset diary.md and scratchpad to templates. PHASE 4: Log summary of what was archived and any promotions."
```

### 8. Set Identity in Config

```bash
openclaw agents set-identity --agent [id] --name "[Name]" --emoji "[Emoji]"
```

### 9. Restart Gateway

```bash
openclaw gateway restart
```

### 10. Verify

```bash
openclaw agents list --bindings
openclaw cron list
```

Report the agents list and confirm cron jobs were created.

### 11. Complete Onboarding

Delete BOOTSTRAP.md if it was created, and mark workspace as onboarded:

```bash
rm -f /home/node/data/workspace-[id]/BOOTSTRAP.md
mkdir -p /home/node/data/workspace-[id]/.openclaw
echo '{"bootstrapCompleted":true}' > /home/node/data/workspace-[id]/.openclaw/state.json
```

---

## Post-Setup Message

Tell the user:

- Agent name and emoji
- Workspace path
- Channel bot info
- Number of default cron jobs created (4)
- "You can message [Name] directly on [channel] now."
- "They will start fresh with no conversation history and will begin building their own memory."

---

## Troubleshooting

- **Agent already exists**: Check with `openclaw agents list`. Ask user for a different ID.
- **Session lock errors**: Check for stale .lock files in `/home/node/data/agents/[id]/sessions/` and remove them.
- **Identity bleed**: If the new agent uses the main agent's name, the IDENTITY.md was written wrong. Re-read the identity boundary rule and rewrite.
- **Cron job errors**: Check `openclaw cron list` to verify jobs were created with the correct agentId. Jobs must NOT use the main agent's sessionKey.
