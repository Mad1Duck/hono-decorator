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
  CONTROLLER: Symbol.for('hono-forge.controller'),
  ROUTES: Symbol.for('hono-forge.routes'),
  GUARDS: Symbol.for('hono-forge.guards'),
  MIDDLEWARES: Symbol.for('hono-forge.middlewares'),
  METHOD_MIDDLEWARES: Symbol.for('hono-forge.methodMiddlewares'),
  VALIDATION: Symbol.for('hono-forge.validation'),
  CACHE: Symbol.for('hono-forge.cache'),
  CACHE_INVALIDATE: Symbol.for('hono-forge.cacheInvalidate'),
  IDEMPOTENT: Symbol.for('hono-forge.idempotent'),
  SINGLE_FLIGHT: Symbol.for('hono-forge.singleFlight'),
  HEADERS: Symbol.for('hono-forge.headers'),
  REDIRECT: Symbol.for('hono-forge.redirect'),
  RESPONSE_STATUS: Symbol.for('hono-forge.responseStatus'),
  ON_EVENT: Symbol.for('hono-forge.onEvent'),
  SCHEDULE: Symbol.for('hono-forge.schedule'),
  RATE_LIMIT: Symbol.for('hono-forge.rateLimit'),
  OPENAPI: Symbol.for('hono-forge.openapi'),
  CLASS_OPENAPI: Symbol.for('hono-forge.classOpenapi'),
  CUSTOM: Symbol.for('hono-forge.custom'),
  SSE_ROUTE: Symbol.for('hono-forge.sseRoute'),
  WEBSOCKET_ROUTE: Symbol.for('hono-forge.websocketRoute'),
  WS_MESSAGE: Symbol.for('hono-forge.wsMessage'),
  CACHE_CONTROL: Symbol.for('hono-forge.cacheControl'),
  ETAG: Symbol.for('hono-forge.etag'),
  CHANNEL_ROUTE: Symbol.for('hono-forge.channelRoute'),
  IS_PUBLIC: Symbol.for('hono-forge.isPublic'),
  IS_PRIVATE: Symbol.for('hono-forge.isPrivate'),
  CATCH: Symbol.for('hono-forge.catch'),
  EXCEPTION_FILTERS: Symbol.for('hono-forge.exceptionFilters'),
  METHOD_EXCEPTION_FILTERS: Symbol.for('hono-forge.methodExceptionFilters'),
  INJECTABLE: Symbol.for('hono-forge.injectable'),
  SINGLETON: Symbol.for('hono-forge.singleton'),
  REQUEST_SCOPED: Symbol.for('hono-forge.requestScoped'),
  STATELESS: Symbol.for('hono-forge.stateless'),
  INJECT_PARAMS: Symbol.for('hono-forge.injectParams'),
  MODULE: Symbol.for('hono-forge.module'),
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

/** @Validate — pre-handler Zod validation; schemas also feed the OpenAPI spec. */
export interface ValidationMetadata {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/* ================= OPENAPI ================= */

export interface OpenAPIMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  /** `true` or `{ sunset }` — also emitted as Deprecation/Sunset headers. */
  deprecated?: boolean | { sunset?: string };
  responses?: Record<number, { description?: string; schema?: ZodType; }>;
  body?: { schema: ZodType; required?: boolean; description?: string; };
  query?: Record<string, { schema: ZodType; required?: boolean; description?: string; }>;
  /** Path-param schemas — populated by @Validate({ params }). */
  params?: Record<string, { schema: ZodType; description?: string; }>;
}

/* ================= CACHE ================= */

export interface CacheMetadata {
  ttl: number;
  key?: string;
}

/* ================= CHANNEL ROUTE ================= */

/** Channel pattern for @ChannelRoute — static or resolved per request. */
export type ChannelRouteMetadata = string | ((c: Context) => string);

/* ================= RESPONSE DECORATORS ================= */

/** @Idempotent metadata — replay responses for a repeated Idempotency-Key. */
export interface IdempotentMetadata {
  /** How long the stored response is replayable. Default 24h. */
  ttl?: number;
}

/** @Header metadata — static response headers per method. */
export type HeadersMetadata = Record<string, string>;

/** @Redirect metadata — always redirect, handler is never invoked. */
export interface RedirectMetadata {
  location: string;
  status: 301 | 302 | 303 | 307 | 308;
}

/** @Status / @NoContent — default status code for non-Response results. */
export interface ResponseStatusMetadata {
  status: number;
  /** @NoContent — body is always empty regardless of the handler result. */
  ignoreBody?: boolean;
}

/** @Interval metadata — scheduled service method. */
export interface ScheduleMetadata {
  /** @Interval — fixed delay between runs. Mutually exclusive with cron. */
  everyMs?: number;
  /** @Cron — standard 5-field cron expression. */
  cron?: string;
  /** Run once immediately at scheduler start. */
  immediate?: boolean;
}

/** @OnEvent — event names listened to by a method (repeatable). */
export type OnEventMetadata = string[];

/* ================= RATE LIMIT ================= */

export interface RateLimitMetadata {
  max: number;
  windowMs: number;
  keyPrefix?: string;
  message?: string;
  keyGenerator?: (c: Context) => string;
}
