---
name: message-transcript
description: "Save all messages to daily markdown transcript files for easy searching"
homepage: https://docs.openclaw.ai/automation/hooks#message-transcript
metadata:
  {
    "openclaw":
      {
        "emoji": "📜",
        "events": ["message:received", "message:sent"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Message Transcript Hook

Saves all inbound and outbound messages to daily Markdown files for easy full-text search.

## What It Does

Every time a message is received or sent:

1. **Captures message details** — sender/recipient, content, timestamp, channel
2. **Appends to daily file** — Writes a Markdown entry to `<workspace>/transcripts/YYYY-MM-DD.md`
3. **Silent operation** — Runs in the background without user notifications

## Output Format

Transcript files use a clean, grep-friendly Markdown format:

```markdown
## 14:32:05 — user: +1234567890 (telegram)

Hello, how are you?

---

## 14:32:12 — assistant (telegram)

I'm doing great! How can I help?

---
```

## Use Cases

- **Search conversations**: `grep -ri "keyword" transcripts/`
- **Review daily activity**: Open any `YYYY-MM-DD.md` file
- **Debug issues**: Find exactly what was said and when
- **Audit trail**: Persistent record across all channels

## File Location

`<workspace>/transcripts/YYYY-MM-DD.md`

Default workspace: `~/.openclaw/workspace`

## Requirements

- **Config**: `workspace.dir` must be set (automatically configured during onboarding)

## Disabling

```bash
openclaw hooks disable message-transcript
```

Or via config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "message-transcript": { "enabled": false }
      }
    }
  }
}
```
