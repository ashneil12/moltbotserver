---
description: Create efficient, script-gated cron jobs to save tokens.
---

# Cron Trigger Skill (`triggerScript`)

Use this skill when the user asks you to "monitor", "watch", or "check" an external resource (API, file, website, etc.) on a schedule.

## The Problem
Standard cron jobs wake up the Agent (LLM) every time they run. This costs money even if there is nothing to do.

## The Solution
Use a **Trigger Script** (`triggerScript`). This is a lightweight script (Bash, Python, JS) that runs *before* the Agent.
1.  **Script runs first.**
2.  **If script exits 0 + prints text**: The Agent wakes up and receives the text.
3.  **If script exits != 0 OR prints nothing**: The Agent stays asleep. (Cost: $0).

## Decision Logic
Before creating a cron job, ask: **"Can this check be scripted?"**

### YES (Deterministic)
*   *Examples:* "Check if price < 150", "Check if file exists", "Grep for keyword".
*   **Action:** Write a script -> Set `triggerScript`.
*   **Goal:** 95% of runs should be silent (Agent sleeps).

### NO (Judgment Required / Bypass Mode)
*   *Examples:*
    *   "Read the news and tell me if it's 'sad'" (Sentiment analysis).
    *   "Correlate my calendar with the weather" (Multi-source reasoning).
    *   "Watch for 'weird' server behavior" (Anomaly detection).
*   **Action:** Create a standard Cron Job (No `triggerScript`).
*   **Reasoning:** Determining "sadness" or "weirdness" requires the LLM's brain. A script is too simple.
*   **Cost:** Standard model pricing per run.

## Implementation Steps

1.  **Write the Script**: Create a script in `scripts/triggers/` (e.g., `scripts/triggers/check-stock.sh`).
    *   *Must* verify prerequisites (curl, jq, etc.).
    *   *Must* print meaningful output ONLY when action is needed.
    *   *Must* be silent (or exit 1) when nothing is needed.

2.  **Make Executable**: `chmod +x scripts/triggers/check-stock.sh`

3.  **Register Cron Job**:
    *   Use the `cron` tool (or edit `jobs.json`).
    *   Set `payload.triggerScript` to the absolute path of your script.

## Example Script (Bash)

```bash
#!/bin/bash
# scripts/triggers/check-status.sh

# 1. output=$(curl -s https://api.status.com/current)
# 2. if [[ "$output" == *"down"* ]]; then
# 3.    echo "ALERT: System is down! Response: $output"
# 4.    exit 0  # <--- WAKES UP AGENT
# 5. fi

# 6. exit 0 # (With no output) <--- AGENT SLEEPS
```
