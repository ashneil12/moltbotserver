---
name: systematic-debugging
description: 'Root-cause-first debugging process. Use when: (1) any test failure, build error, or unexpected behaviour, (2) a fix attempt already failed, (3) under time pressure (systematic is faster than guessing), (4) multi-component issues spanning services, configs, or pipelines. Triggers on: "debug", "why is this broken", "fix this error", "tests failing", "not working". Do NOT skip for "simple" bugs — simple bugs have root causes too.'
metadata: { "openclaw": { "emoji": "🔍" } }
---

# Systematic Debugging

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed? Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather Evidence in Multi-Component Systems**

   When a system has multiple boundaries (CI → build → deploy, API → service → DB):

   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   THEN investigate that specific component
   ```

   Example diagnostic:

   ```bash
   # Layer 1: Env vars
   echo "=== Env check ==="
   env | grep RELEVANT_VAR || echo "NOT SET"

   # Layer 2: Config
   echo "=== Config state ==="
   cat /path/to/config | grep key_setting

   # Layer 3: Actual operation
   echo "=== Running with verbose ==="
   command --verbose 2>&1
   ```

5. **Trace Data Flow**
   - Where does the bad value originate?
   - What called this with the bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

1. **Find Working Examples** — locate similar working code in same codebase
2. **Compare Against References** — read reference implementation COMPLETELY, don't skim
3. **Identify Differences** — list every difference, however small
4. **Understand Dependencies** — what settings, config, environment does this need?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** — state clearly: "I think X is the root cause because Y"
2. **Test Minimally** — smallest possible change, one variable at a time
3. **Verify Before Continuing** — did it work? If not, form NEW hypothesis. Don't stack fixes.
4. **When You Don't Know** — say "I don't understand X." Don't pretend.

### Phase 4: Implementation

1. **Create Failing Test Case** — simplest possible reproduction, MUST have before fixing
2. **Implement Single Fix** — ONE change at a time, no "while I'm here" improvements
3. **Verify Fix** — test passes? No other tests broken? Issue actually resolved?
4. **If Fix Doesn't Work** — STOP. How many fixes attempted?
   - If < 3: Return to Phase 1
   - If ≥ 3: STOP and question the architecture (step 5)
5. **If 3+ Fixes Failed: Question Architecture**
   - Is this pattern fundamentally sound?
   - Should we refactor architecture vs. continue fixing symptoms?
   - **Discuss with the user before attempting more fixes**

## Red Flags — STOP and Follow Process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Proposing solutions before tracing data flow

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse                                     | Reality                                     |
| ------------------------------------------ | ------------------------------------------- |
| "Issue is simple, don't need process"      | Simple issues have root causes too          |
| "Emergency, no time for process"           | Systematic is FASTER than guess-and-check   |
| "Just try this first, then investigate"    | First fix sets the pattern. Do it right.    |
| "Multiple fixes at once saves time"        | Can't isolate what worked. Causes new bugs. |
| "I see the problem, let me fix it"         | Seeing symptoms ≠ understanding root cause  |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem         |

## Quick Reference

| Phase                 | Key Activities                                         | Success Criteria            |
| --------------------- | ------------------------------------------------------ | --------------------------- |
| **1. Root Cause**     | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY     |
| **2. Pattern**        | Find working examples, compare                         | Identify differences        |
| **3. Hypothesis**     | Form theory, test minimally                            | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify                               | Bug resolved, tests pass    |

---

_Adapted from [obra/superpowers](https://github.com/obra/superpowers) — MIT License_
