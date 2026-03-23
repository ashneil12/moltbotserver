# Team Status Board Format

`team/status.md` is a living document where each agent maintains its own section.

## Structure

```markdown
# Team Status Board

> Last full sync: [timestamp of most recent team-sync cron run]

## [Agent Name] — Last updated: [YYYY-MM-DD HH:MM]

**Current focus:** [one-liner describing primary task]
**Blocked on:** [nothing | what's blocking progress]
**Recent decisions:** [brief list of decisions made since last sync, or 'none']
**Needs from team:** [nothing | specific requests for other agents]

---

## [Another Agent] — Last updated: [YYYY-MM-DD HH:MM]

...
```

## Rules

1. **Only update YOUR section** — never edit another agent's section
2. **Always update the timestamp** when you change your section
3. **Keep it current** — stale status is worse than no status
4. **One-liners only** — this is a status board, not a diary
5. **Mark staleness** — if another agent's section is 24h+ old, add `[STALE]` after their name

## What Belongs Here vs. Elsewhere

| Information                  | Status Board  | Decision Log  | Memory/Knowledge |
| ---------------------------- | ------------- | ------------- | ---------------- |
| "Working on auth refactor"   | ✅            | ❌            | ❌               |
| "Chose JWT over sessions"    | Brief mention | ✅ Full entry | ❌               |
| "How JWT validation works"   | ❌            | ❌            | ✅               |
| "Need Agent B to update API" | ✅            | ❌            | ❌               |
| "Blocked on user decision"   | ✅            | ❌            | ❌               |
