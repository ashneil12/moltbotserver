---
description: Archived legacy fork-sync notes
---

# Archived: OpenClaw Upstream Sync Workflow

This file is retained only as historical reference.

It assumes a routine upstream sync model that no longer matches how this fork is maintained.

Current rule:

- upstream changes are reviewed selectively
- self-contained fixes may be cherry-picked
- larger or platform-sensitive changes should usually be re-implemented locally

See:

- `FORK_STRATEGY.md`
- `FORK_INVARIANTS.md`
- `scripts/cherry-pick-upstream.sh`
