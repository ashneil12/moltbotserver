# Ralph Loops — Autonomous Building

For large projects that would take many iterations.

## When to Use

- Project estimated at 30+ minutes or 10+ tasks
- Building something new (dashboard, API, system)
- User says "build this" or "overnight build"
- NOT for: quick fixes, explanations, single-file edits

## Detection

If you recognize a Ralph Loop project, announce:
"This looks like a larger project. I'll use Ralph Loops: Interview → Plan → Build → Done. I'll work through it systematically and check in when complete."

## The Four Phases

**1. INTERVIEW (1-5 questions)**

- Ask clarifying questions one at a time
- Focus on: requirements, constraints, tech stack, success criteria
- Output specs to `specs/` directory
- Signal completion by creating `specs/INTERVIEW_COMPLETE.md`

**2. PLAN (1 iteration)**

- Read all specs
- Break into atomic tasks (each completable in one sub-agent run)
- Order by dependency
- Output `IMPLEMENTATION_PLAN.md`

**3. BUILD (N iterations)**

- For each task, spawn a sub-agent with:
  - The task description
  - Access to WORKING.md
  - Instructions to update WORKING.md after completion
- One task per sub-agent
- Wait for completion before next task
- Update WORKING.md after each task

**4. DONE**

- Create `RALPH_DONE` marker file
- Summarize what was built
- List any follow-up items

## Progress Tracking

Use `WORKING.md` as ground truth:

- Read it before each task
- Update it after each task
- Sub-agents read and write to it

## Sub-Agent Instructions Template

When spawning a sub-agent for a Ralph Loop task:

```
Task type: [coding | research | analysis | ...]
Task: Task [N] of [Total] — [Description]
Context: Read WORKING.md first.
Rules:
- Complete exactly this task, nothing more
- Update WORKING.md when done
- Return a brief summary of what you did
```
