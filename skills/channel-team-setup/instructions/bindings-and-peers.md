# Bindings

Every account-agent pair needs a binding for EACH channel:

```json
{
  "bindings": [
    { "agentId": "new-agent", "match": { "channel": "telegram", "accountId": "new-agent" } },
    { "agentId": "new-agent", "match": { "channel": "discord", "accountId": "new-agent" } }
  ]
}
```
