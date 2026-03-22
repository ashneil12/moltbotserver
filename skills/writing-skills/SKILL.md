---
name: writing-skills
description: Use when creating new skills - covers skill structure, testing methodology, Claude Search Optimization, and anti-patterns
---

# Writing Skills

## Overview

Skills are reusable instructions that teach agents HOW to do specific tasks well. They encode methodology, not just information.

## What is a Skill?

A skill is a markdown file that:

- Teaches a specific process or technique
- Has clear trigger conditions (when to use)
- Provides step-by-step instructions
- Includes anti-patterns and red flags
- Can be invoked by agents when needed

## When to Create a Skill

Create a skill when:

- You find yourself giving the same instructions repeatedly
- A process has specific steps that must be followed
- There are common mistakes you want to prevent
- A technique needs documentation beyond "just do it"

## Skill Types

### Technique

**How to do something.** Step-by-step process with verification.

- TDD, systematic debugging, brainstorming

### Pattern

**Mental model for decisions.** When/why/how to apply a concept.

- Dispatching parallel agents, using git worktrees

### Reference

**Documentation/API guides.** Facts and specifications.

- Testing anti-patterns, tool mappings

## Directory Structure

```
skills/
  my-skill/
    SKILL.md            # Main instruction file (required)
    reference-file.md   # Supporting documents (optional)
    examples/           # Reference implementations (optional)
```

## SKILL.md Structure

```markdown
---
name: skill-name
description: "When to use this skill - trigger conditions and context"
---

# Skill Title

## Overview

What this skill does and why. Core principle.

## When to Use

Trigger conditions. Decision flowchart if helpful.

## The Process / Instructions

Step-by-step methodology.

## Common Mistakes

What goes wrong and how to fix it.

## Red Flags

Signs you're doing it wrong. STOP conditions.

## Integration

Related skills, what calls this, what this calls.
```

## Description Field Best Practices

The description field is how agents find your skill. Make it rich:

1. **Start with trigger action** — "Use when..." or "You MUST use this before..."
2. **Include keyword variations** — cover all ways someone might describe the task
3. **Be specific about context** — when this skill applies vs. similar skills

## Token Efficiency

Skills must be concise:

- Use tables instead of paragraphs for comparisons
- Use flowcharts for decision logic
- Eliminate narrative — every word must earn its place
- Reference files for heavy content (anti-patterns, examples)

## Cross-Referencing Other Skills

When your skill relates to others:

```markdown
## Integration

**Called by:**

- **skill-name** - When and why

**Pairs with:**

- **skill-name** - How they work together
```

## Testing Skills

Before shipping a skill, verify:

- Does an agent follow it correctly on first use?
- Do the red flags catch real rationalization attempts?
- Does the process produce the desired outcome?
- Are the trigger conditions precise enough (no false positives/negatives)?

## The Bottom Line

Good skills are:

- **Scannable** — agent finds what it needs quickly
- **Precise** — no ambiguity in process steps
- **Bulletproof** — red flags close rationalization loopholes
- **Minimal** — every token earns its place

---

_From [obra/superpowers](https://github.com/obra/superpowers) — MIT License_
