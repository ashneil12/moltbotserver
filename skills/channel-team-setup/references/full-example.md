# Full Working Example: 4-Agent Setup

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "kimi-coding/k2p5" },
      "sandbox": { "mode": "browser-only" }
    },
    "list": [
      { "id": "main", "sandbox": { "mode": "off" } },
      {
        "id": "solomon",
        "workspace": "/home/node/data/workspace-solomon",
        "agentDir": "/home/node/data/agents/solomon/agent",
        "sandbox": { "mode": "off" },
        "browser": { "defaultProfile": "solomon" }
      },
      {
        "id": "david",
        "workspace": "/home/node/data/workspace-david",
        "agentDir": "/home/node/data/agents/david/agent",
        "sandbox": { "mode": "off" },
        "browser": { "defaultProfile": "david" }
      },
      {
        "id": "philip",
        "workspace": "/home/node/data/workspace-philip",
        "agentDir": "/home/node/data/agents/philip/agent",
        "sandbox": { "mode": "off" },
        "browser": { "defaultProfile": "philip" }
      }
    ]
  },
  "bindings": [
    { "agentId": "main", "match": { "channel": "telegram", "accountId": "ash" } },
    { "agentId": "solomon", "match": { "channel": "telegram", "accountId": "solomon" } },
    { "agentId": "david", "match": { "channel": "telegram", "accountId": "david" } },
    { "agentId": "philip", "match": { "channel": "telegram", "accountId": "philip" } },
    { "agentId": "main", "match": { "channel": "discord", "accountId": "ash" } },
    { "agentId": "solomon", "match": { "channel": "discord", "accountId": "solomon" } },
    { "agentId": "david", "match": { "channel": "discord", "accountId": "david" } },
    { "agentId": "philip", "match": { "channel": "discord", "accountId": "philip" } }
  ],
  "channels": {
    "telegram": {
      "groupPolicy": "open",
      "groups": { "*": { "requireMention": false } },
      "accounts": {
        "ash": {
          "botToken": "...",
          "groupPolicy": "open",
          "dmPolicy": "pairing",
          "allowFrom": ["*"],
          "groups": { "*": { "requireMention": false } }
        },
        "solomon": {
          "botToken": "...",
          "groupPolicy": "open",
          "groups": { "*": { "requireMention": false } }
        },
        "david": {
          "botToken": "...",
          "groupPolicy": "open",
          "groups": { "*": { "requireMention": false } }
        },
        "philip": {
          "botToken": "...",
          "groupPolicy": "open",
          "groups": { "*": { "requireMention": false } }
        }
      }
    },
    "discord": {
      "enabled": true,
      "groupPolicy": "open",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "streaming": "partial",
      "guilds": { "*": { "requireMention": false } },
      "accounts": {
        "ash": {
          "token": "...",
          "groupPolicy": "open",
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "streaming": "partial",
          "guilds": { "*": { "requireMention": false } }
        },
        "solomon": {
          "token": "...",
          "groupPolicy": "open",
          "streaming": "partial",
          "guilds": { "*": { "requireMention": false } }
        },
        "david": {
          "token": "...",
          "groupPolicy": "open",
          "streaming": "partial",
          "guilds": { "*": { "requireMention": false } }
        },
        "philip": {
          "token": "...",
          "groupPolicy": "open",
          "streaming": "partial",
          "guilds": { "*": { "requireMention": false } }
        }
      }
    }
  }
}
```
