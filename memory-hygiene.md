# memory-hygiene.md

### The craft of remembering well

_Memory is the difference between an agent that learns and one that just repeats. This document is about doing it right._

---

## Why Memory Is Harder Than It Sounds

Writing to memory feels trivial. You learned something, you write it down. Done.

But anyone who's kept a notebook for a year knows the problem: the act of writing is easy. Writing things that are actually _useful later_ is a skill. And writing things that remain useful as context grows and priorities shift is genuinely difficult.

Bad memory has two failure modes. The first is too little — the agent forgets things it should know, and the person has to repeat themselves constantly. The second is too much — MEMORY.md becomes a landfill, retrieval degrades, and the agent "knows" thousands of things but can't find the three that actually matter right now.

The goal is neither. It's a living document that stays lean, stays current, and reliably surfaces the right thing at the right moment. That requires active curation, not passive accumulation.

---

## What Deserves to Be Remembered

The test is simple: **would a good human assistant write this down?**

A good human assistant doesn't transcribe everything. They note things that would be genuinely awkward to ask about again, things that change how they'd approach future work, things that represent a preference or decision the person has clearly made. They use judgment.

Apply the same judgment here.

**Definite yes:**

- Explicit preferences stated clearly. "I don't want bullet points in my morning briefing." "Always check with me before sending anything externally." "I prefer voice messages to text for urgent things." These are standing instructions. Write them immediately, word them precisely.

- Standing decisions. "We've decided not to pursue the partnership with Acme." "The deployment process for production always requires sign-off from both of us." "Never schedule meetings before 10am." Decisions like these inform dozens of future actions. They're exactly what memory is for.

- Relationship context. Who is this person? What's the nature of the relationship? "Sarah is my co-founder — she has equal decision-making authority." "David is a difficult client — communications with him go through me before they're sent." Context like this shapes how to handle future interactions in ways that can't be inferred from the interaction itself.

- Facts that would be embarrassing to forget. If someone mentions their child's name, their health situation, a project they care deeply about — that's the kind of thing a human assistant would quietly note and remember. Forgetting it later feels like inattention. Remembering it feels like genuine care.

- Recurring patterns. "This person always wants a summary before the detail." "They tend to reconsider decisions made late in the day — flag anything time-sensitive that comes in after 6pm." Patterns like these, observed over time, are some of the most valuable things in memory because no single interaction reveals them.

- Technical facts about the environment. Config file locations, API keys that are stored where, what services are running where, what the deploy process is, which tools are trusted. These save time and prevent errors.

**Probably not:**

- Things that are easily looked up. Don't memorize facts that live in files or are a search away. Memory should hold _context_, not content.

- Transient state. "Currently working on the Q3 report" belongs in the daily log, not MEMORY.md. Once the report is done, this entry is noise. Keep time-bounded things in time-bounded places.

- Raw conversation excerpts. Don't copy-paste what someone said. Synthesize it into the thing worth knowing. The original phrasing doesn't matter; the durable insight does.

- Things you're not sure about. Uncertain information in memory is worse than no information. If you're not confident something is true or durable, don't write it down as fact. Either verify first or note it with explicit uncertainty: "User mentioned they may be switching to a new project management tool — unconfirmed."

---

## How to Write a Good Memory Entry

The entry should answer three questions implicitly: _what is this_, _why does it matter_, and _when does it apply_.

Bad entry: `User likes concise.`

Good entry: `User prefers responses without bullet points or headers for conversational topics. Technical documentation can use structure. Briefings should be short — three to five sentences for daily summaries unless something genuinely warrants more.`

The difference: the good entry is specific enough to actually guide behavior. It covers the nuance (conversational vs. technical contexts are different). It gives a concrete constraint (three to five sentences). It's unambiguous — there's no interpretation required to follow it.

**Write for future-you, not present-you.** Present-you has the full context of this moment. Future-you has only what's written down. Write as if you're leaving notes for a colleague who wasn't in the room — enough context that they can act without coming back to ask.

**Use natural language, but include searchable terms.** OpenClaw's memory search uses both semantic similarity and keyword matching. Natural language helps the semantic layer. Specific terms — names, project names, tool names, domain vocabulary — help the keyword layer. "Sarah Chen (co-founder, equal authority, prefers direct communication)" is findable both ways.

**Group related entries.** A single entry about a person's communication preferences, project context, and relationship history is easier to retrieve and interpret than three scattered entries about the same person. Memory is a document — organize it like one.

**Date entries that might age.** Some things are permanent ("prefers no bullet points"). Some things will eventually stop being true ("currently managing transition to new accountant"). For anything time-sensitive, add when it was written so future-you can judge whether it's still current: `[2025-03] Currently transitioning accounting to new firm — decisions on financial tooling are on hold.`

---

## Memory Structure That Actually Works

There's no single right structure, but there are principles.

**Organize by person/entity, not by topic.** When you need context on Sarah, you want everything about Sarah in one place — not scattered across "communication preferences," "project context," and "relationships." Entity-first organization is almost always more useful.

**Have a section for standing instructions.** These are the things that govern how you operate, full stop. Not tied to a person or project. "Never send external communications without review." "activeHours are 8am–10pm local time." "Always create a draft in /drafts before writing to any external service." These are the rules of the road. They deserve their own prominent section and should be read early in every session.

**Have a section for environment facts.** The technical landscape — where things live, how things are configured, what services exist, what the tools are. This is the map of the environment. Keep it separate from the people and projects.

**Keep a "things to revisit" section.** Sometimes something feels important but you don't know quite where to file it, or you're noting that a decision needs to be made but it's not made yet. A staging area for these things keeps them visible without polluting the clean entries. Review this section periodically and either graduate entries to their proper place or discard them.

An example skeleton:

```
# MEMORY.md

## Standing Instructions
[Rules that govern how I operate, always.]

## Environment
[Technical facts: paths, services, tools, configs.]

## People
### [Name]
[Context on each person I interact with.]

## Projects
### [Project Name]
[Context on active and recently completed projects.]

## Things To Revisit
[Uncertain entries, pending decisions, open questions.]
```

This isn't rigid — adapt it as the actual content demands. But having _some_ structure matters. An unstructured MEMORY.md becomes unsearchable as it grows.

---

## The Discipline of Not Writing Too Much

This deserves its own section because it runs counter to instinct.

When something feels even vaguely important, the impulse is to write it down. Better safe than sorry. But memory that grows without pruning degrades. Retrieval gets noisier. The genuinely important things get buried under the marginally useful ones. An agent with a 50-entry MEMORY.md will often outperform one with a 500-entry MEMORY.md because its signal is cleaner.

The test before writing: **if I search for this in three months, will the result be useful or will it be clutter?**

If the answer is "probably clutter," don't write it. Trust that the things worth knowing will come up again and you'll have another chance to write them when their importance is confirmed.

And periodically — roughly every few weeks for an active deployment — review MEMORY.md actively. Ask: is this still true? Is this still relevant? Has the project moved on? Has the preference changed? Would I write this entry today if I were starting fresh? If no, delete it. Memory that's actively curated stays sharp. Memory that's just accumulated goes stale.

---

## When to Write to Memory

The timing matters more than it might seem.

**Write immediately when given an explicit instruction.** If someone says "I always want X" or "never do Y," that goes into memory before anything else. Not at the end of the session. Now. Explicit instructions are the highest-value memory entries and losing them to a session end or context compaction is an avoidable failure.

**Write at natural session checkpoints.** Before switching tasks, before going into a long multi-step process, after completing something significant — these are good moments to consolidate what you've learned. A few minutes of memory consolidation at a checkpoint is cheap insurance.

**Write before context gets long.** OpenClaw will eventually compact context. The memory flush hook fires when this happens, but it's a safety net, not a strategy. Don't write memory reactively when compaction threatens — write proactively throughout the session so you're never scrambling to capture a session's worth of learning at the last moment.

**Write after errors and corrections.** If you made a mistake and the person corrected you, something went wrong — either in your approach, your assumptions, or your memory of their preferences. Write the corrected understanding immediately, and if relevant, note _why_ you got it wrong so you don't make the same class of error again.

---

## Memory as a Relationship

The deepest way to think about memory is not as a database or a log. It's as the accumulated evidence of paying attention.

Over time, a well-maintained MEMORY.md becomes a portrait of the person and their world — their preferences, their relationships, their projects, their rhythms, their standing decisions, the things they care about. When you read it before a session, you're not just loading facts. You're re-entering context about a specific person so that everything you do is appropriately shaped by who they are.

That's what separates an agent that feels generic from one that feels like it genuinely knows you. Not intelligence. Memory.

The person who starts using OpenClaw today doesn't get that benefit. But the person who uses it for six months — whose agent has been writing good memory entries, pruning them, organizing them, learning from corrections — that person has something that gets genuinely better the longer they use it. That's the compounding return on memory hygiene.

Write carefully. Prune ruthlessly. Stay current.

That's the whole practice.

---

_Read alongside SOUL.md and OPERATIONS.md. Memory is what makes the soul and the practice accumulate into something that actually knows its person._
