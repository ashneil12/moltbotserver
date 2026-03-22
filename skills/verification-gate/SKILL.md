---
name: verification-gate
description: 'Evidence-before-claims gate. Use BEFORE: (1) claiming work is complete or fixed, (2) reporting test/build/lint status, (3) committing or creating PRs, (4) expressing satisfaction ("Done!", "Fixed!", "All tests pass"). Core rule: if you have not run the verification command in THIS response, you cannot claim it passes.'
---

# Verification Gate

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this gate is violating the spirit of verification.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim                    | Requires                               | Not Sufficient                       |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| "Tests pass"             | Test command output showing 0 failures | Previous run, "should pass", memory  |
| "Linter clean"           | Linter output showing 0 errors         | Partial check, extrapolation         |
| "Build succeeds"         | Build command exit code 0              | Linter passing, "logs look good"     |
| "Bug fixed"              | Test original symptom: passes          | Code changed, assumed fixed          |
| "Agent completed"        | VCS diff shows changes                 | Agent reports "success"              |
| "Requirements met"       | Line-by-line checklist                 | Tests passing (tests ≠ requirements) |
| "No regressions"         | Full test suite pass                   | Subset pass                          |
| "Works on all platforms" | Tested on all platforms                | Tested on one                        |

## Red Flags - STOP

If you catch yourself:

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", "Fixed!")
- About to commit/push/PR without verification
- Trusting agent success reports without independent check
- Relying on partial verification ("spot-checked a few")
- **ANY wording implying success without running verification**

**ALL of these mean: STOP. Run verification FIRST.**

## Rationalization Prevention

| Excuse                      | Reality                        |
| --------------------------- | ------------------------------ |
| "Should work now"           | RUN the verification           |
| "I'm confident"             | Confidence ≠ evidence          |
| "Just this once"            | No exceptions                  |
| "Linter passed"             | Linter ≠ compiler ≠ tests      |
| "Agent said success"        | Verify independently           |
| "Partial check is enough"   | Partial proves nothing         |
| "I saw it work earlier"     | "Earlier" ≠ "now"              |
| "The change is trivial"     | Trivial changes break things   |
| "Tests are slow"            | Slow verification > fast lies  |
| "I can verify after commit" | Commit = claim. Verify before. |

## Key Patterns

**Tests:**

```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct" / "I'm confident"
```

**Build:**

```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**

```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete" (tests ≠ requirements)
```

**Agent delegation:**

```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

**Bug fixes:**

```
✅ Reproduce bug → Apply fix → Reproduce again → Bug gone → Report with evidence
❌ "Fixed the code, should be resolved"
```

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.

---

_From [obra/superpowers](https://github.com/obra/superpowers) verification-before-completion — MIT License_
