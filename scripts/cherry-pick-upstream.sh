#!/usr/bin/env bash
# =============================================================================
# scripts/cherry-pick-upstream.sh
# 
# A safe utility for pulling isolated features from the upstream OpenClaw 
# repository without triggering massive merge conflicts on our customized fork.
# =============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ -z "$1" ]; then
  echo -e "${RED}Usage: $0 <commit-hash>${NC}"
  echo ""
  echo -e "Examples:"
  echo -e "  $0 abc123def456      # Cherry-pick a specific commit"
  exit 1
fi

COMMIT_HASH=$1

# Ensure we're in the repository root
cd "$(dirname "$0")/.."

echo -e "${BLUE}Fetching latest from upstream...${NC}"
git fetch upstream

echo -e "${BLUE}Attempting to cherry-pick commit ${COMMIT_HASH}...${NC}"

# Check if working directory is clean
if ! git diff-index --quiet HEAD --; then
  echo -e "${RED}Error: Your working directory is not clean. Please commit or stash your changes first.${NC}"
  exit 1
fi

# Store the current HEAD so we can rollback if needed
PRE_PICK_HEAD=$(git rev-parse HEAD)

# Perform the cherry-pick
if git cherry-pick "$COMMIT_HASH"; then
  echo -e "${GREEN}✅ Cherry-pick successful!${NC}"
  
  # Run the verification gates automatically
  echo -e "${BLUE}Running verification gates...${NC}"
  if [ -f "scripts/verify-sync.sh" ]; then
    bash scripts/verify-sync.sh
  else
    echo -e "${YELLOW}Warning: scripts/verify-sync.sh not found. Skipping automated tests.${NC}"
    echo -e "Please manually verify the agent boots without configuration errors."
  fi
  
  echo -e "${GREEN}Update complete. Run 'npm run dev:sandbox' to start the local environment.${NC}"
else
  echo -e "${RED}❌ Cherry-pick failed with conflicts.${NC}"
  echo -e "You can:"
  echo -e "  1. Resolve conflicts, run 'git add <files>' and 'git cherry-pick --continue'"
  echo -e "  2. Abort this pick by running 'git cherry-pick --abort'"
  exit 1
fi
