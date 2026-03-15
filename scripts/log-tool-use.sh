#!/usr/bin/env bash
# PostToolUse hook: log every tool call to JSONL for session replay.
# Reads JSON from stdin (tool_name, tool_input, tool_result).
# Appends one JSONL line per invocation; failures never block Claude Code.

set -euo pipefail

LOG_DIR=".mosaic/logs/sessions"
DATE=$(date +%Y-%m-%d)
LOG_FILE="${LOG_DIR}/${DATE}.jsonl"

mkdir -p "${LOG_DIR}"

INPUT=$(cat)

# Truncate large fields to 500 chars, add timestamp
echo "${INPUT}" | jq -c '{
  ts: (now | todate),
  tool: .tool_name,
  input: (.tool_input | tostring | if length > 500 then .[:500] + "…[truncated]" else . end),
  result: (.tool_result | tostring | if length > 500 then .[:500] + "…[truncated]" else . end)
}' >> "${LOG_FILE}" 2>/dev/null || true
