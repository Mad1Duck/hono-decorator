import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

import { container } from './container';
import { defaultCacheAdapter } from './cache';
import type { CacheAdapter } from './cache';
import { HttpException } from './http-exception';
import { inMemoryRateLimiter } from './rate-limit';
import { createRequestContext, runInRequestContext } from './request-context';
import { METADATA_KEYS } from '../decorators/metadata';
import { extractIp, detectDevice, extractUserAgent } from '../utils/request';
import type { RequestLogger, RequestLogEntry } from '../utils/request';
import type {
  RouteMetadata,
  GuardMetadata,
  RateLimitMetadata,
  CacheMetadata,
  ChannelRouteMetadata,
  ModuleMetadata,
  OpenAPIMetadata,
  IdempotentMetadata,
  HeadersMetadata,
  RedirectMetadata,
  ResponseStatusMetadata,
  HonoMiddlewareFn,
} from '../decorators/metadata';
import type { SseOptions } from '../decorators/sse';
import type { ExceptionFilter, ExceptionFilterConstructor } from '../decorators/filters';
import { channels } from '../channels/registry';
import { SseChannelClient, WsChannelClient } from '../channels/clients';
import type { ChannelClient, WsLike } from '../channels/types';
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
  /** Pluggable store for @Cache / @CacheInvalidate — defaults to in-memory. */
  cacheAdapter?: CacheAdapter;
}

/** Serializable snapshot of a controller route's metadata — see describe(). */
export interface RouteDescription {
  method: RouteMetadata['method'];
  /** Full route path: controller basePath + route path. */
  path: string;
  handlerName: string;
  platform?: 'mobile' | 'web' | 'all';
  guards: GuardMetadata[];
  isPublic: boolean;
  isPrivate: boolean;
  /** Function names of class-level + method-level middleware, in execution order. */
  middlewares: string[];
  rateLimit?: RateLimitMetadata;
  cache?: CacheMetadata;
  /** Prefix patterns invalidated when this handler succeeds (@CacheInvalidate). */
  cacheInvalidate?: string[];
  sse: boolean;
  websocket: boolean;
  /** @ChannelRoute pattern — a function means it is resolved per request. */
  channelRoute?: ChannelRouteMetadata;
  /** @Idempotent — responses replayed per Idempotency-Key header. */
  idempotent?: IdempotentMetadata;
  /** @SingleFlight — concurrent identical requests share one execution. */
  singleFlight: boolean;
  /** @Redirect — route always redirects; handler never runs. */
  redirect?: RedirectMetadata;
  /** @Header static response headers. */
  headers?: HeadersMetadata;
}

/** JSON-safe snapshot of a Response, used by @Idempotent and @SingleFlight. */
export interface ResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  /** Base64-encoded body. */
  body: string;
}

export type { RequestLogger, RequestLogEntry };

/* ================= ROUTE BUILDER ================= */

export class HonoRouteBuilder {
  private static config: RouteBuilderConfig = {};

  /** In-flight request promises deduplicated by @SingleFlight / @Idempotent. */
  private static inflight = new Map<string, Promise<ResponseSnapshot>>();

  /** Read a Response into a JSON-safe snapshot (body base64-encoded). */
  private static async snapshotResponse(res: Response): Promise<ResponseSnapshot> {
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      // set-cookie is client-specific; length/framing is recomputed on replay.
      if (name === 'set-cookie' || name === 'content-length' || name === 'transfer-encoding') return;
      headers[name] = value;
    });
    const body = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { status: res.status, headers, body };
  }

  /** Rebuild a Response from a {@link ResponseSnapshot}. */
  private static restoreSnapshot(snap: ResponseSnapshot): Response {
    return new Response(Buffer.from(snap.body, 'base64'), {
      status: snap.status,
      headers: snap.headers,
    });
  }

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

  /**
   * Read-only introspection of a controller's routes — pure metadata read, no
   * instantiation, no app building. Useful for debugging, tests, and tooling.
   *
   * @example
   * const routes = HonoRouteBuilder.describe(UserController);
   * // [{ method: 'get', path: '/users', handlerName: 'list', guards: [...], ... }]
   */
  static describe<T>(ControllerClass: ControllerConstructor<T>): RouteDescription[] {
    const meta = classMeta(ControllerClass as unknown as Function);
    const controllerMeta = meta?.[METADATA_KEYS.CONTROLLER] as { basePath: string; } | undefined;
    if (!controllerMeta) return [];

    const routes = (meta?.[METADATA_KEYS.ROUTES] as RouteMetadata[] | undefined) ?? [];
    const allGuards = (meta?.[METADATA_KEYS.GUARDS] as Record<string, GuardMetadata[]> | undefined) ?? {};
    const allRateLimits = (meta?.[METADATA_KEYS.RATE_LIMIT] as Record<string, RateLimitMetadata> | undefined) ?? {};
    const allCache = (meta?.[METADATA_KEYS.CACHE] as Record<string, CacheMetadata> | undefined) ?? {};
    const allInvalidate = (meta?.[METADATA_KEYS.CACHE_INVALIDATE] as Record<string, string[]> | undefined) ?? {};
    const allMethodMws = (meta?.[METADATA_KEYS.METHOD_MIDDLEWARES] as Record<string, HonoMiddlewareFn[]> | undefined) ?? {};
    const classMws = (meta?.[METADATA_KEYS.MIDDLEWARES] as HonoMiddlewareFn[] | undefined) ?? [];
    const isPublicMap = (meta?.[METADATA_KEYS.IS_PUBLIC] as Record<string, boolean> | undefined) ?? {};
    const isPrivateMap = (meta?.[METADATA_KEYS.IS_PRIVATE] as Record<string, boolean> | undefined) ?? {};
    const sseMap = (meta?.[METADATA_KEYS.SSE_ROUTE] as Record<string, SseOptions> | undefined) ?? {};
    const wsMap = (meta?.[METADATA_KEYS.WEBSOCKET_ROUTE] as Record<string, boolean> | undefined) ?? {};
    const channelMap = (meta?.[METADATA_KEYS.CHANNEL_ROUTE] as Record<string, ChannelRouteMetadata> | undefined) ?? {};
    const idemMap = (meta?.[METADATA_KEYS.IDEMPOTENT] as Record<string, IdempotentMetadata> | undefined) ?? {};
    const sfMap = (meta?.[METADATA_KEYS.SINGLE_FLIGHT] as Record<string, boolean> | undefined) ?? {};
    const redirectMap = (meta?.[METADATA_KEYS.REDIRECT] as Record<string, RedirectMetadata> | undefined) ?? {};
    const headerMap = (meta?.[METADATA_KEYS.HEADERS] as Record<string, HeadersMetadata> | undefined) ?? {};

    const names = (mws: HonoMiddlewareFn[]) => mws.map(mw => mw.name || 'anonymous');

    return routes.map(route => ({
      method: route.method,
      path: `${controllerMeta.basePath}${route.path}`,
      handlerName: route.handlerName,
      platform: route.platform,
      guards: allGuards[route.handlerName] ?? [],
      isPublic: isPublicMap[route.handlerName] ?? false,
      isPrivate: isPrivateMap[route.handlerName] ?? false,
      middlewares: [...names(classMws), ...names(allMethodMws[route.handlerName] ?? [])],
      rateLimit: allRateLimits[route.handlerName],
      cache: allCache[route.handlerName],
      cacheInvalidate: allInvalidate[route.handlerName],
      sse: sseMap[route.handlerName] !== undefined,
      websocket: wsMap[route.handlerName] ?? false,
      channelRoute: channelMap[route.handlerName],
      idempotent: idemMap[route.handlerName],
      singleFlight: sfMap[route.handlerName] ?? false,
      redirect: redirectMap[route.handlerName],
      headers: headerMap[route.handlerName],
    }));
  }

  /**
   * Print a route table (method/path/handler/guards/...) for a controller or
   * @Module class — handy for verifying wiring at startup during development.
   * Pure metadata read, nothing is instantiated.
   */
  static printRoutes(target: Function): void {
    const controllers =
      classMeta(target)?.[METADATA_KEYS.MODULE] !== undefined
        ? this.collectModule(target, new Set()).controllers
        : [target];

    const rows = (controllers as ControllerConstructor[]).flatMap((ctrl) =>
      this.describe(ctrl).map((d) => ({
        method: d.method.toUpperCase(),
        path: d.path,
        handler: d.handlerName,
        guards: d.isPublic ? 'public' : (d.guards.map(g => g.name).join(',') || '-'),
        middleware: d.middlewares.join(',') || '-',
        flags: [
          d.cache ? `cache:${d.cache.ttl}ms` : '',
          d.sse ? 'sse' : '',
          d.websocket ? 'ws' : '',
          d.channelRoute ? 'channel' : '',
          d.idempotent ? 'idem' : '',
          d.singleFlight ? 'flight' : '',
          d.redirect ? `→${d.redirect.status}` : '',
        ].filter(Boolean).join(',') || '-',
      }))
    );

    if (rows.length === 0) {
      console.log('[hono-forge] No routes found.');
      return;
    }
    console.table(rows);
  }

  /**
   * Build a Hono app from an @Module class — collects controllers recursively
   * through `imports` (deduped) and eagerly resolves `providers` for fail-fast
   * DI validation. Providers decorated @RequestScoped are skipped eagerly —
   * they are resolved per request as usual.
   */
  static buildModule(
    ModuleClass: Function,
    platform?: 'mobile' | 'web',
    options?: { excludePrivate?: boolean; }
  ): Hono {
    const { controllers, providers } = this.collectModule(ModuleClass, new Set());

    for (const provider of providers) {
      const cls = provider as ConcreteConstructor;
      if (classMeta(cls)?.[METADATA_KEYS.REQUEST_SCOPED]) continue;
      container.resolve(cls);
    }

    const app = new Hono();
    for (const ctrl of controllers) {
      const cls = ctrl as ControllerConstructor;
      if (!classMeta(cls as unknown as Function)?.[METADATA_KEYS.CONTROLLER]) {
        throw new Error(
          `[hono-forge] buildModule: '${(cls as unknown as Function).name}' in module ` +
          `'${ModuleClass.name}' is not decorated with @Controller.`
        );
      }
      app.route('/', this.build(cls, platform, options));
    }
    return app;
  }

  private static collectModule(
    ModuleClass: Function,
    seen: Set<Function>
  ): { controllers: unknown[]; providers: unknown[]; } {
    if (seen.has(ModuleClass)) return { controllers: [], providers: [] };
    seen.add(ModuleClass);

    const modMeta = classMeta(ModuleClass)?.[METADATA_KEYS.MODULE] as ModuleMetadata | undefined;
    if (!modMeta) {
      throw new Error(
        `[hono-forge] buildModule: '${ModuleClass.name}' is not decorated with @Module.`
      );
    }

    const controllers = [...(modMeta.controllers ?? [])];
    const providers = [...(modMeta.providers ?? [])];
    for (const imported of modMeta.imports ?? []) {
      const sub = this.collectModule(imported as Function, seen);
      controllers.push(...sub.controllers);
      providers.push(...sub.providers);
    }
    return { controllers, providers };
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
          const filtered = await applyFilters(error, c);
          if (filtered) return filtered;
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

    // Exception filters: method-level run before class-level.
    const classFilters = (meta?.[METADATA_KEYS.EXCEPTION_FILTERS] as ExceptionFilterConstructor[] | undefined) ?? [];
    const allMethodFilters = (meta?.[METADATA_KEYS.METHOD_EXCEPTION_FILTERS] as Record<string, ExceptionFilterConstructor[]> | undefined) ?? {};
    const filterClasses = [...(allMethodFilters[handlerName] ?? []), ...classFilters];

    const applyFilters = async (error: unknown, c: Context): Promise<Response | undefined> => {
      for (const FilterClass of filterClasses) {
        const types = (classMeta(FilterClass)?.[METADATA_KEYS.CATCH] as Function[] | undefined) ?? [];
        const matches = types.length === 0 || types.some(t => typeof t === 'function' && error instanceof (t as new () => object));
        if (!matches) continue;
        const filter = container.resolve(FilterClass as unknown as ConcreteConstructor<ExceptionFilter>);
        const result = await filter.catch(error, c);
        if (result !== undefined) return result;
      }
      return undefined;
    };

    const allCache = (meta?.[METADATA_KEYS.CACHE] as Record<string, CacheMetadata> | undefined) ?? {};
    const cacheMeta = allCache[handlerName];
    const allInvalidate = (meta?.[METADATA_KEYS.CACHE_INVALIDATE] as Record<string, string[]> | undefined) ?? {};
    const invalidatePatterns = allInvalidate[handlerName];
    const cacheAdapter = this.config.cacheAdapter ?? defaultCacheAdapter;

    const routeLabel = `${method.toUpperCase()} ${basePath}${path}`;

    /* ----- Build Middleware Chain ----- */
    const middlewares: HonoMiddlewareFn[] = [
      ...classMiddlewares.map(wrapMiddleware),
      ...methodMiddlewares.map(wrapMiddleware),
    ];

    if (rateLimitMeta) {
      const rateLimiterFactory = this.config.rateLimiterFactory ?? inMemoryRateLimiter;
      middlewares.push(wrapMiddleware(rateLimiterFactory({
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

    const allChannelRoutes = (meta?.[METADATA_KEYS.CHANNEL_ROUTE] as Record<string, ChannelRouteMetadata> | undefined) ?? {};
    const channelPattern = allChannelRoutes[handlerName];
    const resolveChannel = (c: Context) =>
      typeof channelPattern === 'function' ? channelPattern(c) : channelPattern;

    /* ----- SSE Route ----- */
    const allSse = (meta?.[METADATA_KEYS.SSE_ROUTE] as Record<string, SseOptions> | undefined) ?? {};
    const sseMeta = allSse[handlerName];
    if (sseMeta) {
      const keepAliveMs = sseMeta.keepAliveMs;
      const sseHandler = ((c: Context) => {
        const startMs = Date.now();
        const ua = extractUserAgent(c);
        const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
        c.header('x-request-id', traceId);

        return streamSSE(c, async (stream) => {
          // SSE keepalive: periodic comment lines prevent proxies/load
          // balancers from closing idle connections.
          const keepAlive = keepAliveMs
            ? setInterval(() => {
                void stream.write(': keepalive\n\n').catch(() => { /* stream closed */ });
              }, keepAliveMs)
            : undefined;

          try {
            if (onRequestStart) await onRequestStart({ method: 'GET', path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });
            const ctx = createRequestContext(traceId, c);
            await runInRequestContext(ctx, () =>
              container.runInScope(async () => {
                const inst = getController();
                const fn = inst[handlerName];
                if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
                await fn.call(inst, c, stream);
              })
            );

            // @ChannelRoute: subscribe this stream and hold it open until the
            // client disconnects.
            if (channelPattern) {
              const channel = resolveChannel(c)!;
              const client = new SseChannelClient(crypto.randomUUID(), stream);
              await channels.subscribe(channel, client);
              try {
                await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
              } finally {
                await channels.unsubscribe(channel, client.id);
              }
            }

            if (requestLogger) {
              await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 200, durationMs: Date.now() - startMs, traceId });
            }
          } finally {
            if (keepAlive) clearInterval(keepAlive);
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
        const inst = runInRequestContext(createRequestContext(traceId, c), getController);
        const fn = inst[handlerName];
        if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);
        const result = (await fn.call(inst, c)) as Record<string, unknown> | undefined;

        // @ChannelRoute: wrap the returned WS event callbacks so connect/disconnect
        // automatically subscribe/unsubscribe a channel client.
        if (channelPattern) {
          const channel = resolveChannel(c)!;
          const events = result ?? {};
          let channelClient: ChannelClient | undefined;
          const userOnOpen = events['onOpen'] as ((e: unknown, ws: unknown) => unknown) | undefined;
          const userOnClose = events['onClose'] as ((e: unknown, ws: unknown) => unknown) | undefined;
          events['onOpen'] = async (evt: unknown, ws: unknown) => {
            channelClient = new WsChannelClient(crypto.randomUUID(), ws as WsLike);
            await channels.subscribe(channel, channelClient);
            await userOnOpen?.(evt, ws);
          };
          events['onClose'] = async (evt: unknown, ws: unknown) => {
            if (channelClient) await channels.unsubscribe(channel, channelClient.id);
            await userOnClose?.(evt, ws);
          };
          return events;
        }

        if (requestLogger) {
          await requestLogger({ method: 'GET', path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 101, durationMs: Date.now() - startMs, traceId });
        }

        return result;
      });

      register(fullPathNoSlash)('GET', ...middlewares, wsHandler);
      if (fullPathWithSlash !== fullPathNoSlash) register(fullPathWithSlash)('GET', ...middlewares, wsHandler);
      return;
    }

    /* ----- Response-shaping metadata ----- */
    const allIdempotent = (meta?.[METADATA_KEYS.IDEMPOTENT] as Record<string, IdempotentMetadata> | undefined) ?? {};
    const idemMeta = allIdempotent[handlerName];
    const allSingleFlight = (meta?.[METADATA_KEYS.SINGLE_FLIGHT] as Record<string, boolean> | undefined) ?? {};
    const singleFlight = allSingleFlight[handlerName] ?? false;
    const allHeaders = (meta?.[METADATA_KEYS.HEADERS] as Record<string, HeadersMetadata> | undefined) ?? {};
    const headerMeta = allHeaders[handlerName];
    const allRedirect = (meta?.[METADATA_KEYS.REDIRECT] as Record<string, RedirectMetadata> | undefined) ?? {};
    const redirectMeta = allRedirect[handlerName];
    const allStatus = (meta?.[METADATA_KEYS.RESPONSE_STATUS] as Record<string, ResponseStatusMetadata> | undefined) ?? {};
    const statusMeta = allStatus[handlerName];
    const allOpenApi = (meta?.[METADATA_KEYS.OPENAPI] as Record<string, OpenAPIMetadata> | undefined) ?? {};
    const deprecatedMeta = allOpenApi[handlerName]?.deprecated;

    /* ----- Standard HTTP Route ----- */
    const httpHandler = async (c: Context) => {
      const startMs = Date.now();
      const ua = extractUserAgent(c);
      const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();
      c.header('x-request-id', traceId);

      // @Redirect — the handler is never invoked.
      if (redirectMeta) return c.redirect(redirectMeta.location, redirectMeta.status);

      if (headerMeta) {
        for (const [name, value] of Object.entries(headerMeta)) c.header(name, value);
      }

      // RFC 9745: @ApiDeprecated emits Deprecation (+ optional Sunset) headers.
      if (deprecatedMeta) {
        c.header('Deprecation', 'true');
        const sunset = typeof deprecatedMeta === 'object' ? deprecatedMeta.sunset : undefined;
        if (sunset) c.header('Sunset', sunset);
      }

      if (onRequestStart) await onRequestStart({ method: c.req.method, path: c.req.path, traceId, ip: extractIp(c), userAgent: ua });

      // @Idempotent — replay the stored response for a repeated key.
      let idemKey: string | undefined;
      if (idemMeta) {
        const key = c.req.header('Idempotency-Key');
        if (key) {
          idemKey = `idem:${c.req.method} ${c.req.path}:${key}`;
          const hit = await cacheAdapter.get(idemKey);
          if (hit) {
            const snap = hit.value as ResponseSnapshot;
            if (requestLogger) {
              await requestLogger({ method: c.req.method, path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: snap.status, durationMs: Date.now() - startMs, traceId });
            }
            return HonoRouteBuilder.restoreSnapshot(snap);
          }
        }
      }

      let cacheKey: string | undefined;
      if (cacheMeta) {
        const url = new URL(c.req.url);
        cacheKey = `${cacheMeta.key ?? handlerName}:${url.pathname}${url.search}`;
        const hit = await cacheAdapter.get(cacheKey);
        if (hit) {
          if (requestLogger) {
            await requestLogger({ method: c.req.method, path: c.req.path, ip: extractIp(c), device: detectDevice(ua), userAgent: ua, statusCode: 200, durationMs: Date.now() - startMs, traceId });
          }
          return c.json(hit.value);
        }
      }

      const execute = () => {
        const ctx = createRequestContext(traceId, c);
        return runInRequestContext(ctx, () =>
          container.runInScope(async () => {
          try {
            const inst = getController();
            const fn = inst[handlerName];
            if (typeof fn !== 'function') throw new Error(`Handler ${handlerName} not found`);

            const result = await fn.call(inst, c);
            if (invalidatePatterns) {
              for (const pattern of invalidatePatterns) {
                await cacheAdapter.deletePattern(pattern);
              }
            }
            if (result instanceof Response) return result;
            if (statusMeta?.ignoreBody) return c.body(null, statusMeta.status as StatusCode);
            if (cacheMeta && cacheKey !== undefined && result !== undefined) {
              await cacheAdapter.set(cacheKey, result, cacheMeta.ttl);
            }
            if (result !== undefined) {
              return statusMeta ? c.json(result, statusMeta.status as ContentfulStatusCode) : c.json(result);
            }
            return c.body(null, statusMeta?.status as StatusCode | undefined);
          } catch (error: unknown) {
            const filtered = await applyFilters(error, c);
            if (filtered) return filtered;
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
      };

      // @SingleFlight / @Idempotent: dedupe concurrent identical requests —
      // every caller receives a copy of one shared response snapshot.
      const dedupeKey = singleFlight
        ? `sf:${c.req.method} ${c.req.url}`
        : idemKey
          ? `sf:${idemKey}`
          : undefined;

      const logRequest = async (statusCode: number) => {
        if (requestLogger) {
          await requestLogger({
            method: c.req.method,
            path: c.req.path,
            ip: extractIp(c),
            device: detectDevice(ua),
            userAgent: ua,
            statusCode,
            durationMs: Date.now() - startMs,
            userId: (c.get('user') as { id?: string; } | undefined)?.id,
            traceId,
          });
        }
      };

      if (!dedupeKey) {
        const response = await execute();
        await logRequest(response.status);
        return response;
      }

      const existing = HonoRouteBuilder.inflight.get(dedupeKey);
      if (existing) {
        const snap = await existing;
        await logRequest(snap.status);
        return HonoRouteBuilder.restoreSnapshot(snap);
      }

      const shared = execute().then((res) => HonoRouteBuilder.snapshotResponse(res));
      HonoRouteBuilder.inflight.set(dedupeKey, shared);
      let snap: ResponseSnapshot;
      try {
        snap = await shared;
      } finally {
        HonoRouteBuilder.inflight.delete(dedupeKey);
      }

      // Only successful responses are replayable via Idempotency-Key — a
      // failed attempt must be retried, not replayed.
      if (idemKey && snap.status >= 200 && snap.status < 300) {
        await cacheAdapter.set(idemKey, snap, idemMeta!.ttl ?? 86_400_000);
      }

      await logRequest(snap.status);
      return HonoRouteBuilder.restoreSnapshot(snap);
    };

    const httpMethod = method === 'head' ? 'GET' : method;
    register(fullPathNoSlash)(httpMethod, ...middlewares, httpHandler);
    if (fullPathWithSlash !== fullPathNoSlash) register(fullPathWithSlash)(httpMethod, ...middlewares, httpHandler);
  }
}
