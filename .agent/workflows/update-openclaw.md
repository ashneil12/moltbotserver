---
description: Safely update OpenClaw from upstream with full review and conflict analysis
---

# Update OpenClaw from Upstream

This workflow updates your security-hardened fork of OpenClaw from `upstream/main` while preserving your local customizations. It provides full visibility into changes before merging.

> [!IMPORTANT]
> This is an interactive, review-first workflow. DO NOT auto-run any merge/rebase steps without explicit user approval.

---

## Phase 1: Assessment

Check what's new in upstream without merging anything.

```bash
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
git fetch upstream
```

```bash
# Show ahead/behind counts
git rev-list --left-right --count main...upstream/main
```

```bash
# Show latest upstream tag/version if any
git describe --tags upstream/main --always 2>/dev/null || echo "No tags"
```

**Report to user**: Number of commits ahead (your changes) and behind (upstream changes).

---

## Phase 2: Changelog Analysis

Generate a plain-English summary of upstream changes.

```bash
# List upstream commits we don't have (limit to last 50)
git log main..upstream/main --oneline --no-merges -n 50
```

```bash
# Get commit messages for summary
git log main..upstream/main --pretty=format:"%s" --no-merges -n 50
```

**Analyze and report**:

1. Categorize commits: Features, Bug Fixes, Dependencies, Breaking Changes, Security
2. Summarize in plain English what upstream changed
3. Highlight anything that looks like it could affect security or core functionality

---

## Phase 3: Conflict Detection

Identify files modified in both upstream and your fork.

```bash
# Find the merge base (common ancestor)
MERGE_BASE=$(git merge-base main upstream/main)
echo "Merge base: $MERGE_BASE"
```

```bash
# Files changed in upstream since merge base
git diff --name-only $MERGE_BASE upstream/main > /tmp/upstream_changes.txt
cat /tmp/upstream_changes.txt | head -50
```

```bash
# Files you've changed since merge base
git diff --name-only $MERGE_BASE main > /tmp/local_changes.txt
cat /tmp/local_changes.txt | head -50
```

```bash
# Find conflicting files (changed in both)
comm -12 <(sort /tmp/upstream_changes.txt) <(sort /tmp/local_changes.txt)
```

**Categorize conflicts by risk**:

- **HIGH**: Security-related files, docker configs, entrypoints
- **MEDIUM**: Core source files in `src/`
- **LOW**: Package files, configs, documentation

For HIGH risk conflicts, show the specific diff:

```bash
# Example for a specific conflicting file
git diff main upstream/main -- <filename>
```

---

## Phase 4: Update Plan

Based on the conflict analysis, propose a resolution strategy for each conflicting file.

**Resolution strategies**:
| Strategy | When to use |
|----------|-------------|
| **Keep Local** | Your security change is intentional and should not be overwritten |
| **Take Upstream** | Upstream improvement doesn't affect your customization |
| **Manual Merge** | Need to combine both changes carefully |
| **Review & Decide** | Need to inspect the diff before deciding |

**Create a plan document** listing each conflict and proposed resolution.

> [!CAUTION]
> DO NOT proceed to Phase 5 until the user explicitly approves the update plan.

---

## Phase 5: Execute Update

**Only proceed after user approval of the plan.**

```bash
# Stash any uncommitted work
git stash push -m "Auto-stash before upstream sync $(date +%Y%m%d)"
```

```bash
# Rebase onto upstream (preferred for clean history)
git rebase upstream/main
```

When conflicts occur during rebase:

1. Open the conflicting file
2. Apply the approved resolution strategy
3. Stage the resolved file: `git add <file>`
4. Continue: `git rebase --continue`

If rebase becomes too complex, abort and use merge instead:

```bash
git rebase --abort
git merge upstream/main
```

After all conflicts resolved:

```bash
# Rebuild to verify everything works
npm install  # or pnpm install
npm run build
```

```bash
# Pop stashed changes if any
git stash pop || true
```

---

## Phase 6: Finalize

Push to your fork after successful build.

```bash
# Force push required after rebase
git push origin main --force-with-lease
```

**Generate summary**: List what was updated, any manual resolutions made, and next steps.

---

## Quick Reference

```bash
# Full assessment (Phase 1-3) without any changes
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
git fetch upstream
git rev-list --left-right --count main...upstream/main
git log main..upstream/main --oneline -n 20
MERGE_BASE=$(git merge-base main upstream/main)
comm -12 <(git diff --name-only $MERGE_BASE upstream/main | sort) <(git diff --name-only $MERGE_BASE main | sort)
```

---

## Context Files

See `.agent/OPENCLAW_CONTEXT.md` for documentation of local customizations that should be preserved during updates.
