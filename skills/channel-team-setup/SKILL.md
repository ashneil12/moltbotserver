---
name: channel-team-setup
description: |
  Set up and configure multi-agent team messaging across Telegram, Discord, and other channels.
  Use when adding a new agent to the team, configuring a new channel (Telegram/Discord),
  enabling group chat for agents, fixing "agent not responding" issues in groups,
  or setting up agent-to-agent communication. Covers: openclaw.json config, bindings,
  groupPolicy, requireMention, sandbox, and platform quirks.
---

# Channel & Team Messaging Setup

Configure multi-agent teams to communicate across Telegram, Discord, and other platforms.

## Quick Reference: Config Keys by Platform

| Setting         | Telegram                                     | Discord                                      |
| --------------- | -------------------------------------------- | -------------------------------------------- |
| Account section | `channels.telegram.accounts.<id>`            | `channels.discord.accounts.<id>`             |
| Group policy    | `groupPolicy: "open"`                        | `groupPolicy: "open"`                        |
| Mention gating  | `groups: { "*": { requireMention: false } }` | `guilds: { "*": { requireMention: false } }` |
| DM policy       | `dmPolicy: "open"`                           | `dmPolicy: "open"`                           |
| Sender allow    | `allowFrom: ["*"]`                           | `allowFrom: ["*"]`                           |
| Streaming       | `streaming: "partial"`                       | `streaming: "partial"`                       |

> [!CAUTION]
> Discord uses `guilds` for per-guild settings. Telegram uses `groups`. Using the wrong key
> causes a config validation error and the setting is silently ignored.

---

## Workflow

### Step 1: Add the Agent

Read `instructions/agent-setup.md` for:

- Adding agent to `agents.list` in config
- Creating workspace and agent directories
- Copying bootstrap files and auth profiles

### Step 2: Add Channel Accounts

Read `instructions/channel-accounts.md` for:

- Telegram account configuration and platform-specific requirements
- Discord account configuration and intents setup
- Agent-to-agent communication setup

### Step 3: Add Bindings

Read `instructions/bindings-and-peers.md` for:

- Binding format for each channel

### Step 4: Verify and Restart

Read `instructions/verification.md` for:

- Config validation
- Restart procedures
- Verifying bots started
- Testing group messaging

### Troubleshooting

Read `references/troubleshooting.md` for common issues.

### Full Working Example

Read `references/full-example.md` for a complete 4-agent setup config.

---

## Related Skills

- **create-agent**: Full agent lifecycle including channels (use for new agents)
- **cron-setup**: For setting up cron jobs after channel setup
