# Complete Step

Complete a step: summarize changes, comment on issue, close it.

## Arguments
- `$ARGUMENTS` format: `<step-issue-number>`
  - Example: `4`

## Instructions

Parse the arguments to extract `step_issue_number`.

Execute these steps in order:

1. **Get the issue title to identify the step:**
   ```bash
   gh issue view ${step_issue_number} --json title -q '.title'
   ```

2. **Gather commits related to this step** (commits referencing this issue number):
   ```bash
   git log --oneline --grep="#${step_issue_number}"
   ```
   If no commits reference the issue directly, gather recent commits since the step issue was created.

3. **Build a change summary** from the commits (files changed, key modifications).

4. **Comment on the issue with the summary and close it:**
   ```bash
   gh issue comment ${step_issue_number} --body "## Step completed

   ### Changes
   <commit list and summary of modifications>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)"

   gh issue close ${step_issue_number}
   ```

5. **Report completion to the user.**
