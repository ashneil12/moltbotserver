# Create Agent — Troubleshooting

| Symptom                                  | Cause                                      | Fix                                                                                        |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Agent not responding at all              | Missing binding in config                  | Check `openclaw agents list --bindings`                                                    |
| "Sandbox filesystem bridge unavailable"  | `sandbox.mode: "browser-only"` inherited   | Set `sandbox: { "mode": "off" }` on the agent                                              |
| "No API key found for provider X"        | Missing `auth-profiles.json`               | Copy from main agent's agentDir (Step 6)                                                   |
| Telegram: no response even with @mention | Privacy mode ON                            | Disable via @BotFather, re-add bot to group                                                |
| Discord: bots ignoring each other        | `allowBots` not set                        | Set `allowBots: true` on each Discord account                                              |
| Discord + Telegram key confusion         | `guilds` vs `groups` mismatch              | Discord = `guilds`, Telegram = `groups`                                                    |
| Identity bleed (agent uses main's name)  | IDENTITY.md written wrong                  | Re-read identity boundary rule, rewrite                                                    |
| Cron jobs not firing                     | Wrong agentId on jobs                      | `openclaw cron list` — verify agentId matches                                              |
| Browser not accessible                   | Container not provisioned                  | Restart gateway (auto-provisions) or run `node /app/enforce-config.mjs browser-containers` |
| Config reload rejected                   | Invalid config key                         | Validate JSON before restart                                                               |
| `groupAllowFrom` blocking everyone       | Contains group chat ID instead of user IDs | Use `groupPolicy: "open"` instead                                                          |
