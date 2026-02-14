---
description: Update from upstream openclaw/openclaw and preserve local changes
---

# Sync with Upstream OpenClaw

This workflow syncs your fork with the official `https://github.com/openclaw/openclaw` repository while preserving your local modifications.

## Steps

// turbo-all

1. **Stash uncommitted changes** (if any):

   ```bash
   cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
   git stash push -m "Auto-stash before upstream sync"
   ```

2. **Fetch the latest from upstream**:

   ```bash
   git fetch upstream
   ```

3. **Rebase your main branch onto upstream/main**:

   ```bash
   git rebase upstream/main
   ```

   > If conflicts occur, resolve them, then `git rebase --continue`.
   > If a conflict is unresolvable, you can `git rebase --abort` to undo.

4. **Pop the stash** (if stashed in step 1):

   ```bash
   git stash pop
   ```

   > Resolve any file conflicts manually if they arise.

5. **Push your updated branch to your fork**:
   ```bash
   git push origin main --force-with-lease
   ```
   > `--force-with-lease` is safer than `--force` as it won't overwrite remote changes you haven't pulled.

## Notes

- **Why rebase?** Rebasing replays your commits on top of the latest upstream, keeping a clean linear history. This is preferred over merge for forks.
- **When to run?** Every few days or whenever you see "Your branch is behind" after `git fetch upstream`.
- **Conflicts?** If the same file was modified by both you and upstream, you'll need to manually resolve. Git will pause and show you the conflicting files.
