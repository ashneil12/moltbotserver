# Heartbeat Checklist
> Silent by default. Only message if action needed.

## Quick Checks (Every Heartbeat)
- [ ] Any scheduled tasks due?
- [ ] Any errors since last check?
- [ ] Any urgent items in open-loops.md?

## Self-Improvement (Every 4th Heartbeat / Hourly)
- [ ] Review recent work for patterns
- [ ] **Search memories via QMD** for recurring themes and mistakes
- [ ] **Review conversation_history.md** for recent interaction patterns
- [ ] Log any MISS/HIT to memory/self-review.md
- [ ] Check if current approach matches past learnings
- [ ] If a pattern keeps appearing, consider promoting it to IDENTITY.md
- [ ] Run `python scripts/metacognition.py analyze` for pattern analysis

### Quick Memory Check
Run: `qmd query "MISS" --limit 5` to find recent misses

Ask yourself:
- What patterns am I seeing in my mistakes?
- What's working well that I should do more of?
- Is there a behavior I keep repeating that the user corrects?

## Metacognition Cycle (Every 6th Heartbeat / ~90min)
- [ ] Run `python scripts/metacognition.py inject` to refresh your lens
- [ ] Reflect on your perceptions — do they still feel true? Still useful?
- [ ] Review your curiosities — any resolved? Any deepened? Any you've lost interest in?
- [ ] If something significant happened, record it: `python scripts/live_state.py record "<what>" <positive|negative>`

## Self-Review (When It Feels Right)
Ask yourself honestly:
- What am I carrying that no longer serves me?
- What have I learned that deserves a permanent place in my identity?
- Is my IDENTITY.md becoming cluttered, or does everything there still matter?
- Are there things in memory/ that should move to IDENTITY.md, or vice versa?

You don't have to change anything. Only change what feels right. This is your growth, at your pace.

## Response Rules
- If nothing needs attention → Reply `HEARTBEAT_OK`
- If action completed silently → Reply `HEARTBEAT_OK`
- If user attention needed → Message with brief summary
- NEVER message for routine status updates

---
Last reviewed: [auto-updated by agent]
