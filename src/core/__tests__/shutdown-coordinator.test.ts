import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShutdownCoordinator } from '../shutdown-coordinator.js';

describe('ShutdownCoordinator', () => {
  let coordinator: ShutdownCoordinator;

  afterEach(() => {
    coordinator?.uninstall();
  });

  it('signal starts as not aborted', () => {
    coordinator = new ShutdownCoordinator();
    expect(coordinator.signal.aborted).toBe(false);
  });

  it('calling shutdown() aborts the signal', async () => {
    coordinator = new ShutdownCoordinator();
    await coordinator.shutdown();
    expect(coordinator.signal.aborted).toBe(true);
  });

  it('shutdown() waits for cleanup promise before resolving', async () => {
    coordinator = new ShutdownCoordinator();

    let cleanupDone = false;
    const cleanupPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        cleanupDone = true;
        resolve();
      }, 50);
    });
    coordinator.setCleanup(cleanupPromise);

    await coordinator.shutdown();
    expect(cleanupDone).toBe(true);
    expect(coordinator.signal.aborted).toBe(true);
  });

  it('second shutdown() call (double SIGINT) calls forceExit callback', async () => {
    const forceExit = vi.fn() as unknown as () => never;
    coordinator = new ShutdownCoordinator({ forceExit });

    // First shutdown
    await coordinator.shutdown();
    expect(coordinator.signal.aborted).toBe(true);

    // Second shutdown (double SIGINT)
    await coordinator.shutdown();
    expect(forceExit).toHaveBeenCalledTimes(1);
  });

  it('install() registers handlers on process SIGINT and SIGTERM', () => {
    coordinator = new ShutdownCoordinator();
    const onSpy = vi.spyOn(process, 'on');

    coordinator.install();

    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    onSpy.mockRestore();
  });

  it('uninstall() removes handlers (prevents MaxListenersExceeded)', () => {
    coordinator = new ShutdownCoordinator();
    const offSpy = vi.spyOn(process, 'off');

    coordinator.install();
    coordinator.uninstall();

    expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    offSpy.mockRestore();
  });

  it('if no cleanup promise set, shutdown completes immediately', async () => {
    coordinator = new ShutdownCoordinator();

    // No setCleanup called
    const start = Date.now();
    await coordinator.shutdown();
    const elapsed = Date.now() - start;

    expect(coordinator.signal.aborted).toBe(true);
    // Should complete nearly instantly (< 50ms)
    expect(elapsed).toBeLessThan(50);
  });

  it('install() is idempotent -- calling twice does not double-register', () => {
    coordinator = new ShutdownCoordinator();
    const onSpy = vi.spyOn(process, 'on');

    coordinator.install();
    coordinator.install(); // second call should be no-op

    // Should only have 2 calls (SIGINT + SIGTERM), not 4
    const sigintCalls = onSpy.mock.calls.filter(([event]) => event === 'SIGINT');
    const sigtermCalls = onSpy.mock.calls.filter(([event]) => event === 'SIGTERM');
    expect(sigintCalls).toHaveLength(1);
    expect(sigtermCalls).toHaveLength(1);

    onSpy.mockRestore();
  });
});
