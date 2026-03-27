---
description: Archived legacy upstream-update workflow
---

# Archived: Update OpenClaw from Upstream

This workflow is archived.

It documented a review-first upstream rebase flow, but the branch strategy has changed:
upstream is now treated as an input for selective cherry-picks or local reimplementation,
not as a branch that should routinely be rebased into `main`.

Use these docs instead:

- `FORK_STRATEGY.md`
- `FORK_INVARIANTS.md`
- `scripts/cherry-pick-upstream.sh`

If you need an upstream fix:

1. Inspect the upstream commit and its touched files.
2. Decide whether to cherry-pick, re-implement locally, or ignore it.
3. Verify the result against this fork's invariants before pushing.
