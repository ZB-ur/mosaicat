#!/bin/bash
# UserPromptSubmit hook: Inject current workflow state into Claude's context.
# Runs on every user prompt. Gives Claude awareness of where we are in the workflow.
set -uo pipefail

command -v gh &>/dev/null || exit 0
git rev-parse --git-dir &>/dev/null 2>&1 || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Only inject context on phase branches
if ! echo "$BRANCH" | grep -qE '^phase-'; then
  exit 0
fi

PHASE_NUM=$(echo "$BRANCH" | grep -oE 'phase-[0-9]+' | grep -oE '[0-9]+')

# Get phase issue
PHASE_ISSUE=$(gh issue list --label "phase" --state open --json number,title --jq ".[] | select(.title | test(\"Phase ${PHASE_NUM}\")) | \"#\\(.number): \\(.title)\"" 2>/dev/null | head -1)

# Get open step issues
OPEN_STEPS=$(gh issue list --label "step" --state open --json number,title --jq '.[] | "#\(.number): \(.title)"' 2>/dev/null | grep -i "Phase ${PHASE_NUM}" || true)

# Get closed step count
CLOSED_STEPS=$(gh issue list --label "step" --state closed --json title --jq '.[].title' 2>/dev/null | grep -ic "Phase ${PHASE_NUM}" || true)

if [ -n "$PHASE_ISSUE" ]; then
  echo "--- CURRENT WORKFLOW ---"
  echo "Branch: ${BRANCH}"
  echo "Phase: ${PHASE_ISSUE}"
  echo "Steps completed: ${CLOSED_STEPS}"
  if [ -n "$OPEN_STEPS" ]; then
    echo "Steps in progress:"
    echo "$OPEN_STEPS" | while read -r line; do echo "  ${line}"; done
  else
    echo "No step in progress. Run /start-step before writing code."
  fi
  echo "---"
fi

exit 0
