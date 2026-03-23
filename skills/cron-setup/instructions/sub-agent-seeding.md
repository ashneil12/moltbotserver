# Sub-Agent Default Cron Seeding

> [!IMPORTANT]
> `enforce-config.mjs cron-seed` silently skips sub-agents that don't meet **all 5 prerequisites**.
> If a sub-agent has no cron jobs, check every item in this list before doing anything else.

The `cron-seed` command discovers sub-agents by scanning `OPENCLAW_DATA_DIR` (default
`/home/node/data`) for directories matching `workspace-*`. It then seeds
`<workspace-dir>/.openclaw/cron/jobs.json` with default jobs.

## The 5 Prerequisites

| #   | Requirement                                       | How to check                                                          | How to fix                                                                                                                                               |
| --- | ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Workspace dir at standard path**                | `ls /home/node/data/ \| grep workspace-`                              | `mkdir -p /home/node/data/workspace-<agentId>`                                                                                                           |
| 2   | **Workspace is a real directory** (not a symlink) | `ls -la /home/node/data/workspace-<agentId>` — must show `d`, not `l` | Symlinks **fail**: `readdirSync` `isDirectory()` returns `false`. Create a real dir or use patched `enforce-config.mjs` (v1.0.3+) which uses `statSync`. |
| 3   | **Credential allowFrom file exists**              | `ls /home/node/data/credentials/telegram-<agentId>-allowFrom.json`    | Create it: `{"version":1,"allowFrom":["<user_telegram_id>"]}`. Filename must match agent ID exactly.                                                     |
| 4   | **Bindings entry in `openclaw.json`**             | Check `bindings` array in config                                      | Add: `{"agentId": "<agentId>", "match": {"channel": "telegram", "accountId": "<account-name>"}}`                                                         |
| 5   | **Correct workspace path in agent config**        | Check `agents.list[*].workspace` in `openclaw.json`                   | Must be `/home/node/data/workspace-<agentId>` — NOT a custom path                                                                                        |

## What Gets Seeded

Default sub-agent jobs (excludes main-only jobs like `morning-briefing`, `self-audit-21`):

- `browser-cleanup` — every 24h
- `self-review` — every 12h
- `consciousness` — every 5h
- `deep-review` — every 48h

All default sub-agent jobs use `delivery: {"mode": "none"}`. They run silently.

## Seeding Manually

If `enforce-config.mjs cron-seed` still isn't seeding after fixing prerequisites:

```bash
docker exec moltbot-openclaw-gateway-1 node -e "
  const { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } = require('fs');
  const mainJobs = JSON.parse(readFileSync('/home/node/data/workspace-main/.openclaw/cron/jobs.json','utf8'));
  const MAIN_ONLY = new Set(['morning-briefing','self-audit-21','healthcheck-update-status','healthcheck-security-audit','openclaw-backup','diary-post-archive','auto-tidy']);
  const subJobs = mainJobs.jobs.filter(j => !MAIN_ONLY.has(j.name));
  const AGENT = '<agent-id>';
  const dir = '/home/node/data/workspace-' + AGENT + '/.openclaw/cron';
  const file = dir + '/jobs.json';
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const store = { version: 1, appliedReflection: mainJobs.appliedReflection, knownJobs: subJobs.map(j=>j.name), jobs: JSON.parse(JSON.stringify(subJobs)) };
    writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
    chmodSync(file, 0o600);
    console.log('Seeded', subJobs.length, 'jobs for', AGENT);
  } else { console.log('jobs.json already exists'); }
"
```

## Where Cron Jobs Live vs `cron.entries`

There are **two separate cron stores**:

| Store                             | Path                                                           | Used for                                             | Visible in UI? |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | -------------- |
| `cron.entries` in `openclaw.json` | `/home/node/data/openclaw.json`                                | Jobs created via dashboard UI for the **main agent** | Yes            |
| `jobs.json` in workspace          | `/home/node/data/workspace-<agentId>/.openclaw/cron/jobs.json` | Seeded default jobs for **all agents**               | No (disk-only) |

> [!NOTE]
> `cron.entries` being empty does **NOT** mean sub-agents have no cron jobs.
> Sub-agent cron is disk-based. The gateway reads `jobs.json` directly from each workspace at startup.

## Verifying Jobs Are Active

After seeding, restart the gateway and look for these log lines:

```
[telegram] [nehemiah] starting provider (@Nehemiahclawdbot)
[gateway] qmd memory startup initialization armed for agent "ocs-nehemiah"
[memory] workspace_search ready — N document(s) indexed
```

If all 3 appear, the agent is fully loaded and cron jobs will fire on schedule.

## Fixing Existing Agents with Legacy Cron Sets

If an agent has only legacy jobs, delete the stale `jobs.json` and re-seed:

```bash
rm -f /home/node/data/workspace-[id]/.openclaw/cron/jobs.json
node /app/enforce-config.mjs cron-seed

# Verify:
openclaw cron list --agent [id]
```
