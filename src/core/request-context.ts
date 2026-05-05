import { AsyncLocalStorage } from 'node:async_hooks';
import type { InjectionToken } from './types';

/* ================= TYPES ================= */

export type CacheEntry = { value: unknown; expires: number };

/**
 * Internal per-request context stored in a single AsyncLocalStorage instance.
 * Holds trace ID, memoize cache, and DI request scope — previously 3 separate ALS instances.
 *
 * @internal — not part of the public API surface. Use `getTraceId()`, `@Memoize`, and
 *             `@RequestScoped` for the user-facing equivalents.
 */
export interface RequestContext {
  traceId: string;
  memoCache: Map<string, Map<string, CacheEntry>>;
  diScope: Map<InjectionToken, unknown>;
}

/* ================= STORAGE ================= */

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/* ================= API ================= */

/** Returns the active request context, or `undefined` when called outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/** Creates a fresh context object for a new request. */
export function createRequestContext(traceId: string): RequestContext {
  return { traceId, memoCache: new Map(), diScope: new Map() };
}

/**
 * Runs `fn` inside the given request context.
 * This is the single ALS `.run()` call for the entire request lifecycle.
 * Called once per request by `HonoRouteBuilder` — do not call manually unless
 * you are running handlers outside the route builder.
 */
export function runInRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}
