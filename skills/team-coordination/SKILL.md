---
name: team-coordination
description: Multi-agent team coordination via shared team/ directory — decisions, status, conflicts, handoffs.
---

# Team Coordination

Use when: multiple agents need to stay synchronized, an agent makes a decision that affects others, work needs to be handed off between agents, or during the `team-sync` cron job.

## How It Works

All agents share a `team/` directory (symlinked from a central location). This is the coordination hub — no orchestrator needed.

```
~/workspace/team/           ← symlink to shared directory
  decisions.md              ← decision log (append-only, all agents)
  status.md                 ← per-agent status board
  knowledge/                ← shared domain knowledge files
```

## When to Write to team/decisions.md

Write a decision entry when you:

- Choose a technology, library, or architecture pattern
- Change shared state (database schema, API contract, config format)
- Make a user-visible behavior change
- Decide NOT to do something that was previously discussed

Do NOT log routine task completions or internal-only changes.

## When to Check team/ Outside of team-sync

Before starting work that:

- Might overlap with another agent's domain
- Depends on a shared resource or config
- Could conflict with another agent's recent decisions

Read `team/status.md` and `team/decisions.md` first.

## Decision Format

See [decision-format.md](file:///Users/ash/Documents/MoltBotServers/.agents/skills/team-coordination/references/decision-format.md) for the full template.

## Conflict Resolution

When two agents have contradictory decisions:

1. **Detect**: Add a `> ⚠️ CONFLICT:` block to `team/decisions.md`
2. **Pause**: Do not proceed with the conflicting work
3. **Escalate**: Message the user with a brief summary of the conflict
4. **Resolve**: Once the user decides, update the decision log with the resolution

## Handoff Protocol

When handing work from Agent A to Agent B:

1. Agent A writes detailed context to `team/knowledge/handoff-[topic].md`
2. Agent A logs the handoff in `team/decisions.md`
3. Agent A can optionally use `sessions_send` to notify Agent B directly
4. Agent B picks up the context during next `team-sync` or immediately via `sessions_send`

## Related Skills

- `create-agent`: Sets up the team directory symlink for new agents
- `channel-team-setup`: Configures agent communication channels
- `cron-setup`: Manages the team-sync cron job schedule
