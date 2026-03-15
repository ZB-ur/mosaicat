# Complete Phase

Complete a development phase: push branch, create PR, close phase issue.

## Arguments
- `$ARGUMENTS` format: `<phase-issue-number>`
  - Example: `1`

## Instructions

Parse the arguments to extract `phase_issue_number`.

Execute these steps in order:

1. **Push the current branch:**
   ```bash
   git push -u origin HEAD
   ```

2. **Gather all step issues that reference this phase issue:**
   ```bash
   gh issue list --label "step" --state all --json number,title,state \
     | jq '[.[] | select(.title | test("\\[Phase .*/"))]'
   ```

3. **Create PR to main:**
   Build the PR body with a summary of all step issues (number, title, state).
   ```bash
   gh pr create \
     --title "<PR title based on phase issue title>" \
     --base main \
     --body "## Summary
   Closes #${phase_issue_number}

   ### Steps completed
   <list of step issues with status>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)"
   ```

4. **Comment on the phase issue and close it:**
   ```bash
   gh issue comment ${phase_issue_number} --body "Phase completed. PR: <pr-url>"
   gh issue close ${phase_issue_number}
   ```

5. **Report the PR URL to the user.**
