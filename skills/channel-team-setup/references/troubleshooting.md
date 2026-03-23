# Channel Team Setup — Troubleshooting

## Bot Ignoring All Group Messages

| Symptom                                  | Cause                                            | Fix                                                   |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| No response at all                       | `groupPolicy: "allowlist"` with no valid entries | Set `groupPolicy: "open"`                             |
| Telegram: no response even with @mention | Privacy mode ON                                  | Disable via @BotFather                                |
| Only responds to direct @mention         | `requireMention` defaults to `true`              | Set `groups`/`guilds: {"*": {requireMention: false}}` |
| "Sandbox filesystem bridge unavailable"  | `sandbox.mode: "browser-only"` inherited         | Set `sandbox: { "mode": "off" }` per agent            |
| "No API key found for provider X"        | Missing `auth-profiles.json`                     | Copy from main agent's agentDir                       |
| Config reload rejected                   | Invalid config key (e.g., `groups` in Discord)   | Use `guilds` for Discord, `groups` for Telegram       |
| `groupAllowFrom` blocking everyone       | Contains group chat ID instead of user IDs       | Use `groupPolicy: "open"` instead                     |

## Agent-to-Agent Communication

| Platform | Can bots see bot messages?        | How to enable                                     |
| -------- | --------------------------------- | ------------------------------------------------- |
| Telegram | **No** — platform limitation      | Not possible; use application-level orchestration |
| Discord  | **Yes** — but filtered by default | Set `allowBots: true` on each Discord account     |
