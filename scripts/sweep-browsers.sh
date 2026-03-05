#!/usr/bin/env bash
# sweep-browsers.sh — Pull latest browser image and recreate stale containers.
#
# Usage:
#   ./sweep-browsers.sh                         # uses defaults
#   BROWSER_IMAGE=ghcr.io/foo/bar:v2 ./sweep-browsers.sh  # custom image
#   DRY_RUN=1 ./sweep-browsers.sh               # preview what would happen
#
# This script:
#   1. Pulls the latest browser image
#   2. Finds all per-agent browser containers (browser-*)
#   3. Skips compose-managed containers (moltbot-*)
#   4. Compares each container's image digest to the fresh pull
#   5. Recreates stale containers preserving env, volumes, and network
#
# Safe to run repeatedly — up-to-date containers are untouched.

set -euo pipefail

BROWSER_IMAGE="${BROWSER_IMAGE:-ghcr.io/ashneil12/moltbotserver-browser:main}"
DOCKER_NETWORK="${DOCKER_NETWORK:-moltbot_default}"
DRY_RUN="${DRY_RUN:-0}"

# Image-baked env vars we should NOT copy (they come from the Dockerfile)
SKIP_ENV_PREFIXES="PATH= DEBIAN_FRONTEND="

log()  { echo "[sweep] $(date '+%H:%M:%S') $*"; }
warn() { echo "[sweep] $(date '+%H:%M:%S') WARN: $*" >&2; }

# --- Step 1: Pull latest image ---
log "Pulling $BROWSER_IMAGE ..."
if ! docker pull "$BROWSER_IMAGE" >/dev/null 2>&1; then
  warn "Failed to pull $BROWSER_IMAGE — aborting."
  exit 1
fi

FRESH_ID=$(docker image inspect --format='{{.Id}}' "$BROWSER_IMAGE" 2>/dev/null)
if [[ -z "$FRESH_ID" ]]; then
  warn "Could not read image ID after pull — aborting."
  exit 1
fi
log "Fresh image ID: ${FRESH_ID:0:20}..."

# --- Step 2: Find per-agent browser containers ---
CONTAINERS=$(docker ps -a --filter "name=^browser-" --format '{{.Names}}' | grep -v '^moltbot-' || true)

if [[ -z "$CONTAINERS" ]]; then
  log "No per-agent browser containers found. Nothing to do."
  exit 0
fi

TOTAL=0
RECREATED=0
SKIPPED=0
FAILED=0

# --- Step 3: Check and recreate stale containers ---
for CONTAINER in $CONTAINERS; do
  TOTAL=$((TOTAL + 1))

  # Get the container's current image ID
  CONTAINER_IMAGE_ID=$(docker inspect --format='{{.Image}}' "$CONTAINER" 2>/dev/null || true)

  if [[ -z "$CONTAINER_IMAGE_ID" ]]; then
    warn "$CONTAINER: could not inspect — skipping"
    FAILED=$((FAILED + 1))
    continue
  fi

  if [[ "$CONTAINER_IMAGE_ID" == "$FRESH_ID" ]]; then
    log "✓ $CONTAINER is up-to-date"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log "→ $CONTAINER is stale (${CONTAINER_IMAGE_ID:0:20} ≠ ${FRESH_ID:0:20})"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "  [DRY RUN] would recreate $CONTAINER"
    RECREATED=$((RECREATED + 1))
    continue
  fi

  # --- Capture old container config ---

  # Env vars (skip image defaults)
  ENV_ARGS=()
  while IFS= read -r envline; do
    [[ -z "$envline" ]] && continue
    skip=0
    for prefix in $SKIP_ENV_PREFIXES; do
      if [[ "$envline" == "$prefix"* ]]; then
        skip=1
        break
      fi
    done
    [[ "$skip" == "1" ]] && continue
    ENV_ARGS+=(-e "$envline")
  done < <(docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null)

  # Volumes
  VOLUME_ARGS=()
  while IFS=$'\t' read -r vtype vsource vdest vrw; do
    [[ -z "$vtype" ]] && continue
    if [[ "$vrw" == "true" ]]; then
      VOLUME_ARGS+=(-v "${vsource}:${vdest}")
    else
      VOLUME_ARGS+=(-v "${vsource}:${vdest}:ro")
    fi
  done < <(docker inspect --format='{{range .Mounts}}{{.Type}}	{{.Source}}	{{.Destination}}	{{.RW}}{{println ""}}{{end}}' "$CONTAINER" 2>/dev/null)

  # --- Remove old container ---
  log "  Removing old container..."
  if ! docker rm -f "$CONTAINER" >/dev/null 2>&1; then
    warn "$CONTAINER: failed to remove — skipping"
    FAILED=$((FAILED + 1))
    continue
  fi

  # --- Create new container ---
  log "  Creating with fresh image..."
  if ! docker create \
    --name "$CONTAINER" \
    --restart unless-stopped \
    --user 0:0 \
    --init \
    --shm-size 2g \
    "${ENV_ARGS[@]}" \
    "${VOLUME_ARGS[@]}" \
    --label "openclaw.sandboxBrowser=1" \
    "$BROWSER_IMAGE" >/dev/null 2>&1; then
    warn "$CONTAINER: failed to create — container is gone!"
    FAILED=$((FAILED + 1))
    continue
  fi

  # --- Start container ---
  if ! docker start "$CONTAINER" >/dev/null 2>&1; then
    warn "$CONTAINER: created but failed to start"
    FAILED=$((FAILED + 1))
    continue
  fi

  # --- Connect to gateway network ---
  docker network connect "$DOCKER_NETWORK" "$CONTAINER" 2>/dev/null || true

  log "  ✓ $CONTAINER recreated and started"
  RECREATED=$((RECREATED + 1))
done

# --- Summary ---
echo ""
log "=== Sweep Complete ==="
log "  Total:     $TOTAL"
log "  Up-to-date: $SKIPPED"
log "  Recreated: $RECREATED"
log "  Failed:    $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
