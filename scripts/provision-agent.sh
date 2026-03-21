#!/usr/bin/env bash
# provision-agent.sh — Deterministic agent provisioning script
#
# This script handles ALL mechanical steps of creating a new agent.
# The AI's only job is generating IDENTITY.md and role.md content,
# then calling this script with the right flags.
#
# Usage:
#   bash /app/scripts/provision-agent.sh --id <agent-id> --name <display-name> [options]
#
# Options:
#   --id <id>           Agent ID (required, lowercase, no spaces)
#   --name <name>       Display name (required)
#   --emoji <emoji>     Agent emoji (optional, default: 🤖)
#   --data-dir <path>   Data directory (default: /home/node/data)
#   --verify-only       Only run verification, don't create anything
#   --dry-run           Show what would be done without doing it
#
# What this script does (in order):
#   1. Validates inputs
#   2. Creates workspace directory structure
#   3. Copies operational files from main workspace
#   4. Seeds memory directory with templates
#   5. Copies shared skills
#   6. Links shared team directory
#   7. Copies auth profiles from main agent
#   8. Creates agent directory structure
#   9. Marks workspace as bootstrapped
#  10. Runs verification checks
#
# What this script does NOT do (AI's job):
#   - Write IDENTITY.md content (personality, vibe — creative)
#   - Write role.md content (role description — creative)
#   - Add channel bindings to openclaw.json (requires user-specific tokens)
#   - Register the agent via `openclaw agents add` (CLI command)
#   - Set identity via `openclaw agents set-identity` (CLI command)
#   - Restart the gateway (user-initiated)

set -euo pipefail

# ── Color output ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

# ── Parse arguments ──────────────────────────────────────────────────────────
AGENT_ID=""
AGENT_NAME=""
AGENT_EMOJI="🤖"
DATA_DIR="/home/node/data"
VERIFY_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)       AGENT_ID="$2"; shift 2 ;;
    --name)     AGENT_NAME="$2"; shift 2 ;;
    --emoji)    AGENT_EMOJI="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=true; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: bash provision-agent.sh --id <agent-id> --name <display-name> [options]"
      echo ""
      echo "Options:"
      echo "  --id <id>           Agent ID (required, lowercase, no spaces)"
      echo "  --name <name>       Display name (required)"
      echo "  --emoji <emoji>     Agent emoji (optional, default: 🤖)"
      echo "  --data-dir <path>   Data directory (default: /home/node/data)"
      echo "  --verify-only       Only run verification, don't create anything"
      echo "  --dry-run           Show what would be done without doing it"
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ── Validate inputs ──────────────────────────────────────────────────────────
ERRORS=0

if [[ -z "$AGENT_ID" ]]; then
  fail "Missing required --id"
  ERRORS=$((ERRORS + 1))
fi

if [[ -z "$AGENT_NAME" ]]; then
  fail "Missing required --name"
  ERRORS=$((ERRORS + 1))
fi

# ID must be lowercase, alphanumeric + hyphens only
if [[ -n "$AGENT_ID" ]] && ! echo "$AGENT_ID" | grep -qE '^[a-z][a-z0-9-]*$'; then
  fail "Agent ID must be lowercase, start with a letter, and contain only a-z, 0-9, hyphens"
  ERRORS=$((ERRORS + 1))
fi

# ID must not be 'main' (reserved)
if [[ "$AGENT_ID" == "main" ]]; then
  fail "Agent ID 'main' is reserved for the primary agent"
  ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
  exit 1
fi

# ── Resolve paths ────────────────────────────────────────────────────────────
WORKSPACE="${DATA_DIR}/workspace-${AGENT_ID}"
AGENT_DIR="${DATA_DIR}/agents/${AGENT_ID}/agent"
MAIN_AGENT_DIR="${DATA_DIR}/agents/main/agent"
TEAM_DIR="${DATA_DIR}/team"
CONFIG_FILE="${DATA_DIR}/openclaw.json"

# Resolve main workspace from openclaw.json
if [[ -f "$CONFIG_FILE" ]]; then
  MAIN_WS=$(grep -o '"workspace"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | head -1 | cut -d'"' -f4)
else
  MAIN_WS="/home/node/workspace"
fi

# Fallback if grep didn't find it
if [[ -z "$MAIN_WS" ]]; then
  MAIN_WS="/home/node/workspace"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Agent Provisioning: ${AGENT_NAME} (${AGENT_ID})"
echo "═══════════════════════════════════════════════════════════"
echo ""
info "Data dir:      ${DATA_DIR}"
info "Workspace:     ${WORKSPACE}"
info "Agent dir:     ${AGENT_DIR}"
info "Main workspace: ${MAIN_WS}"
echo ""

# ── Verify-only mode ─────────────────────────────────────────────────────────
if $VERIFY_ONLY; then
  echo "── Verification Only ──────────────────────────────────────"
  PASS=0
  TOTAL=0

  check() {
    TOTAL=$((TOTAL + 1))
    if [[ -e "$1" ]]; then
      ok "$2"
      PASS=$((PASS + 1))
    else
      fail "$2 — missing: $1"
    fi
  }

  check_link() {
    TOTAL=$((TOTAL + 1))
    if [[ -L "$1" ]]; then
      local target
      target=$(readlink "$1")
      if [[ "$target" == "$2" ]]; then
        ok "$3 → $2"
        PASS=$((PASS + 1))
      else
        fail "$3 — symlink points to '$target', expected '$2'"
      fi
    elif [[ -d "$1" ]]; then
      warn "$3 — exists as real directory (not symlink)"
      PASS=$((PASS + 1))
    else
      fail "$3 — missing: $1"
    fi
  }

  echo ""
  echo "── Directory Structure ──"
  check "$WORKSPACE" "Workspace directory"
  check "$WORKSPACE/memory" "Memory directory"
  check "$WORKSPACE/.agents/skills" "Skills directory"
  check "$WORKSPACE/.openclaw" "OpenClaw state directory"
  check "$AGENT_DIR" "Agent config directory"

  echo ""
  echo "── Operational Files ──"
  check "$WORKSPACE/IDENTITY.md" "IDENTITY.md (agent personality)"
  check "$WORKSPACE/SOUL.md" "SOUL.md (shared principles)"
  check "$WORKSPACE/OPERATIONS.md" "OPERATIONS.md (shared ops)"
  check "$WORKSPACE/USER.md" "USER.md (shared user context)"

  echo ""
  echo "── Auth Profiles ──"
  check "$AGENT_DIR/auth-profiles.json" "Auth profiles"

  echo ""
  echo "── Team Directory ──"
  check_link "$WORKSPACE/team" "$TEAM_DIR" "Team directory symlink"

  echo ""
  echo "── Bootstrap State ──"
  check "$WORKSPACE/.openclaw/state.json" "Bootstrap state file"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  if [[ $PASS -eq $TOTAL ]]; then
    ok "All checks passed: ${PASS}/${TOTAL}"
  else
    fail "Some checks failed: ${PASS}/${TOTAL}"
    exit 1
  fi
  exit 0
fi

# ── Dry-run mode ─────────────────────────────────────────────────────────────
do_cmd() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# ── Pre-flight checks ───────────────────────────────────────────────────────
echo "── Pre-flight Checks ──────────────────────────────────────"

if [[ ! -d "$DATA_DIR" ]]; then
  fail "Data directory does not exist: ${DATA_DIR}"
  exit 1
fi
ok "Data directory exists"

if [[ ! -d "$MAIN_WS" ]]; then
  fail "Main workspace does not exist: ${MAIN_WS}"
  exit 1
fi
ok "Main workspace exists"

if [[ -d "$WORKSPACE" ]]; then
  warn "Workspace already exists: ${WORKSPACE}"
  warn "Will skip existing files and only fill gaps."
else
  ok "Workspace is fresh (will create)"
fi

echo ""

# ── Step 1: Create workspace directory structure ─────────────────────────────
echo "── Step 1: Workspace Structure ────────────────────────────"

do_cmd mkdir -p "$WORKSPACE"
do_cmd mkdir -p "$WORKSPACE/memory"
do_cmd mkdir -p "$WORKSPACE/memory/knowledge"
do_cmd mkdir -p "$WORKSPACE/.agents/skills"
do_cmd mkdir -p "$WORKSPACE/.openclaw"
do_cmd mkdir -p "$WORKSPACE/tidy-history"

ok "Workspace directories created"
echo ""

# ── Step 2: Copy operational files from main workspace ───────────────────────
echo "── Step 2: Operational Files ──────────────────────────────"

# These are generic shared files — safe to copy/overwrite
SHARED_FILES=(
  "SOUL.md"
  "AGENTS.md"
  "OPERATIONS.md"
  "HEARTBEAT.md"
  "TOOLS.md"
  "USER.md"
  "openclaw-human-v1.md"
  "ACIP_SECURITY.md"
)

COPIED=0
SKIPPED=0
for f in "${SHARED_FILES[@]}"; do
  if [[ -f "$MAIN_WS/$f" ]]; then
    do_cmd cp "$MAIN_WS/$f" "$WORKSPACE/$f"
    COPIED=$((COPIED + 1))
  else
    SKIPPED=$((SKIPPED + 1))
  fi
done

ok "Copied ${COPIED} shared files (${SKIPPED} not found in main workspace — OK)"
echo ""

# ── Step 3: Seed memory templates ────────────────────────────────────────────
echo "── Step 3: Memory Templates ─────────────────────────────"

# Only copy memory templates if they DON'T already exist (don't overwrite agent's memory)
MEMORY_TEMPLATES=(
  "memory/self-review.md"
  "memory/open-loops.md"
  "memory/identity-scratchpad.md"
)

SEEDED=0
for f in "${MEMORY_TEMPLATES[@]}"; do
  if [[ -f "$MAIN_WS/$f" ]] && [[ ! -f "$WORKSPACE/$f" ]]; then
    do_cmd cp "$MAIN_WS/$f" "$WORKSPACE/$f"
    SEEDED=$((SEEDED + 1))
  fi
done

# Create empty diary (don't copy main agent's diary)
if [[ ! -f "$WORKSPACE/memory/diary.md" ]]; then
  if ! $DRY_RUN; then
    echo "# Diary" > "$WORKSPACE/memory/diary.md"
    echo "" >> "$WORKSPACE/memory/diary.md"
    echo "> This is a new diary. Entries will be written by the consciousness cron." >> "$WORKSPACE/memory/diary.md"
  fi
  SEEDED=$((SEEDED + 1))
fi

# Create empty WORKING.md
if [[ ! -f "$WORKSPACE/WORKING.md" ]]; then
  if ! $DRY_RUN; then
    echo "# Working State" > "$WORKSPACE/WORKING.md"
    echo "" >> "$WORKSPACE/WORKING.md"
    echo "## Current Focus" >> "$WORKSPACE/WORKING.md"
    echo "" >> "$WORKSPACE/WORKING.md"
    echo "- Newly provisioned. Awaiting first task." >> "$WORKSPACE/WORKING.md"
  fi
  SEEDED=$((SEEDED + 1))
fi

# Create empty MEMORY.md
if [[ ! -f "$WORKSPACE/MEMORY.md" ]]; then
  if ! $DRY_RUN; then
    echo "# Long-Term Memory" > "$WORKSPACE/MEMORY.md"
    echo "" >> "$WORKSPACE/MEMORY.md"
    echo "> Durable knowledge, user preferences, and standing corrections." >> "$WORKSPACE/MEMORY.md"
  fi
  SEEDED=$((SEEDED + 1))
fi

ok "Seeded ${SEEDED} memory templates"
echo ""

# ── Step 4: Copy shared skills ───────────────────────────────────────────────
echo "── Step 4: Shared Skills ────────────────────────────────"

if [[ -d "$MAIN_WS/.agents/skills" ]]; then
  do_cmd cp -r "$MAIN_WS/.agents/skills/"* "$WORKSPACE/.agents/skills/" 2>/dev/null || true
  SKILL_COUNT=$(ls -1 "$MAIN_WS/.agents/skills/" 2>/dev/null | wc -l | tr -d ' ')
  ok "Copied ${SKILL_COUNT} skills from main workspace"
else
  warn "No skills directory in main workspace — skipping"
fi
echo ""

# ── Step 5: Link shared team directory ───────────────────────────────────────
echo "── Step 5: Team Directory ───────────────────────────────"

do_cmd mkdir -p "$TEAM_DIR/knowledge"

if [[ -L "$WORKSPACE/team" ]]; then
  CURRENT_TARGET=$(readlink "$WORKSPACE/team")
  if [[ "$CURRENT_TARGET" == "$TEAM_DIR" ]]; then
    ok "Team symlink already correct"
  else
    warn "Team symlink points to wrong target: $CURRENT_TARGET (fixing)"
    do_cmd rm "$WORKSPACE/team"
    do_cmd ln -sfn "$TEAM_DIR" "$WORKSPACE/team"
    ok "Team symlink fixed"
  fi
elif [[ -d "$WORKSPACE/team" ]]; then
  warn "team/ is a real directory (not symlink) — leaving it alone"
else
  do_cmd ln -sfn "$TEAM_DIR" "$WORKSPACE/team"
  ok "Team directory linked"
fi
echo ""

# ── Step 6: Copy auth profiles ───────────────────────────────────────────────
echo "── Step 6: Auth Profiles ────────────────────────────────"

do_cmd mkdir -p "$AGENT_DIR"

AUTH_FILES=(
  "auth-profiles.json"
  "auth.json"
  "models.json"
)

AUTH_COPIED=0
for f in "${AUTH_FILES[@]}"; do
  if [[ -f "$MAIN_AGENT_DIR/$f" ]]; then
    do_cmd cp "$MAIN_AGENT_DIR/$f" "$AGENT_DIR/$f"
    AUTH_COPIED=$((AUTH_COPIED + 1))
  fi
done

if [[ $AUTH_COPIED -gt 0 ]]; then
  ok "Copied ${AUTH_COPIED} auth files from main agent"
else
  warn "No auth files found in main agent dir: ${MAIN_AGENT_DIR}"
  warn "The agent won't have model access until auth is configured"
fi
echo ""

# ── Step 7: Mark as bootstrapped ─────────────────────────────────────────────
echo "── Step 7: Bootstrap State ──────────────────────────────"

if ! $DRY_RUN; then
  echo '{"bootstrapCompleted":true}' > "$WORKSPACE/.openclaw/state.json"
fi
ok "Bootstrap state written"
echo ""

# ── Final verification ───────────────────────────────────────────────────────
echo "── Verification ─────────────────────────────────────────"
echo ""

PASS=0
TOTAL=0

verify() {
  TOTAL=$((TOTAL + 1))
  if $DRY_RUN; then
    ok "[dry-run] Would verify: $2"
    PASS=$((PASS + 1))
    return
  fi
  if [[ -e "$1" ]]; then
    ok "$2"
    PASS=$((PASS + 1))
  else
    fail "$2 — missing: $1"
  fi
}

verify "$WORKSPACE" "Workspace directory"
verify "$WORKSPACE/memory" "Memory directory"
verify "$WORKSPACE/.agents/skills" "Skills directory"
verify "$WORKSPACE/SOUL.md" "SOUL.md"
verify "$WORKSPACE/WORKING.md" "WORKING.md"
verify "$WORKSPACE/MEMORY.md" "MEMORY.md"
verify "$WORKSPACE/memory/diary.md" "Diary"
verify "$WORKSPACE/.openclaw/state.json" "Bootstrap state"
verify "$AGENT_DIR" "Agent config directory"

# Verify team symlink
TOTAL=$((TOTAL + 1))
if $DRY_RUN; then
  ok "[dry-run] Would verify: Team symlink"
  PASS=$((PASS + 1))
elif [[ -L "$WORKSPACE/team" ]] || [[ -d "$WORKSPACE/team" ]]; then
  ok "Team directory accessible"
  PASS=$((PASS + 1))
else
  fail "Team directory — missing or broken: $WORKSPACE/team"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ $PASS -eq $TOTAL ]]; then
  ok "Provisioning complete: ${PASS}/${TOTAL} checks passed"
else
  fail "Provisioning incomplete: ${PASS}/${TOTAL} checks passed"
  exit 1
fi

echo ""
echo "── Next Steps (AI's job) ────────────────────────────────"
echo ""
echo "  1. Register the agent:"
echo "     openclaw agents add ${AGENT_ID} \\"
echo "       --workspace ${WORKSPACE} \\"
echo "       --agent-dir ${AGENT_DIR} \\"
echo "       --non-interactive"
echo ""
echo "  2. Disable sandbox:"
echo "     openclaw agents update ${AGENT_ID} --sandbox-mode off"
echo ""
echo "  3. Write IDENTITY.md:"
echo "     Write creative content to: ${WORKSPACE}/IDENTITY.md"
echo ""
echo "  4. Write role.md (optional):"
echo "     Write role description to: ${WORKSPACE}/role.md"
echo ""
echo "  5. Add channel bindings (if needed):"
echo "     node /app/safe-config-edit.mjs set \"channels.telegram.accounts.${AGENT_ID}\" '<config>'"
echo ""
echo "  6. Set identity:"
echo "     openclaw agents set-identity --agent ${AGENT_ID} --name \"${AGENT_NAME}\" --emoji \"${AGENT_EMOJI}\""
echo ""
echo "  7. Restart gateway:"
echo "     openclaw gateway restart"
echo ""
echo "  8. Verify (re-run this script):"
echo "     bash /app/scripts/provision-agent.sh --id ${AGENT_ID} --name \"${AGENT_NAME}\" --verify-only"
echo ""
