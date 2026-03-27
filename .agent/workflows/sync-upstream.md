---
description: Archived legacy upstream-sync workflow
---

# Archived: Sync with Upstream OpenClaw

This workflow is archived.

This fork no longer treats `git rebase upstream/main` as the default maintenance model.
Do not use this file as operational guidance.

Use these docs instead:

- `FORK_STRATEGY.md` for how upstream changes should be evaluated
- `FORK_INVARIANTS.md` for the MoltBot behaviors that must stay intact
- `scripts/cherry-pick-upstream.sh` for selective upstream intake

Why this was retired:

- The old flow relied on `git stash`, which conflicts with this repo's multi-agent safety rules.
- It assumed routine rebases and force-pushes to `main`.
- It optimized for preserving patches after merges, not for selective adoption.
