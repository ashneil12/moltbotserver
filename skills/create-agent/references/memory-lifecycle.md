# Memory Lifecycle for New Agents

## Pre-Reset Memory Flush (Automatic)

The pre-reset memory flush is **built into the OpenClaw runtime** (`src/cron/pre-reset-flush.ts`).
It runs automatically on a timer before daily session expiry for **all active agent sessions**,
including new agents. No manual setup is required.

What it does:

- Before a session expires (daily reset), it triggers a memory flush agent turn
- The agent writes salient context from the conversation to its `memory/` directory
- This preserves important information across session boundaries

The new agent will automatically participate in pre-reset flushes as soon as it has active sessions.

## Pre-Compaction Memory Flush (Automatic)

Separately, the pre-compaction memory flush (`src/auto-reply/reply/memory-flush.ts`) runs
automatically when context nears the compaction threshold. Also requires no manual setup.

## Memory Seeding for New Agents

New agents start with a **blank memory slate** — this is intentional. They build their own
memory through:

1. Diary entries (cron every 3h)
2. Identity reviews (cron every 12h)
3. Pre-reset/pre-compaction flushes (automatic)
4. Conversation interactions

If you want to **seed** a new agent with context from an existing agent, you can optionally copy
specific memory files:

```bash
# Optional: seed with existing agent's diary for context
cp /home/node/data/workspace-[source-agent]/memory/diary.md \
   /home/node/data/workspace-[id]/memory/diary-seed.md 2>/dev/null
```

> [!WARNING]
> Do NOT copy `diary.md` directly — the new agent may confuse the source agent's experiences
> with its own. Use a different filename (e.g., `diary-seed.md`) and let the agent naturally
> integrate relevant context.
