# Fork Strategy

This repo is maintained as a deliberate product fork of `openclaw/openclaw`.

## Default Rule

Do not treat upstream as a branch that should routinely be merged or rebased into `main`.

Upstream is an input stream for decisions:

1. inspect the upstream change
2. decide whether to cherry-pick it, re-implement it locally, or ignore it
3. verify it against this fork's invariants

## Decision Policy

### Cherry-pick directly when:

- the upstream change is small and self-contained
- it does not cut across MoltBot-only seams
- it matches this platform's runtime assumptions
- it is easier to preserve upstream as-is than to re-implement

### Re-implement locally when:

- the upstream intent is useful
- but the implementation shape conflicts with MoltBot architecture
- the change touches managed-platform behavior, entrypoints, system prompts, or other fork-owned areas
- preserving a clean override seam matters more than preserving commit identity

### Ignore when:

- the change is irrelevant to this platform
- it would increase fork drag without clear value
- it depends on upstream product assumptions that do not apply here

## Workflow

For selective upstream intake:

1. inspect the upstream commit
2. check whether touched files intersect `FORK_INVARIANTS.md`
3. decide: cherry-pick, re-implement, or ignore
4. run real verification commands
5. commit the result with a clear message

## Things We No Longer Use As The Default

- routine `git rebase upstream/main`
- `git stash`-based sync flows
- "verify local patches survived the merge" as the primary maintenance concept

## What We Optimize For

- stable MoltBot behavior
- explicit fork seams
- selective adoption of upstream fixes
- low surprise during future maintenance
