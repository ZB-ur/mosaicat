# Start Phase

Start a new development phase for Mosaicat.

## Arguments
- `$ARGUMENTS` format: `<phase-number> <description>`
  - Example: `1 core-engine`

## Instructions

Parse the arguments to extract `phase_number` and `description`.

Execute these steps in order:

1. **Create branch from main:**
   ```bash
   git checkout main && git pull origin main
   git checkout -b "phase-${phase_number}/${description}"
   ```

2. **Create GitHub Issue:**
   ```bash
   gh issue create \
     --title "[Phase ${phase_number}] ${description}" \
     --label "phase" \
     --body "## Phase ${phase_number}: ${description}

   Phase tracking issue. All step-level issues will reference this issue.

   ### Steps
   _Steps will be added as work progresses._"
   ```

3. **Report the created issue number and branch name to the user.**

If the `phase` label doesn't exist yet, create it first:
```bash
gh label create "phase" --color "0E8A16" --description "Phase-level tracking issue" 2>/dev/null || true
```
