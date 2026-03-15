#!/bin/bash
# PreToolUse hook: BLOCK git commit without issue reference.
# Exit 2 = block action, stderr shown to Claude as reason.
set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only check Bash tool calls
[ "$TOOL" != "Bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

# --- Check 1: Commit message must reference an issue (#N) ---
if ! echo "$COMMAND" | grep -qE '#[0-9]+'; then
  echo "BLOCKED: Commit message must reference a GitHub issue (e.g., #13)." >&2
  echo "Run /start-step first if no step issue exists." >&2
  exit 2
fi

# --- Check 2: Must be on a phase branch (phase-N/*), not main ---
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "BLOCKED: Do not commit directly to main. Create a phase branch first." >&2
  echo "Run /start-phase to create a branch." >&2
  exit 2
fi

exit 0
