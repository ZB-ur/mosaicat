# Start Step

Start a new step within a phase.

## Arguments
- `$ARGUMENTS` format: `<phase-number> <step-number> <description> <phase-issue-number>`
  - Example: `1 1 pipeline-state-machine 3`

## Instructions

Parse the arguments to extract `phase_number`, `step_number`, `description`, and `phase_issue_number`.

Execute these steps in order:

1. **Ensure the `step` label exists:**
   ```bash
   gh label create "step" --color "1D76DB" --description "Step-level tracking issue" 2>/dev/null || true
   ```

2. **Create GitHub Issue:**
   ```bash
   gh issue create \
     --title "[Phase ${phase_number} / Step ${step_number}] ${description}" \
     --label "step" \
     --body "## Step ${step_number}: ${description}

   Part of Phase ${phase_number} — #${phase_issue_number}

   ### Acceptance criteria
   _To be defined during implementation._"
   ```

3. **Report the created issue number to the user.**
