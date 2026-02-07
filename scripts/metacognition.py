#!/usr/bin/env python3
"""
metacognition.py - Self-evolving metacognitive lens for OpenClaw agents.
Source: https://github.com/velumkai/metacognition-skill

Refactored for robustness, atomic writes, and improved error handling.
"""

import json
import os
import sys
import time
import argparse
import random
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

# --- Configuration ---
# Robustly determine workspace directory
WORKSPACE_DIR = os.environ.get("CLAWD_WORKSPACE")
if not WORKSPACE_DIR:
    # Fallback: assume scripts/metacognition.py -> project_root -> workspace
    current_script = Path(__file__).resolve()
    # Check if we are in a 'scripts' directory
    if current_script.parent.name == 'scripts':
        # scripts/metacognition.py -> parent is project root
        WORKSPACE_DIR = str(current_script.parent.parent)
    else:
        # Fallback to current working directory
        WORKSPACE_DIR = os.getcwd()

# Define paths
MEMORY_DIR = os.path.join(WORKSPACE_DIR, "memory")
MEMORY_FILE = os.path.join(MEMORY_DIR, "metacognition.json")
IDENTITY_FILE = os.path.join(WORKSPACE_DIR, "IDENTITY.md")

# Default structure
DEFAULT_MEMORY: Dict[str, Any] = {
    "perceptions": [],
    "curiosities": [],
    "history": [],
    "meta_observations": [],
    "stats": {
        "cycles": 0,
        "last_run": 0
    }
}

# --- Helpers ---

def timestamp() -> float:
    """Return current timestamp."""
    return time.time()

def time_str() -> str:
    """Return formatted time string."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def load_memory() -> Dict[str, Any]:
    """Load memory from JSON file with error handling."""
    if not os.path.exists(MEMORY_FILE):
        return DEFAULT_MEMORY.copy()
    try:
        with open(MEMORY_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading memory from {MEMORY_FILE}: {e}", file=sys.stderr)
        # Return default memory, but maybe we should backup corrupt file?
        return DEFAULT_MEMORY.copy()

def save_memory(data: Dict[str, Any]) -> bool:
    """
    Save memory to JSON file atomically to prevent corruption.
    Writes to a temp file first, then renames.
    """
    # Ensure directory exists
    try:
        os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
        
        # Write to temp file
        fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(MEMORY_FILE), text=True)
        try:
            with os.fdopen(fd, 'w') as f:
                json.dump(data, f, indent=2)
            
            # Atomic rename
            os.replace(temp_path, MEMORY_FILE)
            return True
        except Exception as e:
            print(f"Error writing memory to temp file: {e}", file=sys.stderr)
            os.remove(temp_path)
            return False
            
    except Exception as e:
        print(f"Error saving memory: {e}", file=sys.stderr)
        return False

# --- Core Logic ---

def decay_perceptions(memory: Dict[str, Any]) -> Dict[str, Any]:
    """Weakens unused perceptions over time."""
    now = timestamp()
    kept = []
    
    # Ensure perceptions list exists
    if "perceptions" not in memory:
        memory["perceptions"] = []
        
    for p in memory["perceptions"]:
        # Calculate decay based on time since last reinforcement
        last_reinforced = p.get("last_reinforced", now)
        days_since = (now - last_reinforced) / 86400.0
        
        # Decay rate: 0.01 per day
        decay_amount = 0.01 * days_since
        
        current_strength = p.get("strength", 0.5)
        new_strength = max(0.0, current_strength - decay_amount)
        
        p["strength"] = new_strength
        
        # Cull weak perceptions (strength <= 0.1)
        if p["strength"] > 0.1:
            kept.append(p)
    
    memory["perceptions"] = kept
    return memory

def cmd_add_perception(args: argparse.Namespace) -> None:
    """Add a new perception."""
    memory = load_memory()
    
    perception = {
        "id": f"p_{int(timestamp())}",
        "statement": args.statement,
        "strength": float(args.strength),
        "domain": args.domain,
        "created_at": timestamp(),
        "last_reinforced": timestamp()
    }
    
    if "perceptions" not in memory:
        memory["perceptions"] = []
        
    memory["perceptions"].append(perception)
    
    if save_memory(memory):
        print(f"Added perception: {perception['statement']}")
    else:
        print("Failed to save perception.")

def cmd_feedback(args: argparse.Namespace) -> None:
    """Record positive/negative feedback."""
    memory = load_memory()
    try:
        val = float(args.value) # 1.0 or -1.0
    except ValueError:
        print(f"Invalid feedback value: {args.value}", file=sys.stderr)
        return
        
    context = args.context
    
    event = {
        "type": "feedback",
        "value": val,
        "context": context,
        "timestamp": timestamp()
    }
    
    if "history" not in memory:
        memory["history"] = []
        
    memory["history"].append(event)
    
    if save_memory(memory):
        print("Feedback recorded.")
    else:
        print("Failed to record feedback.")

def cmd_curiosity_add(args: argparse.Namespace) -> None:
    """Add a new curiosity/question."""
    memory = load_memory()
    
    curiosity = {
        "id": f"c_{int(timestamp())}",
        "question": args.question,
        "intensity": float(args.intensity),
        "status": "active",
        "created_at": timestamp()
    }
    
    if "curiosities" not in memory:
        memory["curiosities"] = []
        
    memory["curiosities"].append(curiosity)
    
    if save_memory(memory):
        print(f"Added curiosity: {curiosity['question']}")
    else:
        print("Failed to save curiosity.")

def cmd_inject(args: argparse.Namespace) -> None:
    """Compiles connection into IDENTITY.md."""
    # Check if IDENTITY.md exists
    if not os.path.exists(IDENTITY_FILE):
        print(f"IDENTITY.md not found at {IDENTITY_FILE}", file=sys.stderr)
        return

    memory = load_memory()
    memory = decay_perceptions(memory)
    
    # Sort perceptions by strength
    sorted_perceptions = sorted(memory.get("perceptions", []), key=lambda x: x.get("strength", 0), reverse=True)
    top_perceptions = sorted_perceptions[:10] # Top 10
    
    # Sort curiosities
    active_curiosities = [c for c in memory.get("curiosities", []) if c.get("status") == "active"]
    active_curiosities.sort(key=lambda x: x.get("intensity", 0), reverse=True)
    top_curiosities = active_curiosities[:3]
    
    # Build text block
    content = []
    content.append("<!-- LIVE_STATE_START -->")
    content.append("## Metacognitive Lens (Self-Evolving)")
    
    if top_perceptions:
        content.append("\n**Current Perceptions (Learned Code)**:")
        for p in top_perceptions:
            content.append(f"- {p['statement']} (strength: {p['strength']:.2f})")
    else:
        content.append("\n_No active perceptions yet._")
            
    if top_curiosities:
        content.append("\n**Active Curiosities (Explore These)**:")
        for c in top_curiosities:
            content.append(f"- {c['question']}")
    else:
        content.append("\n_No active curiosities yet._")
            
    content.append(f"\n*Last updated: {time_str()} | Cycle: {memory['stats']['cycles']}*")
    content.append("<!-- LIVE_STATE_END -->")
    
    block = "\n".join(content)
    
    # Inject into IDENTITY.md
    try:
        with open(IDENTITY_FILE, 'r') as f:
            raw = f.read()
            
        start_tag = "<!-- LIVE_STATE_START -->"
        end_tag = "<!-- LIVE_STATE_END -->"
        
        if start_tag in raw and end_tag in raw:
            # Replace existing block
            pre = raw.split(start_tag)[0]
            try:
                post = raw.split(end_tag)[1]
                new_content = pre.rstrip() + "\n\n" + block + "\n\n" + post.lstrip()
            except IndexError:
                 print("Error parsing IDENTITY.md markers.", file=sys.stderr)
                 return
        else:
            # markers not found, try to append
            print("Markers not found in IDENTITY.md. Appending to end.", file=sys.stderr)
            new_content = raw + "\n\n" + block
            
        with open(IDENTITY_FILE, 'w') as f:
            f.write(new_content)
            
        memory["stats"]["cycles"] += 1
        memory["stats"]["last_run"] = timestamp()
        save_memory(memory)
        print("Injected metacognition into IDENTITY.md")
        
    except Exception as e:
        print(f"Error injecting into IDENTITY.md: {e}", file=sys.stderr)

def cmd_status(args: argparse.Namespace) -> None:
    memory = load_memory()
    print(f"Cycles: {memory['stats'].get('cycles', 0)}")
    print(f"Perceptions: {len(memory.get('perceptions', []))}")
    print(f"Curiosities: {len(memory.get('curiosities', []))}")
    
# --- Main CLI ---

def main() -> None:
    parser = argparse.ArgumentParser(description="Metacognition Skill")
    subs = parser.add_subparsers(dest="command")
    
    # Status
    subs.add_parser("status")
    
    # Add Perception
    p_add = subs.add_parser("add", help="Add perception")
    p_add.add_argument("type", choices=["perception"]) # strict for now to match interface
    p_add.add_argument("statement", help="The perception text")
    p_add.add_argument("strength", type=float, help="0.0 to 1.0")
    p_add.add_argument("domain", help="Category tag")
    
    # Feedback
    p_feed = subs.add_parser("feedback")
    p_feed.add_argument("value", help="1.0 or -1.0")
    p_feed.add_argument("context", help="Description")
    
    # Curiosity
    p_cur = subs.add_parser("curiosity")
    cur_subs = p_cur.add_subparsers(dest="subcommand")
    c_add = cur_subs.add_parser("add")
    c_add.add_argument("question")
    c_add.add_argument("intensity", type=float)
    
    # Inject
    subs.add_parser("inject")
    
    args = parser.parse_args()
    
    if args.command == "status":
        cmd_status(args)
    elif args.command == "add" and args.type == "perception":
        cmd_add_perception(args)
    elif args.command == "feedback":
        cmd_feedback(args)
    elif args.command == "curiosity" and args.subcommand == "add":
        cmd_curiosity_add(args)
    elif args.command == "inject":
        cmd_inject(args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

