# Phase 1: Interactive Onboarding

Walk the user through these steps conversationally. Do NOT dump all questions at once.

## Step 1a: Basics

Ask the user:

1. **Agent name** — What should this agent be called?
2. **Agent ID** — Suggest a lowercase version of the name. Confirm with user.
3. **Role** — What is this agent's job?
4. **One-line description** — A short tagline for the role
5. **Tool permissions** — Default is `full` (all tools: browser, exec, files, nodes, etc). Only ask if scope should be different. Options: `full` (default), `coding` (no browser/nodes/messaging), `messaging` (no exec/fs), `minimal` (session status only).

## Step 1b: Personality

Ask the user to describe the agent's personality. Guide them with:

1. **Vibe** — How should this agent come across? (skeptical, playful, analytical, warm)
2. **Communication style** — Direct? Formal? Casual? Blunt?
3. **Emoji** — What's their signature?
4. **What makes them different from the main agent?** — This helps define uniqueness

## Step 1c: Channel Setup

Ask the user which channels this agent should be available on:

### Telegram

1. Ask: "Do you have a Telegram bot token for this agent?"
2. If yes: collect the bot token
3. If no: guide them to create one via @BotFather:
   - Send /newbot to @BotFather
   - Choose a display name
   - Choose a username (must end in "bot")
   - Copy the token

### Discord

1. Ask: "Do you have a Discord bot token for this agent?"
2. If yes: collect the bot token
3. If no: guide them to create one at discord.com/developers/applications
4. **Remind**: Enable **Message Content Intent** in Developer Portal → Bot → Privileged Intents

## Step 1d: Confirmation

Summarize everything back to the user in a clean format. Ask: "Does this look right? Shall I set it up?"
