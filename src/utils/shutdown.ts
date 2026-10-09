import { container } from '../core/container';
import { channels } from '../channels/registry';

export interface GracefulShutdownOptions {
  /** Signals that trigger shutdown. Defaults to SIGINT + SIGTERM. */
  signals?: string[];
  /** Hard deadline before forcing exit(1). Default 10s. */
  timeoutMs?: number;
  /** App-level cleanup (close server, drain connections, ...) runs first. */
  onShutdown?: () => void | Promise<void>;
  /**
   * Drain channel subscribers before shutdown — closes every SSE stream and
   * WebSocket connection registered via @ChannelRoute/channels, then closes
   * the adapter (e.g. Redis pub/sub connections). Default true.
   */
  drainChannels?: boolean;
}

/**
 * Wire graceful shutdown: on SIGINT/SIGTERM run `onShutdown`, then
 * `container.shutdown()` (calls `@OnModuleDestroy` hooks and clears all DI
 * registrations), then `process.exit(0)`. Forces `exit(1)` after `timeoutMs`
 * if cleanup hangs.
 *
 * Returns a detach function that removes the signal listeners (useful in
 * tests).
 */
export function gracefulShutdown(options: GracefulShutdownOptions = {}): () => void {
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  const timeoutMs = options.timeoutMs ?? 10_000;
  let shuttingDown = false;

  const handler = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timer = setTimeout(() => process.exit(1), timeoutMs);
    timer.unref?.();
    try {
      await options.onShutdown?.();
      if (options.drainChannels !== false) await channels.close();
      await container.shutdown();
      clearTimeout(timer);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  const listener = () => void handler();
  for (const signal of signals) process.on(signal, listener);

  return () => {
    for (const signal of signals) process.removeListener(signal, listener);
  };
}
