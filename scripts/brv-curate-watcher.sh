#!/bin/bash
# =============================================================================
# brv-curate-watcher.sh — ByteRover file-change watcher
# =============================================================================
# Monitors key agent identity/memory files in the workspace and runs
# `brv curate` only when a file's content has changed (sha256 diff).
# Runs as a background daemon on a configurable poll interval.
#
# Files watched (relative to WORKSPACE_DIR):
#   MEMORY.md         — long-term memory store
#   USER.md           — user profile/preferences
#   IDENTITY.md       — agent's self-model
#   SOUL.md           — agent operating principles (curated for personality)
#   diary/*.md        — chronological experience log
#
# Files intentionally NOT watched:
#   WORKING.md        — transient scratchpad (too noisy)
#   workspace code    — qmd handles raw file search; ByteRover is not for code
#
# Usage:
#   bash brv-curate-watcher.sh [--workspace DIR] [--interval SECONDS] [--once]
#   --workspace  Override workspace directory (default: $WORKSPACE_DIR or /home/node/workspace)
#   --interval   Poll interval in seconds (default: 300 = 5 minutes)
#   --once       Run one check pass then exit (for testing / cron use)
# =============================================================================

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────
INTERVAL=300
WORKSPACE_DIR="${WORKSPACE_DIR:-/home/node/workspace}"
RUN_ONCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) WORKSPACE_DIR="$2"; shift 2 ;;
    --interval)  INTERVAL="$2";      shift 2 ;;
    --once)      RUN_ONCE=true;      shift   ;;
    *) echo "[brv-watcher] Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Sanity checks ────────────────────────────────────────────────────────────
if ! command -v brv &>/dev/null; then
  echo "[brv-watcher] brv not found in PATH — ByteRover curation disabled. Exiting."
  exit 0
fi

if ! command -v sha256sum &>/dev/null; then
  echo "[brv-watcher] sha256sum not found — falling back to sha1sum"
  HASH_CMD="sha1sum"
else
  HASH_CMD="sha256sum"
fi

# Checksum store dir (inside config dir so it's persistent across agent restarts)
CONFIG_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
CHECKSUM_DIR="$CONFIG_DIR/.brv-checksums"
mkdir -p "$CHECKSUM_DIR"

echo "[brv-watcher] ByteRover file-change watcher started"
echo "[brv-watcher]   workspace : $WORKSPACE_DIR"
echo "[brv-watcher]   interval  : ${INTERVAL}s"
echo "[brv-watcher]   checksums : $CHECKSUM_DIR"

# ── Core: curate a single file if content changed ────────────────────────────
curate_if_changed() {
  local abs_path="$1"
  local label
  label="$(basename "$abs_path")"

  if [ ! -f "$abs_path" ]; then
    return 0  # File doesn't exist yet — skip silently
  fi

  # Safe key for checksum filename (replace / with _)
  local key
  key="${abs_path//\//_}"
  local checksum_file="$CHECKSUM_DIR/$key"

  # Compute current hash
  local current_hash
  current_hash="$($HASH_CMD "$abs_path" 2>/dev/null | awk '{print $1}')"
  if [ -z "$current_hash" ]; then
    return 0  # Can't hash (permission error etc.) — skip
  fi

  # Compare with stored hash
  local stored_hash=""
  if [ -f "$checksum_file" ]; then
    stored_hash="$(cat "$checksum_file" 2>/dev/null || true)"
  fi

  if [ "$current_hash" = "$stored_hash" ]; then
    return 0  # No change
  fi

  # Content changed — curate it
  echo "[brv-watcher] Change detected: $label — running brv curate..."
  if brv curate "$abs_path" 2>&1; then
    echo "$current_hash" > "$checksum_file"
    echo "[brv-watcher] Curated: $label ✓"
  else
    echo "[brv-watcher] WARNING: brv curate failed for $label (non-fatal)"
    # Don't update checksum so we retry on next pass
  fi
}

# ── Build the list of files to watch ─────────────────────────────────────────
get_watched_files() {
  # Fixed identity/memory files (root of workspace)
  local fixed_files=(
    "MEMORY.md"
    "USER.md"
    "IDENTITY.md"
    "SOUL.md"
    # BrainX output files — curate so brv query can surface extracted facts/warnings
    "memory/extracted-facts.md"
    "memory/advisory-warnings.md"
    # Identity evolution history
    "memory/identity-scratchpad.md"
    # Reflection artifacts — curate so brv query surfaces self-review patterns and open work
    "memory/self-review.md"
    "memory/open-loops.md"
  )
  for f in "${fixed_files[@]}"; do
    echo "$WORKSPACE_DIR/$f"
  done

  # All diary/*.md files (discovered dynamically)
  if [ -d "$WORKSPACE_DIR/diary" ]; then
    find "$WORKSPACE_DIR/diary" -maxdepth 1 -name "*.md" -type f 2>/dev/null
  fi

  # All knowledge topic files (discovered dynamically)
  if [ -d "$WORKSPACE_DIR/memory/knowledge" ]; then
    find "$WORKSPACE_DIR/memory/knowledge" -maxdepth 1 -name "*.md" -type f 2>/dev/null
  fi

  # Yesterday's daily memory (stable — won't change during today's session)
  # Curated exactly once per day when the watcher first encounters it after midnight.
  local yesterday
  yesterday="$(date -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)"
  if [ -f "$WORKSPACE_DIR/memory/$yesterday.md" ]; then
    echo "$WORKSPACE_DIR/memory/$yesterday.md"
  fi
}

# ── Respect .searchignore for exclusions ─────────────────────────────────────
# (For future: if .searchignore has diary/ listed, skip diary curation)
# Currently only checks for an explicit opt-out env var.
BRV_CURATE_DISABLED="${OPENCLAW_BRV_CURATE_DISABLED:-false}"

# ── Main poll loop ────────────────────────────────────────────────────────────
run_check() {
  if [ "$BRV_CURATE_DISABLED" = "true" ] || [ "$BRV_CURATE_DISABLED" = "1" ]; then
    echo "[brv-watcher] Curation disabled via OPENCLAW_BRV_CURATE_DISABLED — skipping"
    return 0
  fi

  local curated=0
  while IFS= read -r file_path; do
    curate_if_changed "$file_path" && curated=$((curated + 1)) || true
  done < <(get_watched_files)
}

if [ "$RUN_ONCE" = true ]; then
  run_check
  exit 0
fi

# Daemon mode: poll forever
while true; do
  run_check || true
  sleep "$INTERVAL"
done
