# Creating Custom Cron Jobs

## Use the Script (Preferred — Deterministic)

**Don't hand-craft JSON.** Use `add-cron.mjs` — it validates your inputs, checks for
duplicates, and outputs exactly what will be written before you commit.

```bash
# Preview first (always)
node /app/scripts/add-cron.mjs --agent [id] --name [name] --schedule [schedule] --prompt "[prompt]" --dry-run

# Apply
node /app/scripts/add-cron.mjs --agent [id] --name [name] --schedule [schedule] --prompt "[prompt]"

# List current jobs
node /app/scripts/add-cron.mjs --agent [id] --list
```

### Schedule Formats

| Format        | Example                | Meaning              |
| ------------- | ---------------------- | -------------------- |
| `cron:<expr>` | `cron:0 8 * * *`       | Daily at 08:00 UTC   |
| `every:<Nh>`  | `every:6h`             | Every 6 hours        |
| `every:<Nm>`  | `every:30m`            | Every 30 minutes     |
| `every:<Nd>`  | `every:7d`             | Every 7 days         |
| `every:<ms>`  | `every:86400000`       | Every N milliseconds |
| `at:<iso>`    | `at:2026-03-21T14:00Z` | One-shot at UTC time |

All times are **UTC**.

### Delivery Options

```bash
# Silent (default — no output sent anywhere)
node /app/scripts/add-cron.mjs --agent [id] --name cleanup --schedule "every:7d" \
  --prompt "Clean up temp files."

# Alert the user — auto-resolves channel and recipient ID from credential store
node /app/scripts/add-cron.mjs --agent [id] --name price-alert --schedule "every:30m" \
  --prompt "Check prices. Alert if significant move detected." \
  --delivery announce --auto-to

# Check what target would be resolved before adding the job
node /app/scripts/add-cron.mjs --agent [id] --check-delivery
```

> [!TIP]
> **Always use `--auto-to` instead of specifying `--channel` and `--to` manually.**
> It reads directly from the credential store (same source enforce-config uses), so it's
> always correct regardless of which channel the user happens to be on.

> [!WARNING]
> If `--auto-to` reports no target found, run `--check-delivery` to diagnose.
> The credential file `<channel>-<agentId>-allowFrom.json` must exist in the credentials directory.

### Other Flags

| Flag          | Effect                                                     |
| ------------- | ---------------------------------------------------------- |
| `--wake now`  | Run immediately when triggered (default: `next-heartbeat`) |
| `--idle-only` | Only run when the agent has no active tasks                |
| `--one-shot`  | Auto-delete after first run (great for follow-up tasks)    |

---

## What the Script Checks

1. **Duplicate detection** — fails if a job with the same name already exists
2. **Schedule validation** — rejects malformed cron expressions and unknown formats
3. **Delivery validation** — warns if `--to` doesn't look like a numeric ID
4. **Workspace validation** — fails if the agent workspace doesn't exist

---

## If You Must Use the `cron` Tool Directly

Only do this for jobs that can't be expressed via the script (rare). Follow this pattern:

```json
{
  "action": "add",
  "job": {
    "name": "descriptive-name",
    "sessionTarget": "isolated",
    "schedule": { "kind": "cron", "expr": "0 8 * * *" },
    "payload": {
      "kind": "agentTurn",
      "message": "Your detailed prompt here"
    },
    "delivery": {
      "mode": "announce",
      "channel": "<channel>",
      "to": "<numeric_recipient_id>"
    }
  }
}
```

### Rules for Manual Usage

1. **Always use `sessionTarget: "isolated"`** for `agentTurn` payloads
2. **Always set explicit `delivery.channel` and `delivery.to`** when using `announce` mode
3. **Never use usernames/handles as `to` values** — use numeric/internal IDs
4. **Run `cron list` first** to check for duplicates

---

## Recipient ID Formats by Channel

| Channel    | Format          | Example                | Notes                   |
| ---------- | --------------- | ---------------------- | ----------------------- |
| `telegram` | Numeric chat ID | `"5614099189"`         | **Never use usernames** |
| `discord`  | Snowflake ID    | `"123456789012345678"` | Numeric only            |
| `whatsapp` | Phone number    | `"15551234567"`        | E.164 without `+`       |
| `slack`    | Channel/user ID | `"C01ABC23DEF"`        | Slack's internal format |

**Finding your Telegram ID**: Your session key contains it. E.g.,
`agent:main:telegram:direct:5614099189` → `to: "5614099189"`

---

## Common Operations

```bash
# List all jobs for an agent
node /app/scripts/add-cron.mjs --agent [id] --list

# Or with the cron tool:
{ "action": "list" }

# Trigger a job manually (for testing)
{ "action": "run", "jobId": "<job_id>" }

# Disable a job
{ "action": "update", "jobId": "<job_id>", "patch": { "enabled": false } }

# Delete a job
{ "action": "remove", "jobId": "<job_id>" }

# Update delivery target
{
  "action": "update",
  "jobId": "<job_id>",
  "patch": {
    "delivery": { "mode": "announce", "channel": "telegram", "to": "5614099189" }
  }
}
```
