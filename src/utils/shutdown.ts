import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { container } from '../core/container';
import { channels } from '../channels/registry';
import { getLogger } from '../core/logger';
import type { HonoMiddlewareFn } from '../decorators/metadata';

/* ================= REQUEST DRAIN ================= */

/**
 * Tracks in-flight HTTP requests so shutdown can wait for them to finish
 * instead of cutting them off mid-response.
 *
 * Mount once, early — `mountDrain(app)` before building routes. When
 * `gracefulShutdown` fires with `drainRequests` enabled it waits for the
 * active count to reach zero (bounded by `timeoutMs`), while new requests
 * get a fast `503` — the standard "stop sending traffic" signal.
 *
 * Note: long-lived streams are channel subscribers' responsibility —
 * `@Sse`/`@WebSocket` connections not registered via `channels` still hold
 * the drain until `timeoutMs` (or use `@ChannelRoute`).
 */
export class RequestDrain {
  private active = 0;
  private draining = false;
  private waiters: Array<() => void> = [];

  /** Hono middleware — counts each request; rejects new work while draining. */
  readonly middleware: HonoMiddlewareFn = async (c: Context, next: Next) => {
    if (this.draining) {
      return c.json(
        { status: 'error', error: { code: 'DRAINING', message: 'Server is shutting down' } },
        503
      );
    }
    this.active += 1;
    try {
      await next();
      return;
    } finally {
      this.active -= 1;
      if (this.active === 0) {
        for (const resolve of this.waiters.splice(0)) resolve();
      }
    }
  };

  get activeRequests(): number {
    return this.active;
  }

  isDraining(): boolean {
    return this.draining;
  }

  /** Resolve when every in-flight request completes (or `timeoutMs` passes). */
  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    if (this.active === 0) return;
    await Promise.race([
      new Promise<void>((resolve) => this.waiters.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
    ]);
  }
}

const DRAIN_KEY = Symbol.for('hono-forge.requestDrain');
const drainScope = globalThis as Record<symbol, RequestDrain | undefined>;

/** The process-wide request drain used by `mountDrain` + `gracefulShutdown`. */
export function getRequestDrain(): RequestDrain {
  return (drainScope[DRAIN_KEY] ??= new RequestDrain());
}

/**
 * Install in-flight request tracking middleware. Call BEFORE building routes
 * so every request is counted — requests already running when the middleware
 * was mounted cannot be seen.
 */
export function mountDrain(app: Hono): RequestDrain {
  const drain = getRequestDrain();
  app.use('*', drain.middleware);
  return drain;
}

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
  /**
   * Wait for in-flight HTTP requests to complete before shutdown (requires
   * `mountDrain(app)`). New requests get a fast 503 while draining. Bounded
   * by `timeoutMs`. Default true when a drain is mounted.
   */
  drainRequests?: boolean;
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
      if (options.drainRequests !== false) {
        const drain = drainScope[DRAIN_KEY];
        if (drain) {
          getLogger().info?.({ active: drain.activeRequests }, 'Draining in-flight requests');
          await drain.drain(timeoutMs);
        }
      }
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
