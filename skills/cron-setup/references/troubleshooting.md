# Cron Troubleshooting

## "Sub-agent has no cron jobs / jobs never fire"

This is the most common failure mode. Work through in order:

1. **Check all 5 seeding prerequisites** (see `instructions/sub-agent-seeding.md`)
2. Run `enforce-config.mjs cron-seed` manually — look for `✅ Seeded cron jobs for sub-agent: <name>`
3. Check `docker logs <gateway> 2>&1 | grep workspace-<agentId>` — if no log line, the workspace path in `openclaw.json` is wrong
4. Verify the credential file name matches the agent ID exactly: `telegram-<agentId>-allowFrom.json`
5. If workspace is a symlink, enforce-config v1.0.3+ handles this — older versions silently skip

## "Job ran but no message was delivered"

1. Check the job's delivery config: `cron list` → look at `delivery`
2. If `channel` or `to` is missing → update the job with explicit targets
3. If `delivery.to` is a username (starts with `@`) → change to numeric/native ID format
4. Check `state.consecutiveErrors` — if > 0, the job is erroring

## "Job isn't running"

1. Check `enabled` is `true`
2. Check `state.nextRunAtMs` — is it in the future?
3. Check `state.consecutiveErrors` — high counts may indicate suppression

## "File not found" errors in job output

1. Check which agent the job is assigned to (`agentId`)
2. Verify the files exist in that agent's workspace
3. If referencing another agent's files, use absolute paths
