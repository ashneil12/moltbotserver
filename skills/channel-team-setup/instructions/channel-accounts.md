# Channel Account Configuration

> [!IMPORTANT]
> **Use `safe-config-edit.mjs` for all config edits.** Never edit `openclaw.json` with raw shell
> redirects or string manipulation. Use: `node /app/safe-config-edit.mjs set "path.to.key" '<json-value>'`

## Telegram

```json
{
  "channels": {
    "telegram": {
      "groupPolicy": "open",
      "groups": { "*": { "requireMention": false } },
      "accounts": {
        "new-agent": {
          "name": "NewAgent",
          "botToken": "<TOKEN_FROM_BOTFATHER>",
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "groupPolicy": "open",
          "streaming": "partial",
          "groups": { "*": { "requireMention": false } }
        }
      }
    }
  }
}
```

**Telegram-specific requirements:**

1. **Disable privacy mode** via @BotFather → Bot Settings → Group Privacy → Turn OFF
2. After disabling privacy, **remove and re-add** the bot to the group (Telegram caches privacy)
3. `groupAllowFrom` is a **sender** allowlist (user IDs), NOT a group ID list
4. If `requireMention` is omitted, it defaults to `true` — bots only respond to direct @mentions

## Discord

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "groupPolicy": "open",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "streaming": "partial",
      "guilds": { "*": { "requireMention": false } },
      "accounts": {
        "new-agent": {
          "token": "<DISCORD_BOT_TOKEN>",
          "groupPolicy": "open",
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "streaming": "partial",
          "guilds": { "*": { "requireMention": false } }
        }
      }
    }
  }
}
```

**Discord-specific requirements:**

1. Enable **Message Content Intent** in the Discord Developer Portal → Bot → Privileged Intents
2. Bot needs `Send Messages` and `Read Message History` permissions
3. Bots under 100 servers can use Message Content Intent without verification
4. `@everyone` and role mentions do NOT count as direct bot mentions — set `requireMention: false`
5. Discord bots CAN see messages from other bots — enables agent-to-agent chat
6. Set `allowBots: true` on the account if you want agents to respond to each other

> [!WARNING]
> Without `allowBots: true`, Discord bots will ignore messages from other bots even with
> `requireMention: false`.

## Agent-to-Agent Communication (Discord)

The tested and recommended setup:

```json
{
  "allowBots": true,
  "guilds": { "*": { "requireMention": true } }
}
```

- `allowBots: true` — bots can see each other's messages
- `requireMention: true` — bots only respond when directly @mentioned

> [!CAUTION]
> `allowBots: true` + `requireMention: false` causes an **infinite loop** where every bot
> responds to every other bot's message endlessly.
