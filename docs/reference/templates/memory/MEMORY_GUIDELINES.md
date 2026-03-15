---
description: Guidelines for writing high-quality memory entries
---

# Memory Writing Guidelines

When writing to memory files (diary.md, open-loops.md, etc.):

## Structure

- Use format: `### [topic] — [YYYY-MM-DD]` for each entry
- Follow: **WHAT** → **WHY** → **REMEMBER** structure
- Keep entries focused — one topic per entry

## Quality

- Skip bare status confirmations (ok, done, yes, listo, ready)
- Skip heartbeat/bootstrap confirmations
- Never duplicate existing entries — update them instead
- Prefer specific details over vague descriptions

## Before Writing

- Check if the topic already has an entry → update it
- Check if the fact belongs in MEMORY.md (long-term) vs diary.md (recent events)
- Large data goes in workspace files, not memory entries

## Example

```markdown
### Railway deploy config — 2026-03-14

**WHAT**: Moved DATABASE_URL to Railway service variables (not repo secrets)
**WHY**: Railway injects service vars at build time; repo secrets only available in GitHub Actions
**REMEMBER**: Always use `railway variables set` for runtime config, never .env files in prod
```
