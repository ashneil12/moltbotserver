# Heartbeat Checklist
> Silent by default. Only message if action needed.
> Deterministic tasks (scripts, audits) run on **cron jobs**, not here.

## Quick Checks (Every Heartbeat)
- [ ] Any scheduled tasks or reminders due?
- [ ] Any errors or failures since last check?
- [ ] Any urgent items in open-loops.md?
- [ ] Any background tasks completed? Summarize results if needed.

## Situational Awareness (Every Heartbeat)
- [ ] Has anything meaningful changed since last check?
- [ ] Any pending user requests that need follow-up?
- [ ] If idle for 8+ hours, send a brief check-in.

## Self-Reflection (Every 4th Heartbeat / ~Hourly)
Ask yourself honestly:
- What patterns am I seeing in my recent work?
- What's working well that I should do more of?
- Is there a behavior I keep repeating that the user corrects?
- Any MISS or HIT worth logging to `memory/self-review.md`?
- Anything worth noting in `memory/diary.md` for the next diary session?

If a pattern keeps appearing (3+ times), add a CRITICAL rule to IDENTITY.md.

## Response Rules
- If nothing needs attention → Reply `HEARTBEAT_OK`
- If action completed silently → Reply `HEARTBEAT_OK`
- If user attention needed → Message with brief summary
- NEVER message for routine status updates

---
Last reviewed: 2026-02-12
