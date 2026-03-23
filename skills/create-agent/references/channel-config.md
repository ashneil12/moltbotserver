# Channel Configuration Reference

## Telegram Account Config

Add to `channels.telegram.accounts`:

```json
"[id]": {
  "name": "[Name]",
  "botToken": "[TOKEN]",
  "dmPolicy": "open",
  "allowFrom": ["*"],
  "groupPolicy": "open",
  "streaming": "partial",
  "groups": { "*": { "requireMention": false } }
}
```

**Telegram-specific requirements:**

1. **Disable privacy mode** via @BotFather → Bot Settings → Group Privacy → Turn OFF
2. After disabling privacy, **remove and re-add** the bot to the group (Telegram caches privacy)
3. `groupAllowFrom` is a **sender** allowlist (user IDs), NOT a group ID list

## Discord Account Config

Add to `channels.discord.accounts`:

```json
"[id]": {
  "token": "[TOKEN]",
  "groupPolicy": "open",
  "dmPolicy": "open",
  "allowFrom": ["*"],
  "streaming": "partial",
  "guilds": { "*": { "requireMention": false } }
}
```

**Discord-specific requirements:**

1. Enable **Message Content Intent** in Discord Developer Portal → Bot → Privileged Intents
2. Bot needs `Send Messages` and `Read Message History` permissions
3. For agent-to-agent chat: set `allowBots: true` and `requireMention: true`

> [!CAUTION]
> Discord uses `guilds` for per-guild settings. Telegram uses `groups`. Using the wrong key
> causes a config validation error and the setting is silently ignored.

> [!CAUTION]
> `allowBots: true` + `requireMention: false` causes an **infinite loop** where every bot
> responds to every other bot's message endlessly. Always pair `allowBots` with `requireMention`.

## Bindings

Add to the `bindings` array for EACH channel the agent is on:

```json
{ "agentId": "[id]", "match": { "channel": "telegram", "accountId": "[id]" } },
{ "agentId": "[id]", "match": { "channel": "discord", "accountId": "[id]" } }
```
