import type { Context, Next } from 'hono';
import type { ZodType } from 'zod';

/* ================= Symbol.metadata POLYFILL ================= */
// Bun < 1.2 supports TC39 stage 3 decorators but does not expose Symbol.metadata
// globally. The symbol IS set on classes by the runtime, so we discover it via
// a sentinel class and assign it back to Symbol.metadata once.
if (typeof (Symbol as unknown as Record<string, unknown>)['metadata'] === 'undefined') {
  let _sym: symbol | undefined;
  const _sentinel = (_v: unknown, _ctx: unknown) => { };
  @_sentinel class _SymbolMetadataBootstrap { }
  _sym = Object.getOwnPropertySymbols(_SymbolMetadataBootstrap as unknown as object)
    .find(s => s.toString() === 'Symbol(Symbol.metadata)');
  if (_sym) {
    Object.defineProperty(Symbol, 'metadata', { value: _sym, configurable: true });
  }
}

/* ================= KEYS ================= */

export const METADATA_KEYS = {
  CONTROLLER: Symbol('controller'),
  ROUTES: Symbol('routes'),
  GUARDS: Symbol('guards'),
  MIDDLEWARES: Symbol('middlewares'),
  METHOD_MIDDLEWARES: Symbol('methodMiddlewares'),
  VALIDATION: Symbol('validation'),
  CACHE: Symbol('cache'),
  CACHE_INVALIDATE: Symbol('cacheInvalidate'),
  RATE_LIMIT: Symbol('rateLimit'),
  OPENAPI: Symbol('openapi'),
  CLASS_OPENAPI: Symbol('classOpenapi'),
  CUSTOM: Symbol('custom'),
  SSE_ROUTE: Symbol('sseRoute'),
  WEBSOCKET_ROUTE: Symbol('websocketRoute'),
  CHANNEL_ROUTE: Symbol('channelRoute'),
  IS_PUBLIC: Symbol('isPublic'),
  IS_PRIVATE: Symbol('isPrivate'),
  CATCH: Symbol('catch'),
  EXCEPTION_FILTERS: Symbol('exceptionFilters'),
  METHOD_EXCEPTION_FILTERS: Symbol('methodExceptionFilters'),
  INJECTABLE: Symbol('injectable'),
  SINGLETON: Symbol('singleton'),
  REQUEST_SCOPED: Symbol('requestScoped'),
  STATELESS: Symbol('stateless'),
  INJECT_PARAMS: Symbol('injectParams'),
  MODULE: Symbol('module'),
} as const;

/* ================= HELPERS ================= */

type ClassMeta = Record<symbol, unknown>;

/** Read typed metadata from a class's Symbol.metadata object. */
export function getClassMeta<T>(target: Function, key: symbol): T | undefined {
  const meta = (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata];
  return meta?.[key] as T | undefined;
}

/** Read per-method metadata stored as Record<string, T> keyed by method name. */
export function getMethodMeta<T>(target: Function, key: symbol, methodName: string): T | undefined {
  const all = getClassMeta<Record<string, T>>(target, key);
  return all?.[methodName];
}

/* ================= ROUTE ================= */

export interface RouteMetadata {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'all';
  path: string;
  handlerName: string;
  platform?: 'mobile' | 'web' | 'all';
  isPrivate?: boolean;
}

/* ================= CONTROLLER ================= */

export interface ControllerMetadata {
  basePath: string;
  platform?: 'mobile' | 'web';
  routes: RouteMetadata[];
}

/* ================= MODULE ================= */

export interface ModuleMetadata {
  /** Controller classes owned by this module. */
  controllers?: unknown[];
  /** Provider classes — resolved eagerly at buildModule() for fail-fast DI. */
  providers?: unknown[];
  /** Other @Module classes whose controllers/providers are included. */
  imports?: unknown[];
}

/* ================= GUARD ================= */

export interface GuardMetadata {
  name: string;
  options?: {
    roles?: string[];
    [key: string]: unknown;
    requireAll?: boolean;
    permissions?: string[];
  };
}

export type HonoMiddlewareFn = (c: Context, next: Next) => Promise<Response | void>;

/* ================= VALIDATION ================= */

export interface ValidationMetadata {
  type: 'body' | 'query' | 'params';
  schema: ZodType;
}

/* ================= OPENAPI ================= */

export interface OpenAPIMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  responses?: Record<number, { description?: string; schema?: ZodType; }>;
  body?: { schema: ZodType; required?: boolean; description?: string; };
  query?: Record<string, { schema: ZodType; required?: boolean; description?: string; }>;
}

/* ================= CACHE ================= */

export interface CacheMetadata {
  ttl: number;
  key?: string;
}

/* ================= CHANNEL ROUTE ================= */

/** Channel pattern for @ChannelRoute — static or resolved per request. */
export type ChannelRouteMetadata = string | ((c: Context) => string);

/* ================= RATE LIMIT ================= */

export interface RateLimitMetadata {
  max: number;
  windowMs: number;
  keyPrefix?: string;
  message?: string;
  keyGenerator?: (c: Context) => string;
}
