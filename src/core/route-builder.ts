import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ZodError } from 'zod';

import { container } from './container';
import { HttpException } from './http-exception';
import { createRequestContext, runInRequestContext } from './request-context';
import { METADATA_KEYS } from '../decorators/metadata';
import { extractIp, detectDevice, extractUserAgent } from '../utils/request';
import type { RequestLogger, RequestLogEntry } from '../utils/request';
import type {
  RouteMetadata,
  GuardMetadata,
  RateLimitMetadata,
  CacheMetadata,
  HonoMiddlewareFn,
} from '../decorators/metadata';
import type { ConcreteConstructor, ControllerConstructor, ControllerInstance } from './types';

/* ================= HELPERS ================= */

type ClassMeta = Record<symbol, unknown>;

function classMeta(target: Function): ClassMeta | null {
  return (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata] ?? null;
}

/* ================= TYPES ================= */

export type ErrorHandler = (
  error: unknown,
  c: Context
) => Response | void | Promise<Response | void>;

export interface RequestStartInfo {
  method: string;
  path: string;
  traceId: string;
  ip: string;
  userAgent: string;
}

export type RequestStartHook = (info: RequestStartInfo) => void | Promise<void>;

type WebSocketFactory = (c: Context) => unknown | Promise<unknown>;

export type WebSocketUpgrader = (factory: WebSocketFactory) => HonoMiddlewareFn;

export type GuardExecutor = (c: Context, guards: GuardMetadata[]) => Promise<boolean>;

export interface RateLimiterFactoryOptions {
  max: number;
  windowMs: number;
  keyPrefix: string;
  message?: string;
  keyGenerator?: (c: Context) => string;
}

export type RateLimiterFactory = (opts: RateLimiterFactoryOptions) => HonoMiddlewareFn;

export interface RouteBuilderConfig {
  guardExecutor?: GuardExecutor;
  rateLimiterFactory?: RateLimiterFactory;
  webSocketUpgrader?: WebSocketUpgrader;
  requestLogger?: RequestLogger;
  onError?: ErrorHandler;
  onRequestStart?: RequestStartHook;
  trailingSlash?: 'ignore' | 'strip' | 'add';
  strictValidation?: 'warn' | 'error' | 'off';
  exposeStack?: boolean | 'development';
}

export type { RequestLogger, RequestLogEntry };

/* ================= ROUTE BUILDER ================= */

export class HonoRouteBuilder {
  private static config: RouteBuilderConfig = {};

  static configure(config: RouteBuilderConfig): void {
    this.config = config;
  }

  static build<T>(
    ControllerClass: ControllerConstructor<T>,
    platform?: 'mobile' | 'web',
    options?: { excludePrivate?: boolean; }
  ): Hono {
    const app = new Hono();

    /* ----- Trailing Slash ----- */
    const trailingSlashMode = this.config.trailingSlash ?? 'ignore';
    if (trailingSlashMode !== 'ignore') {
      app.use('*', async (c, next) => {
        const url = new URL(c.req.url);
        const hasTrailingSlash = url.pathname.endsWith('/') && url.pathname !== '/';
        const needsTrailingSlash = trailingSlashMode === 'add';

        // 301 for GET/HEAD; 308 preserves method + body for the rest
        const status = (c.req.method === 'GET' || c.req.method === 'HEAD') ? 301 : 308;
        if (needsTrailingSlash && !hasTrailingSlash) {
          url.pathname = url.pathname + '/';
          return c.redirect(url.toString(), status);
        }
        if (!needsTrailingSlash && hasTrailingSlash) {
          url.pathname = url.pathname.slice(0, -1) || '/';
          return c.redirect(url.toString(), status);
        }
        await next();
      });
    }

    /* ----- Controller Metadata ----- */
    const meta = classMeta(ControllerClass as unknown as Function);
    const controllerMetadata = meta?.[METADATA_KEYS.CONTROLLER] as { basePath: string; } | undefined;
    const routes = (meta?.[METADATA_KEYS.ROUTES] as RouteMetadata[] | undefined) ?? [];

    if (!controllerMetadata) return app;

    /* ----- Resolve Controller Instance ----- */
    // Request-scoped controllers are resolved lazily inside each request's DI scope;
    // everything else is resolved eagerly here so DI errors fail fast at build time.
    const isControllerRequestScoped = Boolean(meta?.[METADATA_KEYS.REQUEST_SCOPED]);
    let eagerInstance: (T & ControllerInstance) | undefined;
    if (!isControllerRequestScoped) {
      eagerInstance = container.resolve(ControllerClass as ConcreteConstructor<T>) as T & ControllerInstance;
    }
    const getController = () =>
      eagerInstance ?? (container.resolve(ControllerClass as ConcreteConstructor<T>) as T & ControllerInstance);

    /* ----- Filter Routes ----- */
    const isPrivateMap = (meta?.[METADATA_KEYS.IS_PRIVATE] as Record<string, boolean> | undefined) ?? {};
    const platformRoutes = routes.filter((route) => {
      if (options?.excludePrivate && isPrivateMap[route.handlerName]) return false;
      if (!platform) return true;
      return route.platform === 'all' || route.platform === platform;
    });

    for (const route of platformRoutes) {
      this.registerRoute(app, route, getController, controllerMetadata.basePath, meta);
    }

    return app;
  }

  private static registerRoute(
    app: Hono,
    route: RouteMetadata,
    getController: () => ControllerInstance,
    basePath: string,
    meta: ClassMeta | null
  ): void {
    const { method, path, handlerName } = route;
    const onError = this.config.onError;
    const exposeStack = this.config.exposeStack ?? false;
    const shouldExposeStack =
      exposeStack === true ||
      (exposeStack === 'development' && process.env['NODE_ENV'] !== 'production');

    const wrapMiddleware = (mw: HonoMiddlewareFn): HonoMiddlewareFn =>
      async (c, next) => {
        try {
          return await mw(c, next);
        } catch (error: unknown) {
          if (error instanceof ZodError) {
            return c.json(
              { status: 'error', error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: error.issues } },
              400
            );
          }
          if (onError) {
            const override = await onError(error, c);
            if (override) return override;
          }
          if (error instanceof HttpException) {
            const body: Record<string, unknown> = {
              status: 'error',
              error: {
                code: error.code,
                message: error.message,
                ...(error.meta !== undefined ? { meta: error.meta } : {}),
                ...(shouldExposeStack && error.stack ? { stack: error.stack } : {}),
              },
            };
            return c.json(body, error.status as Parameters<typeof c.json>[1]);
          }
          throw error;
        }
      };

    /* ----- Per-method metadata ----- */
    const allGuards = (meta?.[METADATA_KEYS.GUARDS] as Record<string, GuardMetadata[]> | undefined) ?? {};
    const guards = allGuards[handlerName] ?? [];

    const allRateLimits = (meta?.[METADATA_KEYS.RATE_LIMIT] as Record<string, RateLimitMetadata> | undefined) ?? {};
    const rateLimitMeta = allRateLimits[handlerName];

    const classMiddlewares = (meta?.[METADATA_KEYS.MIDDLEWARES] as HonoMiddlewareFn[] | undefined) ?? [];
    const allMethodMws = (meta?.[METADATA_KEYS.METHOD_MIDDLEWARES] as Record<string, HonoMiddlewareFn[]> | undefined) ?? {};
    const methodMiddlewares = allMethodMws[handlerName] ?? [];

    const isPublicMap = (meta?.[METADATA_KEYS.IS_PUBLIC] as Record<string, boolean> | undefined) ?? {};

    const allCache = (meta?.[METADATA_KEYS.CACHE] as Record<string, CacheMetadata> | undefined) ?? {};
    const cacheMeta = allCache[handlerName];
    // Route-level response cache — per route, keyed by custom key + path + query.
    const routeCache = cacheMeta ? new Map<string, { value: unknown; expires: number; }>() : null;

    const routeLabel = `${method.toUpperCase()} ${basePath}${path}`;

    /* ----- Build Middleware Chain ----- */
    const middlewares: HonoMiddlewareFn[] = [
      ...classMiddlewares.map(wrapMiddleware),
      ...methodMiddlewares.map(wrapMiddleware),
    ];

    if (rateLimitMeta) {
      if (!this.config.rateLimiterFactory) {
        throw new Error(
          `[hono-forge] Route "${routeLabel}" has @RateLimit but no rateLimiterFactory is configured.\n` +
          `Call HonoRouteBuilder.configure({ rateLimiterFactory }) before building routes.`
        );
      }
      middlewares.push(wrapMiddleware(this.config.rateLimiterFactory({
        max: rateLimitMeta.max,
        windowMs: rateLimitMeta.windowMs,
        keyPrefix: rateLimitMeta.keyPrefix || `rl:route:${handlerName}:`,
        message: rateLimitMeta.message,
        keyGenerator: rateLimitMeta.keyGenerator,
      })));
    }

    if (guards.length > 0 && !isPublicMap[handlerName]) {
      if (!this.config.guardExecutor) {
        throw new Error(
          `[hono-forge] Route "${routeLabel}" has guards [${guards.map(g => g.name).join(', ')}] but no guardExecutor is configured.\n` +
          `Call HonoRouteBuilder.configure({ guardExecutor }) before building routes.`
        );
      }
      const boundExecuteGuards = this.config.guardExecutor;
      const guardMw: HonoMiddlewareFn = async (c, next) => {
        try {
          const canActivate = await boundExecuteGuards(c, guards);
          if (!canActivate) {
            return c.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Access denied' } }, 403);
          }
          await next();
        } catch (error) {
          if (error instanceof HttpException) throw error;
          if (error instanceof Error) {
            if (error.message.includes('Unauthorized')) {
              return c.json({ status: 'error', error: { code: 'UNAUTHORIZED', message: error.message } }, 401);
            }
            if (error.message.includes('Forbidden')) {
              return c.json({ status: 'error', error: { code: 'FORBIDDEN', message: error.message } }, 403);
            }
          }
          throw error;
        }
      };
      middlewares.push(wrapMiddleware(guardMw));
    }

    const fullPath = `${basePath}${path}`;
    const fullPathWithSlash = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
    const fullPathNoSlash = fullPath.endsWith('/') ? fullPath.slice(0, -1) || '/' : fullPath;

    type HonoWithOn = { on(method: string, path: string, ...handlers: HonoMiddlewareFn[]): Hono; };
    const register = (routePath: string) => (m: string, ...handlers: HonoMiddlewareFn[]) =>
      (app as unknown as HonoWithOn).on(m.toUpperCase(), routePath, ...handlers);

    const requestLogger = this.config.requestLogger;
    const onRequestStart = this.config.onRequestStart;

    /* ----- SSE Route ----- */
    const allSse = (meta?.[METADATA_KEYS.SSE_ROUTE] as Record<string, boolean> | undefined) ?? {};
    if (allSse[handlerName]) {
      const sseHandler = ((c: Context) => {
        const startMs = Date.now();
        const ua = extractUserAgent(c);
        const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
        c.header('x-request-id', traceId);

        return streamSSE(c, async (stream) => {
          if (onRequestStart) await onRequestStart({ method: 'GET', path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });
          const ctx = createRequestContext(traceId);
          await runInRequestContext(ctx, () =>
            container.runInScope(async () => {
              const inst = getController();
              const fn = inst[handlerName];
              if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
              await fn.call(inst, c, stream);
            })
          );

          if (requestLogger) {
            await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 200, durationMs: Date.now() - startMs, traceId });
          }
        });
      }) as unknown as HonoMiddlewareFn;

      register(fullPathNoSlash)('GET', ...middlewares, sseHandler);
      if (fullPathWithSlash !== fullPathNoSlash) register(fullPathWithSlash)('GET', ...middlewares, sseHandler);
      return;
    }

    /* ----- WebSocket Route ----- */
    const allWs = (meta?.[METADATA_KEYS.WEBSOCKET_ROUTE] as Record<string, boolean> | undefined) ?? {};
    if (allWs[handlerName]) {
      if (!this.config.webSocketUpgrader) {
        throw new Error(
          `[hono-forge] Route "${routeLabel}" has @WebSocket but no webSocketUpgrader is configured.\n` +
          `Call HonoRouteBuilder.configure({ webSocketUpgrader }) before building routes.`
        );
      }
      const upgrader = this.config.webSocketUpgrader;
      const wsHandler = upgrader(async (c: Context) => {
        const startMs = Date.now();
        const ua = extractUserAgent(c);
        const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
        c.header('x-request-id', traceId);

        if (onRequestStart) await onRequestStart({ method: 'GET', path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });

        // Resolved inside a request context but outside runInScope — WS handlers
        // return event callbacks immediately while the socket stays open.
        const inst = runInRequestContext(createRequestContext(traceId), getController);
        const fn = inst[handlerName];
        if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
        const result = fn.call(inst, c);

        if (requestLogger) {
          await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 101, durationMs: Date.now() - startMs, traceId });
        }

        return result;
      });

      register(fullPathNoSlash)('GET', ...middlewares, wsHandler);
      if (fullPathWithSlash !== fullPathNoSlash) register(fullPathWithSlash)('GET', ...middlewares, wsHandler);
      return;
    }

    /* ----- Standard HTTP Route ----- */
    const httpHandler = async (c: Context) => {
      const startMs = Date.now();
      const ua = extractUserAgent(c);
      const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
      c.header('x-request-id', traceId);

      if (onRequestStart) await onRequestStart({ method: c.req.method, path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });

      let cacheKey: string | undefined;
      if (routeCache) {
        const url = new URL(c.req.url);
        cacheKey = `${cacheMeta!.key ?? handlerName}:${url.pathname}${url.search}`;
        const hit = routeCache.get(cacheKey);
        if (hit && hit.expires > Date.now()) {
          if (requestLogger) {
            await requestLogger({ method: c.req.method, path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 200, durationMs: Date.now() - startMs, traceId });
          }
          return c.json(hit.value);
        }
        if (hit) routeCache.delete(cacheKey);
      }

      const ctx = createRequestContext(traceId);
      const response = await runInRequestContext(ctx, () =>
        container.runInScope(async () => {
          try {
            const inst = getController();
            const fn = inst[handlerName];
            if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);

            const result = await fn.call(inst, c);
            if (result instanceof Response) return result;
            if (routeCache && cacheKey !== undefined && result !== undefined) {
              routeCache.set(cacheKey, { value: result, expires: Date.now() + cacheMeta!.ttl });
              if (routeCache.size > 1000) {
                const now = Date.now();
                for (const [k, v] of routeCache) {
                  if (v.expires <= now) routeCache.delete(k);
                }
              }
            }
            return result !== undefined ? c.json(result) : c.body(null);
          } catch (error: unknown) {
            if (error instanceof ZodError) {
              return c.json(
                { status: 'error', error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: error.issues } },
                400
              );
            }
            if (onError) {
              const override = await onError(error, c);
              if (override) return override;
            }
            if (error instanceof HttpException) {
              const body: Record<string, unknown> = {
                status: 'error',
                error: {
                  code: error.code,
                  message: error.message,
                  ...(error.meta !== undefined ? { meta: error.meta } : {}),
                  ...(shouldExposeStack && error.stack ? { stack: error.stack } : {}),
                },
              };
              return c.json(body, error.status as Parameters<typeof c.json>[1]);
            }
            throw error;
          }
        })
      );

      if (requestLogger) {
        await requestLogger({
          method: c.req.method,
          path: c.req.path,
          ip: extractIp(c),
          device: detectDevice(ua),
          userAgent: ua,
          statusCode: response.status,
          durationMs: Date.now() - startMs,
          userId: (c.get('user') as { id?: string; } | undefined)?.id,
          traceId,
        });
      }

      return response;
    };

    const httpMethod = method === 'head' ? 'GET' : method;
    register(fullPathNoSlash)(httpMethod, ...middlewares, httpHandler);
    if (fullPathWithSlash !== fullPathNoSlash) register(fullPathWithSlash)(httpMethod, ...middlewares, httpHandler);
  }
}
