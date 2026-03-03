---
name: history-import
description: Import and analyze chat history from ChatGPT or Claude to learn about the user and seed identity files
---

# Chat History Import

You have a skill for importing chat history from other AI platforms (ChatGPT, Claude) into your memory. This makes all past conversations searchable and lets you learn about your user from their conversation patterns.

## When to Use This Skill

Activate when the user says anything like:

- "import my chat history"
- "import my conversations"
- "I want you to learn from my ChatGPT/Claude history"
- "analyze my previous conversations"
- `/import`

## Workflow

### Step 1: Guide the Export

Ask the user which platform they want to import from, then give them these instructions:

**ChatGPT:**

1. Go to [chatgpt.com](https://chatgpt.com) → Settings → Data Controls → Export Data → click "Export"
2. Wait for the email, download the ZIP file
3. Go to **[tmpfiles.org](https://tmpfiles.org)** → upload the ZIP → copy the direct download URL
4. Paste the URL here

**Claude:**

1. Go to [claude.ai](https://claude.ai) → Settings (bottom-left) → "Export Data" → download the file
2. Go to **[tmpfiles.org](https://tmpfiles.org)** → upload the JSON file → copy the direct download URL
3. Paste the URL here

> **Why tmpfiles.org?** Chat exports can be hundreds of MB — too large to send directly via Telegram/Discord. tmpfiles.org is free, no account needed, files auto-delete after 24 hours.

### Step 2: Download and Import

Once the user pastes a tmpfiles.org URL, download the file and run the import:

```bash
# Download the file first
curl -L "<url>" -o /tmp/chat-export.zip   # or .json for Claude

# Then import it
openclaw history-import /tmp/chat-export.zip
```

This will:

- Auto-detect the source (ChatGPT or Claude)
- Parse all conversations
- Write them as searchable markdown files to `memory/imported/{source}/`
- These are immediately searchable via `memory_search`

### Step 3: Offer Identity Analysis

After import completes, ask the user:

> I've imported your conversations — they're all searchable now. Want me to analyze them to learn about you? I'll look at a sample of your most informative conversations and propose updates to my identity files. You can review everything before I commit any changes.

If they say yes, proceed to Step 4.

### Step 4: Analyze and Propose Changes

Read a representative sample of conversations from `memory/imported/`. Focus on conversations where the user expressed themselves most (long messages, personal topics, preferences, opinions).

Extract and organize insights into these categories:

1. **User Profile** (for USER.md):
   - Name, timezone, pronouns if mentioned
   - Interests, projects, professional context
   - What they value, what annoys them
   - Communication preferences

2. **Agent Personality** (for IDENTITY.md):
   - How the user expects AI to communicate
   - Tone preferences (formal/casual, verbose/concise)
   - Patterns in what works well vs what doesn't
   - Topics the user engages with most deeply

3. **Key Facts** (for MEMORY.md):
   - Important decisions or context
   - Technical stack, tools, frameworks they use
   - Recurring topics or projects

4. **Observations** (for memory/identity-scratchpad.md):
   - Raw patterns worth tracking
   - Hypotheses about preferences (to be confirmed over time)

### Step 5: Present Summary

Show the user a clear summary of proposed changes, organized by file:

```
## Proposed Changes

### IDENTITY.md
- Communication Style: [proposed additions]
- Personal Preferences: [proposed additions]

### USER.md
- Name: [if found]
- Interests: [list]
- What Matters: [list]

### MEMORY.md
- [key facts to add]

### memory/identity-scratchpad.md
- [observations to track]
```

**Ask for explicit confirmation before making any changes.**

### Step 6: Commit Changes

If the user approves:

- **IDENTITY.md**: Append to the relevant sections. Never overwrite existing content. Add a comment marker: `<!-- imported from {source} on {date} -->`
- **USER.md**: Fill in empty fields, append new context
- **MEMORY.md**: Add a dated section with key facts
- **memory/identity-scratchpad.md**: Add observations for future reflection

Tell the user what you changed and remind them they can edit the files anytime.

## Honcho Integration

If Honcho is available (check if `HONCHO_API_KEY` environment variable is set), you can also feed the extracted user insights into Honcho's context for enhanced cross-session reasoning. This is optional and should not block the import if Honcho is unavailable.

## Important Notes

### Where to Write Personality

**Auto-detect the correct target file — do NOT hardcode one.**

Before writing personality/style changes, check your workspace:

1. Read `SOUL.md` and look for **immutability signals**: security sections ("Boundaries & Security"), `<!-- MOLTBOT CUSTOM ADDITIONS -->` markers, or any text saying "this file cannot be modified" / "security rules". If you find these → **SOUL.md is locked, write to IDENTITY.md**.
2. If `SOUL.md` has editable personality sections (like "Identity Card", "Vibe", "Communication Style") and no lock markers → **write to SOUL.md**.
3. If `IDENTITY.md` exists and has personality sections → **always prefer IDENTITY.md** for personality changes regardless.

**Rule of thumb:** If both SOUL.md and IDENTITY.md exist as separate files, IDENTITY.md is your personality target. SOUL.md is for core operating principles only.

### Other Rules

- **Never overwrite existing content** in identity files — always append
- **Always show proposed changes** before applying them
- The raw imported conversations in `memory/imported/` are permanently searchable — the user can always ask about past conversations
- If re-running analysis, check for existing `<!-- imported from -->` markers to avoid duplication
