#!/bin/bash
# scripts/triggers/check-errors.sh
# Checks the last 100 lines of the log for "ERROR" or "Exception".
# If found, exit 0 + output (Wake Agent).
# If not found, exit 1 or silent (Sleep).

LOG_FILE="/tmp/openclaw-gateway.log" # Adjust if your logs are elsewhere
MAX_LINES=100

if [ ! -f "$LOG_FILE" ]; then
    # Log file not found? Maybe silent, or maybe alert if critical.
    # For now, stay silent to avoid spam if logs rotate.
    exit 1
fi

# Grep for errors, ignoring known false positives if needed
ERRORS=$(tail -n "$MAX_LINES" "$LOG_FILE" | grep -iE "error|exception|fail" | grep -v "ignored_pattern")

if [ -n "$ERRORS" ]; then
    echo "🚨 Errors detected in recent logs:"
    echo "$ERRORS"
    exit 0
fi

# No errors? Silent.
exit 1
