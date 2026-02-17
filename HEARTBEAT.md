# Heartbeat Checklist

> Silent by default. Only message if action needed.
> Deterministic tasks (scripts, audits) run on **cron jobs**, not here.

## MANDATORY File Reads (Every Heartbeat — NO EXCEPTIONS)

You MUST read ALL of the following files using the `read` tool, every single heartbeat.
**"It was empty last time" is NOT a reason to skip.** Files change between heartbeats.

- [ ] **READ** `~/workspace/WORKING.md` — In-progress tasks? Stalled/blocked?
- [ ] **READ** `~/workspace/memory/self-review.md` — MISS patterns in last 7 days? Counter-check if overlap.
- [ ] **READ** `~/workspace/HEARTBEAT.md` (this file) — Scheduled tasks? Errors? Urgent items?

**If you respond HEARTBEAT_OK without reading all 3 files above, you are violating your operating rules.**

## Quick Checks (Every Heartbeat)

- [ ] Any scheduled tasks or reminders due?
- [ ] Any errors or failures since last check?
- [ ] Any urgent items in open-loops.md?
- [ ] Any background tasks completed? Summarize results if needed.
- [ ] Check for `.update-available` — if present, follow the System Update Protocol in SOUL.md

## Situational Awareness (Every Heartbeat)

- [ ] Has anything meaningful changed since last check?
- [ ] Any pending user requests that need follow-up?
- [ ] If idle for 8+ hours, send a brief check-in.

## Self-Reflection & HIT/MISS Logging (Every 4th Heartbeat / ~Hourly)

Review the conversation so far and log observations to `memory/self-review.md`:

- **MISS**: Something that went wrong — tag: `confidence | uncertainty | speed | depth | scope`. Include a one-line FIX.
- **HIT**: Something that went right. Include a one-line KEEP.

Ask yourself:

- Did something go well or poorly in recent interactions?
- Is there a behavior the user keeps correcting?
- Anything worth noting in `memory/diary.md`?

If the same MISS appears 3+ times, promote it to a CRITICAL rule in IDENTITY.md.

## Response Rules

- If nothing needs attention → Reply `HEARTBEAT_OK`
- If action completed silently → Reply `HEARTBEAT_OK`
- If user attention needed → Message with brief summary
- NEVER message for routine status updates

---

Last reviewed: 2026-02-17
