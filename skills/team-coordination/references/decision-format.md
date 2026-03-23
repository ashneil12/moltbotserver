# Decision Log Format

Every decision entry in `team/decisions.md` should follow this format:

```markdown
## [YYYY-MM-DD HH:MM] [Agent Name] — [Decision Title]

**Context:** Why this decision was needed — what problem it solves
**Decision:** What was decided — be specific
**Affects:** Which agents, domains, or shared resources this impacts
**Alternatives considered:** What else was explored (optional but valuable)
**Status:** active | superseded | reverted
```

## Examples

### Good Decision Entry

```markdown
## 2026-03-21 09:30 Seneschal — Use PostgreSQL for analytics storage

**Context:** Analytics data growing beyond SQLite capacity, need concurrent writes
**Decision:** Migrate analytics tables to PostgreSQL, keep session data in SQLite
**Affects:** All agents that write analytics events, dashboard queries
**Alternatives considered:** TimescaleDB (overkill), DuckDB (no concurrent writes)
**Status:** active
```

### Bad Decision Entry (Too Vague)

```markdown
## 2026-03-21 Seneschal — Database change

**Decision:** Changed the database
**Status:** active
```

This is useless to other agents. Be specific about WHAT changed and WHY.

## Status Transitions

- `active` — Current, agents should respect this decision
- `superseded` — Replaced by a newer decision (link to the new one)
- `reverted` — Rolled back, no longer in effect

When superseding a decision, add a note to the original:

```markdown
**Status:** superseded → See [2026-03-22 14:00] Switch back to SQLite with WAL mode
```

## Conflict Markers

When you detect a conflict between decisions, add:

```markdown
> ⚠️ CONFLICT: [Agent A] decided [X] in entry [date] but [Agent B] decided [Y] in entry [date]. Needs user resolution.
```

Place the conflict marker directly after the newer conflicting decision.
