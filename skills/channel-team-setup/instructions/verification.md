# Verification Steps

## Config Validation

Before deploying, validate the config:

```bash
docker exec <container> python3 -c "import json; json.load(open('/home/node/data/openclaw.json')); print('Valid JSON')"
```

## Apply Changes

Config changes to `groupPolicy`, `groups`/`guilds`, `accounts`, and `bindings` are usually
hot-reloaded. If hot-reload fails or the change requires a restart (e.g., new Discord tokens),
restart the container:

```bash
docker restart <container>
```

## Verify Bots Started

```bash
docker logs <container> --since 30s 2>&1 | grep -iE 'starting provider|logged in'
```

Expected output should show each account starting:

```
[telegram] [new-agent] starting provider (@NewAgentBot)
[discord] [new-agent] starting provider (@NewAgent)
```

## Test Group Messaging

1. Send a message in the group without mentioning any bot
2. All bots with `requireMention: false` should respond
3. Check logs for errors: `docker logs <container> --since 2m 2>&1 | grep -iE 'error|failed|blocked'`
