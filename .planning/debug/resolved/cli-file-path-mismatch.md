---
status: resolved
trigger: "CLI outputs file paths during Agent execution that cannot be opened (file not found when clicked), but the actual files are generated correctly on disk."
created: 2026-03-27T00:00:00Z
updated: 2026-03-27T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - CLIArtifactPresenter is constructed with no baseDir, defaults to CWD instead of the run's artifact directory
test: traced path construction from artifact-presenter.ts through cli-progress.ts
expecting: n/a - root cause confirmed
next_action: implement fix - pass artifactsDir through pipeline:start event

## Symptoms

expected: File paths displayed in CLI during agent execution should be clickable and point to actual generated files
actual: Clicking the paths shows "file not found", but files exist on disk at a different location
errors: File not found (when clicking CLI output paths)
reproduction: Run pipeline, observe agent output (particularly during agent execution mid-pipeline), click on any file path shown
started: Not specified — may have always been this way

## Eliminated

## Evidence

- timestamp: 2026-03-27T00:01:00Z
  checked: cli-progress.ts line 190
  found: "new CLIArtifactPresenter()" constructed with NO baseDir argument
  implication: presenter defaults to path.resolve('.') which is CWD, not the artifacts run directory

- timestamp: 2026-03-27T00:01:30Z
  checked: artifact-presenter.ts lines 31-36
  found: baseDir getter returns path.resolve(this.fixedBaseDir ?? '.'), and formatLink joins baseDir + artifactName
  implication: paths resolve to CWD/artifactName (e.g. /project/prd.md) instead of .mosaic/artifacts/run-xxx/prd.md

- timestamp: 2026-03-27T00:02:00Z
  checked: pipeline-loop.ts line 35
  found: pipeline:start event emits (runId, stages) but NOT the artifacts directory
  implication: cli-progress has no way to know the artifacts dir when constructing presenter

- timestamp: 2026-03-27T00:02:30Z
  checked: orchestrator.ts line 104
  found: ArtifactStore is created with '.mosaic/artifacts' + runId, giving runDir like .mosaic/artifacts/run-1234
  implication: the correct base path exists in the store but is never communicated to the CLI presenter

## Resolution

root_cause: CLIArtifactPresenter in cli-progress.ts is constructed with no baseDir, defaulting to CWD. The pipeline:start event does not include the artifacts directory, so there is no way for the CLI progress display to know the correct path prefix. Artifact names like "prd.md" get resolved to CWD/prd.md instead of .mosaic/artifacts/run-xxx/prd.md.
fix: Add artifactsDir to pipeline:start event signature; pass store.getDir() from PipelineLoop; use it to construct CLIArtifactPresenter with the correct base directory.
verification: TypeScript compiles with zero new errors (19 pre-existing); event-bus unit tests pass (3/3)
files_changed: [src/core/event-bus.ts, src/core/pipeline-loop.ts, src/core/cli-progress.ts]
