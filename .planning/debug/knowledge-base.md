# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## cli-file-path-mismatch — CLI artifact paths resolve to CWD instead of run artifacts dir
- **Date:** 2026-03-27
- **Error patterns:** file not found, clickable paths, CLI output paths, artifact presenter, baseDir, CWD, pipeline:start
- **Root cause:** CLIArtifactPresenter in cli-progress.ts was constructed with no baseDir, defaulting to CWD. The pipeline:start event did not include the artifacts directory, so artifact names like "prd.md" resolved to CWD/prd.md instead of .mosaic/artifacts/run-xxx/prd.md.
- **Fix:** Added artifactsDir field to pipeline:start event signature in event-bus.ts; passed store.getDir() from PipelineLoop when emitting the event; used the received artifactsDir to construct CLIArtifactPresenter with the correct base directory in cli-progress.ts.
- **Files changed:** src/core/event-bus.ts, src/core/pipeline-loop.ts, src/core/cli-progress.ts, src/core/stage-executor.ts
---
