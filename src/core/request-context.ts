import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';
import type { InjectionToken } from './types';

/* ================= TYPES ================= */

export type CacheEntry = { value: unknown; expires: number };

/**
 * Per-request context stored in a single AsyncLocalStorage instance.
 * Holds trace ID, the active Hono context, memoize cache, and DI request scope.
 */
export interface RequestContext {
  traceId: string;
  /** The active Hono context — set for routes built by HonoRouteBuilder. */
  hono?: Context;
  memoCache: Map<string, Map<string, CacheEntry>>;
  diScope: Map<InjectionToken, unknown>;
}

/* ================= STORAGE ================= */

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/* ================= API ================= */

/**
 * Returns the active request context, or `undefined` when called outside a
 * request (background jobs, startup code, event listeners outside a handler).
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Returns the active Hono `Context` for the current request, or `undefined`
 * outside a request. Lets services reach request data without prop-drilling:
 *
 * @example
 * const c = getContext();
 * const user = c?.get('user');
 */
export function getContext(): Context | undefined {
  return requestContextStorage.getStore()?.hono;
}

/** Creates a fresh context object for a new request. */
export function createRequestContext(traceId: string, hono?: Context): RequestContext {
  return { traceId, hono, memoCache: new Map(), diScope: new Map() };
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
