import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ZodError } from 'zod';

import { container } from './container';
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
import type { AbstractConstructor, ConcreteConstructor, ControllerInstance } from './types';

/* ================= TYPES ================= */

/**
 * Global error handler for unhandled route errors.
 * Return a Response to send to the client; re-throw to let Hono handle it.
 *
 * @example
 * HonoRouteBuilder.configure({
 *   onError: (err, c) => {
 *     console.error(err);
 *     return c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500);
 *   },
 * });
 */
export type ErrorHandler = (error: unknown, c: Context) => Response | Promise<Response>;

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
    ControllerClass: AbstractConstructor<T>,
    platform?: 'mobile' | 'web'
  ): Hono {
    const app = new Hono();

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

    /* ----- Filter Routes by Platform ----- */
    const platformRoutes = routes.filter((route) => {
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

    // 1. Class-level middlewares
    middlewares.push(...classMiddlewares);

    // 2. Method-level middlewares
    middlewares.push(...methodMiddlewares);

    const routeLabel = `${method.toUpperCase()} ${basePath}${path}`;

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

      middlewares.push(rateLimitMiddleware);
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

    // Hono's generic types can't infer spread middleware arrays via app[method](),
    // so we cast to a narrower interface that exposes exactly what we need.
    type HonoWithOn = { on(method: string, path: string, ...handlers: HonoMiddlewareFn[]): Hono };
    const register = (m: string, ...handlers: HonoMiddlewareFn[]) =>
      (app as unknown as HonoWithOn).on(m.toUpperCase(), fullPath, ...handlers);

    /* ----- SSE Route ----- */
    const isSse = Reflect.getMetadata(
      METADATA_KEYS.SSE_ROUTE, proto, handlerName
    ) as boolean | undefined;

    if (isSse) {
      register('GET', ...middlewares, ((c: Context) => {
        return streamSSE(c, async (stream) => {
          const args = await this.resolveParameters(params, c, stream);
          const fn = controllerInstance[handlerName];
          if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
          await fn.apply(controllerInstance, args);
        });
      }) as unknown as HonoMiddlewareFn);
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
        const args = await this.resolveParameters(params, c);
        const fn = controllerInstance[handlerName];
        if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
        return fn.apply(controllerInstance, args);
      });
      register('GET', ...middlewares, wsHandler);
      return;
    }

    /* ----- Standard HTTP Route ----- */
    const requestLogger = this.config.requestLogger;
    const onError = this.config.onError;
    const httpHandler = async (c: Context) => {
      const startMs = Date.now();
      let response: Response;

      try {
        const args = await this.resolveParameters(params, c);
        const fn = controllerInstance[handlerName];

        if (typeof fn !== 'function') {
          throw new Error(`Handler ${handlerName} not found`);
        }

        const result = await fn.apply(controllerInstance, args);
        response = result !== undefined ? c.json(result) : c.body(null);
      } catch (error: unknown) {

        if (error instanceof ZodError) {
          response = c.json(
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
        } else if (onError) {
          response = await onError(error, c);
        } else {
          throw error;
        }
      }

      if (requestLogger) {
        const ua = extractUserAgent(c);
        const entry: RequestLogEntry = {
          method: c.req.method,
          path: c.req.path,
          ip: extractIp(c),
          device: detectDevice(ua),
          userAgent: ua,
          statusCode: response.status,
          durationMs: Date.now() - startMs,
          userId: (c.get('user') as { id?: string } | undefined)?.id,
        };
        await requestLogger(entry);
      }

      return response;
    };

    // Hono doesn't route app.on('HEAD',...) — register as GET so Hono's
    // automatic HEAD-for-GET fallback returns correct headers with no body.
    const httpMethod = method === 'head' ? 'GET' : method;
    register(httpMethod, ...middlewares, httpHandler);
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

        default:
          value = undefined;
      }

      args[param.index] = value;
    }

    return args;
  }
}