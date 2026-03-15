#!/bin/bash
# Stop hook: Check workflow state when Claude finishes responding.
# Outputs reminders to Claude's context. Does NOT block (exit 0).
set -uo pipefail

# Only run if we're in a git repo with gh available
command -v gh &>/dev/null || exit 0
git rev-parse --git-dir &>/dev/null 2>&1 || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Only check on phase branches
if ! echo "$BRANCH" | grep -qE '^phase-'; then
  exit 0
fi

# Extract phase number from branch name
PHASE_NUM=$(echo "$BRANCH" | grep -oE 'phase-[0-9]+' | grep -oE '[0-9]+')

WARNINGS=""

# --- Check: Any open step issues? ---
OPEN_STEPS=$(gh issue list --label "step" --state open --json number,title --jq '.[].title' 2>/dev/null | grep -i "Phase ${PHASE_NUM}" || true)
if [ -n "$OPEN_STEPS" ]; then
  WARNINGS="${WARNINGS}
⚠️ OPEN STEP ISSUES (remember to /complete-step when done):
$(gh issue list --label "step" --state open --json number,title --jq '.[] | "  - #\(.number): \(.title)"' 2>/dev/null | grep -i "Phase ${PHASE_NUM}" || true)"
fi

# --- Check: Uncommitted changes? ---
DIRTY=$(git status --porcelain 2>/dev/null | head -5)
if [ -n "$DIRTY" ]; then
  DIRTY_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  WARNINGS="${WARNINGS}
⚠️ ${DIRTY_COUNT} uncommitted file(s). Commit with issue reference before moving to next step."
fi

# --- Check: Unpushed commits? ---
UNPUSHED=$(git log --oneline "@{upstream}..HEAD" 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED" -gt 0 ] 2>/dev/null; then
  WARNINGS="${WARNINGS}
⚠️ ${UNPUSHED} unpushed commit(s). Run /complete-phase when all steps are done to push + create PR."
fi

if [ -n "$WARNINGS" ]; then
  echo "--- WORKFLOW STATUS ---${WARNINGS}"
fi

exit 0
