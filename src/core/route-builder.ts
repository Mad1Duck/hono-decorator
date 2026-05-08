import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ZodError } from 'zod';

import { container } from './container';
import { HttpException } from './http-exception';
import { createRequestContext, runInRequestContext } from './request-context';
import { METADATA_KEYS } from '../decorators/metadata';
import {
  extractIp,
  detectDevice,
  extractUserAgent,
} from '../utils/request';
import type { RequestLogger, RequestLogEntry } from '../utils/request';
import type {
  RouteMetadata,
  ParamMetadata,
  GuardMetadata,
  RateLimitMetadata,
  HonoMiddlewareFn,
} from '../decorators/metadata';
import type { AbstractConstructor, ConcreteConstructor, ControllerConstructor, ControllerInstance } from './types';

/* ================= TYPES ================= */

/**
 * Global error handler called for every non-Zod error (including `HttpException`).
 *
 * - Return a `Response` to fully override the error response sent to the client.
 * - Return `void` / `undefined` to fall through to default handling:
 *   - `HttpException` → structured JSON at the correct status code
 *   - Other errors → re-thrown to Hono's default 500 handler
 *
 * This is the right place to persist errors to a database or external service.
 *
 * @example Save HttpException to DB, use default response
 * HonoRouteBuilder.configure({
 *   onError: async (err, c) => {
 *     if (err instanceof HttpException) {
 *       await db.insert(errorLogs).values({ code: err.code, message: err.message, meta: err.meta });
 *       // return nothing → default JSON response is still sent
 *     }
 *   },
 * });
 *
 * @example Full override for all errors
 * HonoRouteBuilder.configure({
 *   onError: (err, c) => c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500),
 * });
 */
export type ErrorHandler = (
  error: unknown,
  c: Context
) => Response | void | Promise<Response | void>;

/**
 * Payload passed to `onRequestStart`. Use this to start an OTel span,
 * attach a logger context, or initialise any per-request observability state.
 */
export interface RequestStartInfo {
  method: string;
  path: string;
  traceId: string;
  ip: string;
  userAgent: string;
}

export type RequestStartHook = (info: RequestStartInfo) => void | Promise<void>;

type WebSocketFactory = (c: Context) => unknown | Promise<unknown>;

/**
 * Platform-specific WebSocket upgrader (e.g. `upgradeWebSocket` from `hono/bun`).
 * Receives a factory that maps the request context to WebSocket event handlers,
 * and returns a Hono middleware that performs the upgrade.
 */
export type WebSocketUpgrader = (factory: WebSocketFactory) => HonoMiddlewareFn;

/**
 * Function that executes a list of guards against the current request context.
 * Return `true` to allow, `false` to deny. Throw an Error with "Unauthorized"
 * or "Forbidden" in the message for automatic 401/403 responses.
 */
export type GuardExecutor = (
  c: Context,
  guards: GuardMetadata[]
) => Promise<boolean>;

/**
 * Options passed to the rate limiter factory, sourced from @RateLimit() decorator metadata.
 */
export interface RateLimiterFactoryOptions {
  max: number;
  windowMs: number;
  keyPrefix: string;
  message?: string;
  keyGenerator?: (c: Context) => string;
}

/**
 * Factory that receives rate limit options and returns a Hono middleware function.
 */
export type RateLimiterFactory = (
  opts: RateLimiterFactoryOptions
) => HonoMiddlewareFn;

/**
 * Plugin configuration for HonoRouteBuilder.
 * Pass these via `HonoRouteBuilder.configure()` before calling `build()`.
 */
export interface RouteBuilderConfig {
  /**
   * Custom guard executor. Required if you use @RequireAuth / @RequireRole /
   * @RequirePermission / @UseGuards decorators.
   */
  guardExecutor?: GuardExecutor;

  /**
   * Factory for per-route rate limiting. Required if you use @RateLimit() decorator.
   */
  rateLimiterFactory?: RateLimiterFactory;

  /**
   * Platform-specific WebSocket upgrader. Required if you use @WebSocket() decorator.
   * Pass `upgradeWebSocket` from `hono/bun`, `hono/cloudflare-workers`, etc.
   *
   * @example
   * import { upgradeWebSocket } from 'hono/bun';
   * HonoRouteBuilder.configure({ webSocketUpgrader: upgradeWebSocket });
   */
  webSocketUpgrader?: WebSocketUpgrader;

  /**
   * Pluggable request logger. Called after every standard HTTP handler with
   * method, path, IP, device type, user-agent, status code, and duration.
   *
   * @example
   * HonoRouteBuilder.configure({
   *   requestLogger: (e) => console.log(JSON.stringify(e)),
   * });
   */
  requestLogger?: RequestLogger;

  /**
   * Global error handler for unhandled route errors (non-validation errors).
   * If omitted, unhandled errors are re-thrown to Hono's default 500 handler.
   *
   * @example
   * HonoRouteBuilder.configure({
   *   onError: (err, c) => {
   *     console.error(err);
   *     return c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500);
   *   },
   * });
   */
  onError?: ErrorHandler;

  /**
   * Hook called at the start of every request, before middleware and guards run.
   * Receives method, path, traceId, IP, and user-agent.
   *
   * Use this to start an OpenTelemetry span, attach a correlation ID to your logger,
   * or initialise any per-request observability context.
   *
   * @example OpenTelemetry
   * HonoRouteBuilder.configure({
   *   onRequestStart: ({ traceId, method, path }) => {
   *     const span = tracer.startSpan(`${method} ${path}`, { attributes: { traceId } });
   *     context.with(trace.setSpan(context.active(), span), () => {});
   *   },
   * });
   */
  onRequestStart?: RequestStartHook;

  /**
   * Controls how trailing slashes in URLs are handled.
   *
   * - `'ignore'` (default) — trailing slashes are treated as different routes (Hono default)
   * - `'strip'` — redirects `/path/` to `/path` (removes trailing slash)
   * - `'add'` — redirects `/path` to `/path/` (adds trailing slash)
   *
   * @example
   * HonoRouteBuilder.configure({ trailingSlash: 'strip' });
   */
  trailingSlash?: 'ignore' | 'strip' | 'add';

  /**
   * Enforce that mutation routes (POST, PUT, PATCH) always use a validated body schema.
   *
   * - `'warn'` (default) — logs a `console.warn` at `build()` time when a mutation route
   *   uses `@Body()` without a Zod schema.
   * - `'error'` — throws at `build()` time instead of warning. Recommended for production builds.
   * - `'off'` — disables the check entirely.
   *
   * @example
   * HonoRouteBuilder.configure({ strictValidation: 'error' });
   */
  strictValidation?: 'warn' | 'error' | 'off';

  /**
   * Controls whether the `stack` trace is included in `HttpException` error responses.
   *
   * - `false` (default) — stack is never exposed (safe for production)
   * - `true` — stack is always included in the response
   * - `'development'` — stack is included only when `NODE_ENV` is not `'production'`
   *
   * @example
   * HonoRouteBuilder.configure({ exposeStack: 'development' });
   */
  exposeStack?: boolean | 'development';
}

export type { RequestLogger, RequestLogEntry };

/* ================= ROUTE BUILDER (HONO) ================= */

export class HonoRouteBuilder {
  private static config: RouteBuilderConfig = {};

  /* ---------- CONFIGURE ---------- */

  static configure(config: RouteBuilderConfig): void {
    this.config = config;
  }

  /* ---------- BUILD ---------- */

  static build<T>(
    ControllerClass: ControllerConstructor<T>,
    platform?: 'mobile' | 'web',
    options?: { excludePrivate?: boolean; }
  ): Hono {
    const app = new Hono();

    /* ----- Trailing Slash Normalization ----- */
    const trailingSlashMode = this.config.trailingSlash ?? 'ignore';
    if (trailingSlashMode !== 'ignore') {
      app.use('*', async (c, next) => {
        const url = new URL(c.req.url);
        const hasTrailingSlash = url.pathname.endsWith('/') && url.pathname !== '/';
        const needsTrailingSlash = trailingSlashMode === 'add';

        if (needsTrailingSlash && !hasTrailingSlash && url.pathname !== '/') {
          url.pathname = url.pathname + '/';
          return c.redirect(url.toString(), 301);
        }

        if (!needsTrailingSlash && hasTrailingSlash) {
          url.pathname = url.pathname.slice(0, -1) || '/';
          return c.redirect(url.toString(), 301);
        }

        await next();
      });
    }

    /* ----- Controller Metadata ----- */
    const controllerMetadata = Reflect.getMetadata(
      METADATA_KEYS.CONTROLLER,
      ControllerClass
    ) as { basePath: string; } | undefined;

    const routes = Reflect.getMetadata(
      METADATA_KEYS.ROUTES,
      ControllerClass
    ) as RouteMetadata[] | undefined;

    if (!controllerMetadata || !routes) {
      return app;
    }

    /* ----- Resolve Controller Instance ----- */
    const controllerInstance = container.resolve(
      ControllerClass as ConcreteConstructor<T>
    ) as T & ControllerInstance;

    const proto = (ControllerClass as unknown as { prototype: object; }).prototype;

    /* ----- Filter Routes by Platform & Visibility ----- */
    const platformRoutes = routes.filter((route) => {
      if (options?.excludePrivate && Reflect.getMetadata('isPrivate', proto, route.handlerName)) return false;
      if (!platform) return true;
      return route.platform === 'all' || route.platform === platform;
    });

    /* ----- Register Routes ----- */
    for (const route of platformRoutes) {
      this.registerRoute(
        app,
        route,
        controllerInstance,
        controllerMetadata.basePath
      );
    }

    return app;
  }

  /* ---------- REGISTER ROUTE ---------- */

  private static registerRoute(
    app: Hono,
    route: RouteMetadata,
    controllerInstance: ControllerInstance,
    basePath: string
  ): void {
    const { method, path, handlerName } = route;
    const proto = Object.getPrototypeOf(controllerInstance);

    /* ----- Error config (shared by wrapMiddleware + handlers) ----- */
    const onError = this.config.onError;
    const exposeStack = this.config.exposeStack ?? false;
    const shouldExposeStack =
      exposeStack === true ||
      (exposeStack === 'development' && process.env['NODE_ENV'] !== 'production');

    /**
     * Wraps a user-supplied middleware so that any thrown error
     * (HttpException, ZodError, or generic) is formatted with the same
     * structured JSON shape used by the HTTP handler, and routed through
     * the configured `onError` hook before being serialised.
     */
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

    /* ----- Check if route is public ----- */
    const isPublic = Reflect.getMetadata(
      'isPublic',
      proto,
      handlerName
    ) as boolean | undefined;

    /* ----- Get Rate Limit Metadata ----- */
    const rateLimitMeta = Reflect.getMetadata(
      METADATA_KEYS.RATE_LIMIT,
      proto,
      handlerName
    ) as RateLimitMetadata | undefined;

    /* ----- Build Middleware Chain ----- */
    const middlewares: HonoMiddlewareFn[] = [];

    /* ----- Collect Middlewares ----- */
    // Class middlewares always run — @Public only skips guards, not middleware
    const classMiddlewares = (Reflect.getMetadata(
      METADATA_KEYS.MIDDLEWARES,
      proto.constructor
    ) as HonoMiddlewareFn[] | undefined) ?? [];

    const methodMiddlewares = (Reflect.getMetadata(
      METADATA_KEYS.MIDDLEWARES,
      proto,
      handlerName
    ) as HonoMiddlewareFn[] | undefined) ?? [];

    /* ----- Get Parameter Metadata ----- */
    const params = (Reflect.getMetadata(
      METADATA_KEYS.PARAMS,
      controllerInstance,
      handlerName
    ) as ParamMetadata[] | undefined) ?? [];

    /* ----- Get Guards Metadata ----- */
    const guards = (Reflect.getMetadata(
      METADATA_KEYS.GUARDS,
      proto,
      handlerName
    ) as GuardMetadata[] | undefined) ?? [];

    const routeLabel = `${method.toUpperCase()} ${basePath}${path}`;

    /* ----- Strict Validation Check ----- */
    const strictMode = this.config.strictValidation ?? 'warn';
    if (strictMode !== 'off' && ['post', 'put', 'patch'].includes(method)) {
      const hasUnvalidatedBody = params.some(
        (p) => p.type === 'body' && !p.schema
      );
      if (hasUnvalidatedBody) {
        const msg =
          `[hono-forge] ${routeLabel} uses @Body() without a Zod schema — ` +
          `unvalidated input will reach the handler. Use @ValidatedBody(schema) to enforce validation.`;
        if (strictMode === 'error') {
          throw new Error(msg);
        } else {
          console.warn(msg);
        }
      }
    }

    // 1. Class-level middlewares
    middlewares.push(...classMiddlewares.map(wrapMiddleware));

    // 2. Method-level middlewares
    middlewares.push(...methodMiddlewares.map(wrapMiddleware));

    // 3. Rate limiting middleware (if decorator is present)
    if (rateLimitMeta) {
      if (!this.config.rateLimiterFactory) {
        throw new Error(
          `[hono-decorators] Route "${routeLabel}" has @RateLimit but no rateLimiterFactory is configured.\n` +
          `Call HonoRouteBuilder.configure({ rateLimiterFactory }) before building routes.`
        );
      }

      const rateLimitMiddleware = this.config.rateLimiterFactory({
        max: rateLimitMeta.max,
        windowMs: rateLimitMeta.windowMs,
        keyPrefix: rateLimitMeta.keyPrefix || `rl:route:${handlerName}:`,
        message: rateLimitMeta.message,
        keyGenerator: rateLimitMeta.keyGenerator,
      });

      middlewares.push(wrapMiddleware(rateLimitMiddleware));
    }

    // 4. Guards middleware (auth, role, permission)
    if (guards.length > 0) {
      if (!this.config.guardExecutor) {
        const guardNames = guards.map(g => g.name).join(', ');
        throw new Error(
          `[hono-decorators] Route "${routeLabel}" has guards [${guardNames}] but no guardExecutor is configured.\n` +
          `Call HonoRouteBuilder.configure({ guardExecutor }) before building routes.`
        );
      }

      const boundExecuteGuards = this.config.guardExecutor;
      const guardMiddleware = async (c: Context, next: () => void) => {
        try {
          const canActivate = await boundExecuteGuards(c, guards);

          if (!canActivate) {
            return c.json(
              {
                status: 'error',
                error: {
                  code: 'FORBIDDEN',
                  message: 'Access denied',
                },
              },
              403
            );
          }

          await next();
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('Unauthorized')) {
              return c.json(
                {
                  status: 'error',
                  error: {
                    code: 'UNAUTHORIZED',
                    message: error.message,
                  },
                },
                401
              );
            }

            if (error.message.includes('Forbidden')) {
              return c.json(
                {
                  status: 'error',
                  error: {
                    code: 'FORBIDDEN',
                    message: error.message,
                  },
                },
                403
              );
            }
          }

          throw error;
        }
      };
      middlewares.push(guardMiddleware as HonoMiddlewareFn);
    }
    const fullPath = `${basePath}${path}`;

    // Register both with and without trailing slash for better API compatibility
    const fullPathWithSlash = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
    const fullPathNoSlash = fullPath.endsWith('/') ? fullPath.slice(0, -1) || '/' : fullPath;

    // Hono's generic types can't infer spread middleware arrays via app[method](),
    // so we cast to a narrower interface that exposes exactly what we need.
    type HonoWithOn = { on(method: string, path: string, ...handlers: HonoMiddlewareFn[]): Hono; };
    const register = (routePath: string) => (m: string, ...handlers: HonoMiddlewareFn[]) =>
      (app as unknown as HonoWithOn).on(m.toUpperCase(), routePath, ...handlers);

    const requestLogger = this.config.requestLogger;
    const onRequestStart = this.config.onRequestStart;

    /* ----- SSE Route ----- */
    const isSse = Reflect.getMetadata(
      METADATA_KEYS.SSE_ROUTE, proto, handlerName
    ) as boolean | undefined;

    if (isSse) {
      const sseHandler = ((c: Context) => {
        const startMs = Date.now();
        const ua = extractUserAgent(c);
        const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
        c.header('x-request-id', traceId);

        return streamSSE(c, async (stream) => {
          if (onRequestStart) await onRequestStart({ method: 'GET', path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });
          const args = await this.resolveParameters(params, c, stream);
          const fn = controllerInstance[handlerName];
          if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
          await fn.apply(controllerInstance, args);

          if (requestLogger) {
            await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 200, durationMs: Date.now() - startMs, traceId });
          }
        });
      }) as unknown as HonoMiddlewareFn;
      register(fullPathNoSlash)('GET', ...middlewares, sseHandler);
      if (fullPathWithSlash !== fullPathNoSlash) {
        register(fullPathWithSlash)('GET', ...middlewares, sseHandler);
      }
      return;
    }

    /* ----- WebSocket Route ----- */
    const isWs = Reflect.getMetadata(
      METADATA_KEYS.WEBSOCKET_ROUTE, proto, handlerName
    ) as boolean | undefined;

    if (isWs) {
      if (!this.config.webSocketUpgrader) {
        throw new Error(
          `[hono-decorators] Route "${routeLabel}" has @WebSocket but no webSocketUpgrader is configured.\n` +
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
        const args = await this.resolveParameters(params, c);
        const fn = controllerInstance[handlerName];
        if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
        const result = fn.apply(controllerInstance, args);

        if (requestLogger) {
          await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 101, durationMs: Date.now() - startMs, traceId });
        }

        return result;
      });
      register(fullPathNoSlash)('GET', ...middlewares, wsHandler);
      if (fullPathWithSlash !== fullPathNoSlash) {
        register(fullPathWithSlash)('GET', ...middlewares, wsHandler);
      }
      return;
    }

    /* ----- Standard HTTP Route ----- */
    const httpHandler = async (c: Context) => {
      const startMs = Date.now();
      const ua = extractUserAgent(c);
      const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
      c.header('x-request-id', traceId);

      if (onRequestStart) await onRequestStart({ method: c.req.method, path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });

      const ctx = createRequestContext(traceId);
      const response = await runInRequestContext(ctx, () =>
        container.runInScope(async () => {
          try {
            const args = await this.resolveParameters(params, c);
            const fn = controllerInstance[handlerName];

            if (typeof fn !== 'function') {
              throw new Error(`Handler ${handlerName} not found`);
            }

            const result = await fn.apply(controllerInstance, args);
            return result !== undefined ? c.json(result) : c.body(null);
          } catch (error: unknown) {
            if (error instanceof ZodError) {
              return c.json(
                {
                  status: 'error',
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed',
                    details: error.issues,
                  },
                },
                400
              );
            }

            // Call onError for logging / DB persistence regardless of error type.
            // If it returns a Response, use that as the final reply.
            if (onError) {
              const override = await onError(error, c);
              if (override) return override;
            }

            // Auto-handle HttpException with structured JSON at the correct status code.
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
        const entry: RequestLogEntry = {
          method: c.req.method,
          path: c.req.path,
          ip: extractIp(c),
          device: detectDevice(ua),
          userAgent: ua,
          statusCode: response.status,
          durationMs: Date.now() - startMs,
          userId: (c.get('user') as { id?: string; } | undefined)?.id,
          traceId,
        };
        await requestLogger(entry);
      }

      return response;
    };

    // Hono doesn't route app.on('HEAD',...) — register as GET so Hono's
    // automatic HEAD-for-GET fallback returns correct headers with no body.
    const httpMethod = method === 'head' ? 'GET' : method;
    register(fullPathNoSlash)(httpMethod, ...middlewares, httpHandler);
    if (fullPathWithSlash !== fullPathNoSlash) {
      register(fullPathWithSlash)(httpMethod, ...middlewares, httpHandler);
    }
  }

  /* ---------- PARAM RESOLVER ---------- */

  private static async resolveParameters(
    params: ParamMetadata[],
    c: Context,
    sseStream?: unknown
  ): Promise<unknown[]> {
    const args: unknown[] = [];

    const sorted = [...params].sort((a, b) => a.index - b.index);
    for (const p of sorted) args[p.index] = undefined;

    // Lazily parsed once per request to avoid reading the body stream twice
    let cachedFormData: FormData | undefined;
    const getFormData = async (): Promise<FormData> => {
      if (!cachedFormData) cachedFormData = await c.req.formData();
      return cachedFormData;
    };

    // Resolve each parameter
    for (const param of params) {
      let value: unknown;

      switch (param.type) {
        case 'body': {
          const body = await c.req.json();
          value = param.schema ? await param.schema.parseAsync(body) : body;
          break;
        }

        case 'param': {
          const raw = param.name ? c.req.param(param.name) : c.req.param();
          value =
            param.schema && param.name
              ? await param.schema.parseAsync(raw)
              : raw;
          break;
        }

        case 'query': {
          const query = c.req.query();
          value = param.schema ? await param.schema.parseAsync(query) : query;
          break;
        }

        case 'headers': {
          value = param.name ? c.req.header(param.name) : c.req.header();
          break;
        }

        case 'user': {
          // Get user from context (set by auth middleware/guard)
          value = c.get('user');
          break;
        }

        case 'req': {
          value = c.req;
          break;
        }

        case 'res': {
          value = c;
          break;
        }

        case 'next': {
          value = undefined;
          break;
        }

        case 'sse': {
          value = sseStream;
          break;
        }

        case 'ip': {
          value = extractIp(c);
          break;
        }

        case 'device': {
          value = detectDevice(extractUserAgent(c));
          break;
        }

        case 'useragent': {
          value = extractUserAgent(c);
          break;
        }

        case 'uploadedfile': {
          const fd = await getFormData();
          value = param.name ? fd.get(param.name) : null;
          break;
        }

        case 'uploadedfiles': {
          const fd = await getFormData();
          const isFile = (v: FormDataEntryValue): v is File => typeof v !== 'string';
          if (param.name) {
            value = fd.getAll(param.name).filter(isFile);
          } else {
            value = [...fd.values()].filter(isFile);
          }
          break;
        }

        case 'formbody': {
          value = await getFormData();
          break;
        }

        default:
          value = undefined;
      }

      args[param.index] = value;
    }

    return args;
  }
}