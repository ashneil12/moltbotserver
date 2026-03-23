# Agent Setup for Channel Configuration

## Add Agent to `agents.list`

Each named agent needs its own entry in `openclaw.json`:

```json
{
  "agents": {
    "list": [
      { "id": "main" },
      {
        "id": "new-agent",
        "name": "new-agent",
        "workspace": "/home/node/data/workspace-new-agent",
        "agentDir": "/home/node/data/agents/new-agent/agent",
        "sandbox": { "mode": "off" }
      }
    ]
  }
}
```

> [!IMPORTANT]
> **Sandbox MUST be `"off"` for named agents.** The default `browser-only` sandbox requires
> a filesystem bridge that doesn't support per-agent workspaces — it throws
> `"Sandbox filesystem bridge is unavailable"` at runtime.

> [!TIP]
> **Browser assignment is automatic.** The entrypoint's `enforce_browser_profiles()` function
> auto-creates a browser profile for each sub-agent pointing to `browser-<agentId>:9222`.

## Create Workspace and Agent Directories

```bash
docker exec <container> mkdir -p /home/node/data/workspace-new-agent/memory
docker exec <container> mkdir -p /home/node/data/agents/new-agent/agent
```

Copy bootstrap files from the main workspace:

```bash
docker exec <container> cp /home/node/workspace/AGENTS.md /home/node/data/workspace-new-agent/
docker exec <container> cp /home/node/workspace/SOUL.md /home/node/data/workspace-new-agent/
docker exec <container> cp /home/node/workspace/BOOTSTRAP.md /home/node/data/workspace-new-agent/
```

Copy auth profiles:

```bash
docker exec <container> cp /home/node/data/agents/main/agent/auth-profiles.json \
  /home/node/data/agents/new-agent/agent/auth-profiles.json
```

## Provision Browser Container

After adding the agent, run the provisioning script on the host:

```bash
/opt/moltbot/ensure-agent-browsers.sh
```

This script automatically:

- Reads all sub-agents from `openclaw.json`
- Generates `docker-compose.override.yml` with browser services
- Patches `Caddyfile` with per-agent noVNC routes
- Fixes volume permissions (uid 1000)
- Starts new containers and reloads Caddy

Then restart the gateway:

```bash
cd /opt/moltbot && docker compose restart openclaw-gateway
```
