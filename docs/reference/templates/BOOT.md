---
title: "BOOT.md Template"
summary: "Workspace template for BOOT.md"
read_when:
  - Adding a BOOT.md checklist
---

# BOOT.md

Add short, explicit instructions for what OpenClaw should do on startup (enable `hooks.internal.enabled`).
If the task sends a message, use the message tool and then reply with NO_REPLY.

## Startup State Verification (example)

```
# BOOT.md

On every boot, before doing anything else:

VERIFY STATE:
1. Read IDENTITY.md — is this still who you are? Any drift since last review?
2. Read WORKING.md — are there tasks in progress that need resuming?
3. Read memory/open-loops.md — anything time-sensitive or overdue?
4. Check environment — respond to the user if anything feels off (wrong model, unexpected configuration).

If everything checks out, reply NO_REPLY.
If something needs attention, message the user briefly.
```
