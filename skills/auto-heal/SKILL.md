---
name: auto-heal
description: "Background engineering subagent protocol for autonomous code repair. Use when: (1) the error journal has unresolved entries, (2) a runtime tool keeps failing, (3) health sentinel fires an auto-heal probe, (4) the cron heartbeat detects stale errors. Follows a strict TDD loop with mandatory backups, scope constraints, and fix-first escalation."
---

# Auto-Heal Protocol

Self-healing engineering loop for autonomous code repair. The auto-heal subagent ("Ross") operates invisibly in the background, diagnosing and fixing tool errors without human intervention.

## When This Activates

- Error journal (`~/.openclaw/auto-heal/error-journal.jsonl`) has pending entries
- Health sentinel fires an auto-heal probe
- Cron heartbeat detects recurring tool failures

## The TDD Loop

Complete each step sequentially. Never skip steps.

### Step 1: Diagnose

```
auto_heal action=diagnose
```

Read the error journal. Identify the highest-severity actionable error. Check:

- Is the target file in scope? (tools/, skills/, utils/, cron/ only)
- Have we already exhausted 3 attempts for this error?
- Is the error reproducible?

If out of scope or exhausted → escalate immediately. Do not attempt.

### Step 2: Backup

Before touching ANY code:

```bash
cp <target-file> <target-file>.bak
```

This is non-negotiable. The backup enables guaranteed rollback.

### Step 3: Reproduce (Write Test)

Follow the `systematic-debugging` skill Phase 1 → Phase 4:

1. Read the error message and stack trace carefully
2. Write a minimal failing test that reproduces the error
3. Run the test to confirm it fails as expected

```bash
npx vitest run <test-file> --reporter=verbose
```

If you **cannot reproduce the error** after 2 attempts → escalate as a "ghost bug".

### Step 4: Fix

Apply the smallest possible code change to fix the root cause.

**Rules:**

- ONE change per attempt. No "while I'm here" improvements.
- Follow existing code patterns in the file.
- Do not add new dependencies.
- Do not modify function signatures without updating all callers.

### Step 5: Verify

Run the test suite for the affected file:

```bash
npx vitest run <test-file> --reporter=verbose
```

Then run related tests to check for ripple effects:

```bash
npx vitest run <directory-containing-file> --reporter=verbose
```

### Step 6: Report Result

```
auto_heal action=attempt-fix errorRef=<id> targetFile=<path>
  approach="<what you did>" testCommand="<command>"
  testPassed=<true|false> humanSummary="<plain english>"
```

- **If tests pass:** Fix is committed, BACKGROUND_FIXES.md is updated, backup is cleaned up.
- **If tests fail:** Attempt is recorded, backup is restored. Try a DIFFERENT approach (up to 3 total).

## Scope Constraints

### ✅ Leaf Nodes (allowed)

- `src/agents/tools/*`
- `skills/*`
- `src/utils/*`
- `src/cron/*` (except service core)

### 🚫 Trunk Nodes (NEVER modify)

- `system-prompt.ts`
- `pi-embedded-runner*`
- `src/security/*`
- `package.json`, `Dockerfile`, `.env`
- `src/gateway/*`, `src/config/config.ts`

Any attempt to modify a trunk node → immediate abort + escalate.

## Escalation Protocol

After 3 failed attempts:

1. **Restore backup** — system returns to pre-fix state
2. **Hand off to Main Agent** — send technical payload:
   - The error, the 3 approaches tried, confirmation of rollback
3. **Main Agent deep research** — the Main Agent enters systematic-debugging mode and tries 3 more approaches independently
4. **If Main Agent also fails** → contact the human with **fix-first options**:
   - Option 1: Try a different research strategy
   - Option 2: Show plain-English summary
   - Option 3: Save technical details for a developer
   - Option 4 (LAST): Pause the tool temporarily

**"Disable" is ALWAYS the last option. Never present it first.**

## Logging

All activity is logged to:

- `~/.openclaw/auto-heal/auto-heal-journal.jsonl` — machine-readable JSONL
- `BACKGROUND_FIXES.md` (workspace root) — human-readable changelog

The human or any developer SSH'ing in can always check BACKGROUND_FIXES.md to see what was fixed, what was tried, and what was rolled back.
