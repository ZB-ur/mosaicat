/**
 * Graceful shutdown coordinator for pipeline runs.
 *
 * Handles SIGINT/SIGTERM by aborting an AbortController signal,
 * waiting for a cleanup promise to settle, and force-exiting on
 * a second signal (double SIGINT).
 *
 * Design choices:
 * - install() is idempotent -- calling twice does NOT double-register handlers
 * - uninstall() removes handlers to prevent MaxListenersExceeded in tests
 * - forceExit is injectable for testing (default: process.exit(1))
 * - No setTimeout used -- no timer leak
 * - signal is the communication channel to PipelineLoop
 */
export class ShutdownCoordinator {
  private controller: AbortController;
  private cleanupPromise: Promise<void> | null = null;
  private installed = false;
  private boundHandler: (() => void) | null = null;
  private forceExit: () => never;

  constructor(options?: { forceExit?: () => never }) {
    this.controller = new AbortController();
    this.forceExit = options?.forceExit ?? (() => process.exit(1));
  }

  /** The abort signal that downstream consumers should observe. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Register SIGINT and SIGTERM handlers.
   * Idempotent -- calling multiple times has no additional effect.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.boundHandler = () => { this.shutdown(); };
    process.on('SIGINT', this.boundHandler);
    process.on('SIGTERM', this.boundHandler);
  }

  /**
   * Remove SIGINT and SIGTERM handlers.
   * Safe to call even if install() was never called.
   */
  uninstall(): void {
    if (!this.installed || !this.boundHandler) return;
    process.off('SIGINT', this.boundHandler);
    process.off('SIGTERM', this.boundHandler);
    this.installed = false;
    this.boundHandler = null;
  }

  /** Set a cleanup promise that shutdown() will wait for before resolving. */
  setCleanup(p: Promise<void>): void {
    this.cleanupPromise = p;
  }

  /**
   * Initiate graceful shutdown.
   * - First call: aborts signal, waits for cleanup promise.
   * - Second call: force-exits immediately (double SIGINT behavior).
   */
  async shutdown(): Promise<void> {
    if (this.controller.signal.aborted) {
      // Second signal -> force exit
      this.forceExit();
      return; // unreachable but satisfies TS
    }
    this.controller.abort();
    if (this.cleanupPromise) {
      await this.cleanupPromise;
    }
  }
}
