#!/usr/bin/env python3
"""
live_state.py - Environment-specific bindings for Metacognition.
Customize this to hook into your specific agent's logs / API.

Refactored for robustness and safety.
"""

import os
import subprocess
import sys
import shlex
from typing import List, Optional

# Path to the core engine
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
META_SCRIPT = os.path.join(SCRIPT_DIR, "metacognition.py")

def run_meta(args: List[str]) -> bool:
    """
    Helper to run the metacognition script.
    Returns True if successful, False otherwise.
    """
    if not os.path.exists(META_SCRIPT):
        print(f"Error: metacognition script not found at {META_SCRIPT}", file=sys.stderr)
        return False
        
    cmd = [sys.executable, META_SCRIPT] + args
    try:
        # Check=True will raise CalledProcessError on non-zero exit
        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error running metacognition: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return False

def record_experience(summary: str, sentiment: str = "neutral") -> None:
    """
    Called by your agent when something significant happens.
    This simplifies the interface for the Agent to just say:
    `./scripts/live_state.py record "User liked the efficient Cron job"`
    """
    # Sanitize inputs (basic check)
    if not summary or not isinstance(summary, str):
        print("Error: Invalid summary provided.", file=sys.stderr)
        return

    val = 0.1 # Default small positive
    if sentiment == "positive": val = 0.5
    if sentiment == "negative": val = -0.5
    
    # We treat this as 'feedback' in the engine for now
    run_meta(["feedback", str(val), summary])

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: live_state.py [record <text> <sentiment>] | [inject]")
        return
        
    cmd = sys.argv[1]
    
    if cmd == "record":
        if len(sys.argv) < 3:
             print("Usage: live_state.py record <text> [sentiment]")
             return
             
        text = sys.argv[2]
        sentiment = sys.argv[3] if len(sys.argv) > 3 else "neutral"
        record_experience(text, sentiment)
        
    elif cmd == "inject":
        run_meta(["inject"])
        
    else:
        # Pass through generic commands safely
        # Note: We rely on sys.argv being shell-parsed already
        run_meta(sys.argv[1:])

if __name__ == "__main__":
    main()

