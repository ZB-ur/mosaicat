/**
 * Central resolver for the .mosaic/ directory path.
 *
 * All modules that read/write under .mosaic/ MUST use these functions
 * instead of hardcoding '.mosaic/...'. This ensures:
 * 1. Tests can isolate to a temp directory via setMosaicHome()
 * 2. git worktrees use their own .mosaic/ (process.cwd() differs)
 *
 * Resolution order: setMosaicHome() override > MOSAIC_HOME env > '.mosaic'
 */

let overrideHome: string | null = null;

/** Get the .mosaic root directory path (relative or absolute). */
export function getMosaicHome(): string {
  return overrideHome ?? process.env.MOSAIC_HOME ?? '.mosaic';
}

/** Override the .mosaic root for testing. Pass null to reset. */
export function setMosaicHome(dir: string | null): void {
  overrideHome = dir;
}

export function getMosaicArtifactsDir(): string {
  return `${getMosaicHome()}/artifacts`;
}

export function getMosaicLogsDir(): string {
  return `${getMosaicHome()}/logs`;
}

export function getMosaicSnapshotsDir(): string {
  return `${getMosaicHome()}/snapshots`;
}
