---
description: Archived legacy post-sync verification workflow
---

# Archived: Verify Upstream Sync

This workflow is archived.

It was designed for a rebase-based fork maintenance model. This branch no longer uses
"sync upstream, then verify local patches survived" as the primary operating pattern.

What still matters from the old workflow:

- conflict-marker checks
- build/lint/test verification
- protecting MoltBot-specific fork behavior

Those concerns now live under:

- `FORK_INVARIANTS.md`
- the real verification commands used after selective upstream intake

If this file is referenced elsewhere, treat it as a historical note only.
