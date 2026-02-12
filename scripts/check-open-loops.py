#!/usr/bin/env python3
"""
check-open-loops.py - Checks for unchecked tasks in a markdown file.
Usage: python3 check-open-loops.py /path/to/file.md
Returns:
- Exit 0 + Helper Text: If tasks found (Wakes Agent)
- Exit 1 (or 0 + No Output): If no tasks found (Agent Sleeps)
"""

import sys
import os

def main():
    if len(sys.argv) < 2:
        # No file specified? Fail silent.
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        # File doesn't exist? Fail silent.
        sys.exit(1)

    open_loops = []
    try:
        with open(filepath, 'r') as f:
            for line in f:
                stripped = line.strip()
                # Check for standard markdown checkboxes
                if stripped.startswith("- [ ]") or stripped.startswith("* [ ]"):
                    # Check if it looks like a real task (has text)
                    task_text = stripped.replace("- [ ]", "").replace("* [ ]", "").strip()
                    if task_text:
                        open_loops.append(task_text)
    except Exception as e:
        sys.exit(1)

    if not open_loops:
        # No open loops? Exit silent.
        sys.exit(1)

    # Open loops found! Print them to wake the agent.
    print(f"Found {len(open_loops)} open loops in {os.path.basename(filepath)}:")
    for loop in open_loops:
        print(f"- {loop}")

    # Exit 0 means "Success" (Script ran fine), and output means "Wake up"
    sys.exit(0)

if __name__ == "__main__":
    main()
