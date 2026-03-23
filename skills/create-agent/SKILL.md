---
name: create-agent
description: |
  Create a new agent with full lifecycle setup: identity, workspace, channels (Telegram/Discord),
  browser container, cron jobs, and memory seeding. Consolidates upstream add-agent
  with channel-team-setup, browser provisioning, and memory lifecycle. Use when creating a new
  team member, not for channel-only config changes.
---

# Create Agent — Full Lifecycle Skill

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

For **channel-only changes** (adding a Telegram/Discord account to an existing agent), use the
`channel-team-setup` skill instead.

---

## Workflow

Complete each phase in order. Use the checklist to track progress.

- [ ] Phase 1: Interactive onboarding
- [ ] Phase 2: Execution (after user confirms)
- [ ] Phase 3: Verification

### Phase 1: Interactive Onboarding

Read `instructions/onboarding.md` for the full onboarding flow. Walk the user through
basics, personality, and channel setup conversationally. Do NOT dump all questions at once.

End Phase 1 by summarizing everything back to the user. Ask: "Does this look right?"

### Phase 2: Execution — After User Confirms

Read `instructions/execution-steps.md` for the complete step-by-step guide. This covers:

1. Create agent via CLI
2. Write IDENTITY.md and role.md
3. Copy operational files and auth profiles
4. Add channel bindings (Telegram/Discord)
5. Provision browser container
6. Set up cron jobs
7. Set identity in config
8. Restart and verify
9. Complete onboarding

For channel binding specifics, also read `references/channel-config.md`.

### Phase 3: Post-Setup

Read `references/memory-lifecycle.md` for how memory works for new agents.

If anything goes wrong, consult `references/troubleshooting.md`.

---

## Related Skills

- **channel-team-setup**: For adding channels to an _existing_ agent
- **cron-setup**: For custom cron job creation beyond the defaults
