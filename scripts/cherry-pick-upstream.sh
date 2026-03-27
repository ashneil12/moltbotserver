#!/usr/bin/env bash
# Selective upstream intake helper for this fork.

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

usage() {
  cat <<'EOF'
Usage: scripts/cherry-pick-upstream.sh <commit-hash>

Cherry-picks a specific upstream commit onto the current branch and runs a real
post-pick verification command that exists in this repo.

Environment:
  OPENCLAW_CHERRY_PICK_VERIFY   Override verification command (default: pnpm build)
EOF
}

if [ "${1:-}" = "" ]; then
  echo -e "${RED}Missing commit hash.${NC}"
  usage
  exit 1
fi

COMMIT_HASH="$1"
VERIFY_CMD="${OPENCLAW_CHERRY_PICK_VERIFY:-pnpm build}"

cd "$(dirname "$0")/.."

echo -e "${BLUE}Fetching latest from upstream...${NC}"
git fetch upstream

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}Error: working tree is not clean. Commit your changes before selective intake.${NC}"
  exit 1
fi

if ! git cat-file -e "${COMMIT_HASH}^{commit}" 2>/dev/null; then
  echo -e "${RED}Error: commit ${COMMIT_HASH} does not exist locally after fetch.${NC}"
  exit 1
fi

if ! git merge-base --is-ancestor "${COMMIT_HASH}" upstream/main; then
  echo -e "${YELLOW}Warning: ${COMMIT_HASH} is not currently reachable from upstream/main.${NC}"
fi

echo -e "${BLUE}Upstream commit summary:${NC}"
git --no-pager show --stat --summary --format=medium "${COMMIT_HASH}" | sed -n '1,80p'

echo -e "${BLUE}Cherry-picking ${COMMIT_HASH} with traceability (-x)...${NC}"
if git cherry-pick -x "${COMMIT_HASH}"; then
  echo -e "${GREEN}Cherry-pick successful.${NC}"
else
  echo -e "${RED}Cherry-pick hit conflicts.${NC}"
  echo "Resolve conflicts, then run 'git cherry-pick --continue', or abort with 'git cherry-pick --abort'."
  exit 1
fi

echo -e "${BLUE}Running verification: ${VERIFY_CMD}${NC}"
if bash -lc "${VERIFY_CMD}"; then
  echo -e "${GREEN}Verification passed.${NC}"
else
  echo -e "${RED}Verification failed.${NC}"
  echo "Review the failing command output, fix as needed, and rerun verification before pushing."
  exit 1
fi

echo -e "${GREEN}Selective upstream intake complete.${NC}"
echo "Next: review the result against FORK_INVARIANTS.md before pushing."
