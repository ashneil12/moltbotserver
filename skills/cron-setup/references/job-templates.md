# Cron Job Templates

Copy-paste these templates and customize for your needs.

## Daily Report (delivered to chat)

```json
{
  "action": "add",
  "job": {
    "name": "daily-report",
    "sessionTarget": "isolated",
    "wakeMode": "now",
    "schedule": { "kind": "cron", "expr": "0 8 * * *" },
    "payload": {
      "kind": "agentTurn",
      "message": "Generate and deliver the daily report. Review all context, compile findings, and write a concise summary."
    },
    "delivery": {
      "mode": "announce",
      "channel": "<channel>",
      "to": "<recipient_id>"
    }
  }
}
```

## Silent Maintenance Task

```json
{
  "action": "add",
  "job": {
    "name": "weekly-cleanup",
    "sessionTarget": "isolated",
    "wakeMode": "next-heartbeat",
    "schedule": { "kind": "cron", "expr": "0 3 * * 0" },
    "payload": {
      "kind": "agentTurn",
      "message": "Clean up temp files and archive old logs."
    },
    "delivery": { "mode": "none" }
  }
}
```

## One-Shot Follow-Up ("Love Loop")

When you want to continue work later, create a one-shot job:

```json
{
  "action": "add",
  "job": {
    "name": "continue-data-analysis",
    "sessionTarget": "isolated",
    "wakeMode": "now",
    "schedule": { "kind": "at", "at": "2026-03-05T14:00:00Z" },
    "payload": {
      "kind": "agentTurn",
      "message": "Continue the data analysis from earlier. Pick up where you left off — check WORKING.md for the current state."
    },
    "delivery": {
      "mode": "announce",
      "channel": "<channel>",
      "to": "<recipient_id>"
    },
    "deleteAfterRun": true
  }
}
```

Use `deleteAfterRun: true` for one-shot jobs so they auto-clean after execution.
