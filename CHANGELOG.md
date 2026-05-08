# Changelog

## [0.2.4](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.3...v0.2.4) (2026-05-08)

## [0.2.3](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.2...v0.2.3) (2026-05-08)

## [0.2.2](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.1...v0.2.2) (2026-05-08)

## 0.2.1 (2026-05-05)

All notable changes to `hono-forge` will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Error Handling
- `HttpException` — structured HTTP error class with `status`, `code`, `message`, and optional `meta` payload
  - Static factories: `HttpException.badRequest()`, `.unauthorized()`, `.forbidden()`, `.notFound()`, `.conflict()`, `.unprocessable()`, `.tooManyRequests()`, `.internal()`, `.serviceUnavailable()`
  - Automatically handled by the route builder — returns correct HTTP status code + consistent JSON: `{ status, error: { code, message, meta? } }`
  - `onError` hook is called **before** the default response is sent — use it to persist errors to a database or external service without needing to handle the HTTP serialization yourself
- `exposeStack` option in `HonoRouteBuilder.configure()` — controls stack trace exposure in `HttpException` responses
  - `false` (default) — stack never exposed (production-safe)
  - `true` — stack always included in response body
  - `'development'` — stack included only when `NODE_ENV !== 'production'`
- `ErrorHandler` now returns `Response | void` instead of `Response` — returning `void` from `onError` falls through to default handling (auto-format `HttpException`, re-throw others), returning a `Response` fully overrides the reply

#### Observability
- **Trace ID / Correlation ID** — every request automatically gets a `traceId` from the `X-Request-ID` header (or a generated UUID if absent). The ID is echoed back as `X-Request-ID` on the response.
- `getTraceId()` — returns the active trace ID from `AsyncLocalStorage`; callable from anywhere in the call chain (services, repos, loggers) without passing it explicitly.
- `runWithTraceId(id, fn)` — exported for running code outside the route builder within a trace context.
- `requestLogger` now receives `traceId` in every `RequestLogEntry`.
- `onRequestStart` hook — called before middleware and guards on every request with `{ method, path, traceId, ip, userAgent }`. Use this to start an OpenTelemetry span or attach context to a logger.
- `requestLogger` now called for **SSE** connections (on stream open, status 200) and **WebSocket** upgrades (status 101) — previously these were not logged.

#### Concurrency safety
- `@Memoize({ scope: 'request' })` — per-request cache using `AsyncLocalStorage`; isolates results between concurrent requests. Use on singletons that return user-specific data. Default scope remains `'global'` (shared cache, suitable for config/DB lookups).
- `runWithMemoScope(fn)` — initializes the memoize request scope; called automatically by `HonoRouteBuilder` for every HTTP handler.
- `@Stateless()` — no-op marker decorator for `@Singleton()` classes that hold no mutable per-request state. Documents intent and can be enforced by future linting tools.

### Changed

#### `@Stateless()` — now enforces immutability at runtime
- Previously a no-op marker with no enforcement
- Resolved `@Stateless @Singleton` instances are now wrapped in a `Proxy` that **throws** if any property is written to after the constructor finishes
- Reading is always allowed; writes throw `[hono-forge] @Stateless singleton '...' attempted to mutate property '...'`
- Does not affect manually registered instances (`registerInstance` / `registerSingleton`)

#### `@Throttle` — per-instance state instead of shared closure
- `lastCall` was a decorator-factory closure variable, shared across **all instances** of a class decorated with `@Throttle`
- Replaced with `WeakMap<object, number>` keyed by `this` — each class instance now has its own throttle window
- **Transient classes**: each resolved instance is independent (correct) 
- **Singletons**: all requests share the throttle window (intended — global method rate limiting)

#### Middleware exception formatting
- Errors thrown inside class-level or method-level `@Middleware` functions previously bypassed the `onError` hook and fell through to Hono's default plain-text 500 handler
- All user-supplied middlewares (class, method, rate-limit) are now wrapped in `wrapMiddleware`, which routes exceptions through the same `ZodError → 400`, `HttpException → correct status`, `onError hook`, `re-throw` pipeline used by the HTTP handler
- Guard middleware was already handled separately and is unchanged

#### AsyncLocalStorage consolidation
- **3 separate `AsyncLocalStorage` instances** (trace, memoize, DI scope) merged into a **single `AsyncLocalStorage<RequestContext>`** — reduces per-request ALS overhead from 3× `.run()` calls to 1×
- Improves throughput in high-concurrency and edge runtime scenarios (Cloudflare Workers, Vercel Edge)
- All public APIs remain unchanged: `getTraceId()`, `runWithTraceId()`, `runWithMemoScope()`, `container.runInScope()` still work identically
- New internal `src/core/request-context.ts` holds the unified context; not part of the public API

### Added

#### Validation enforcement
- `strictValidation` option in `HonoRouteBuilder.configure()` — checks mutation routes (POST, PUT, PATCH) for `@Body()` usage without a Zod schema at `build()` time
  - `'warn'` (default) — logs `console.warn` at build time
  - `'error'` — throws at build time; recommended for CI / production builds
  - `'off'` — disables the check
- `@FormBody()` is excluded from the check (multipart form data cannot carry a Zod schema)

#### DI — Request-scoped instances
- `@RequestScoped()` — marks a class as request-scoped; a fresh instance is created per request and shared within it
- `container.runInScope(fn)` — runs `fn` inside a new request scope; `onDestroy` is called on all scoped instances in the `finally` block (even on error)
- `HonoRouteBuilder` automatically wraps every HTTP handler in `container.runInScope()` — no manual setup needed

#### DI — Lifecycle hooks
- `OnInit` interface — `onInit(): Promise<void> | void`; called by `container.boot()` for singletons
- `OnDestroy` interface — `onDestroy(): Promise<void> | void`; called by `container.shutdown()` for singletons, automatically for request-scoped instances
- `container.boot()` — initializes all registered singleton instances that implement `OnInit` (call at app startup, before `app.listen()`)
- `container.shutdown()` — destroys all singletons in reverse registration order (call in SIGTERM/SIGINT handler)

---

## [0.2.0] - 2026-05-05

### Added

#### File Upload
- `@UploadedFile(fieldName)` — injects a single `File` from multipart form data
- `@UploadedFiles(fieldName?)` — injects an array of `File` objects (all files if no field name)
- `@FormBody()` — injects the raw `FormData` object
- FormData is parsed lazily and cached per request (single read, multiple decorators safe)

#### Built-in Middleware Decorators
- `@Cors(opts?)` — wraps `hono/cors`
- `@Compress(opts?)` — wraps `hono/compress`
- `@SecureHeaders(opts?)` — wraps `hono/secure-headers`
- `@PrettyJson(opts?)` — wraps `hono/pretty-json`
- All accept the same options as the underlying Hono middleware

#### Database / Transaction
- `@Transaction(executor?)` — now propagates `tx` via `AsyncLocalStorage` instead of mutating `this.db`
- `useTransaction<TDb>()` — retrieves the active transaction from async context (for use in repositories)
- `registerInstance(token, value)` — cleaner alias for registering pre-built objects (Drizzle, Redis, etc.)
- `TransactionExecutor<TDb>` — exported type for custom ORM adapters (Prisma, Kysely, etc.)

#### Pagination Utilities
- `paginate(data, total, { page, limit })` — builds standard `{ data, meta }` paginated response
- `PaginationQuerySchema` — Zod schema for `page` / `limit` query params with coercion and defaults
- `paginatedSchema(itemSchema)` — wraps item schema into full paginated response schema
- Exported types: `PaginatedResult<T>`, `PaginationMeta`, `PaginationQuery`

#### Schema Utilities
- `defineSchemas(select, insert, options?)` — generates `{ select, insert, update }` schema set
  - Works with `drizzle-zod`, `zod-prisma`, or hand-written Zod objects
  - Accepts optional `{ update }` override for custom PATCH validation rules

#### Guards & Visibility
- `@Private()` — marks a route as internal-only
- `HonoRouteBuilder.build(Ctrl, platform, { excludePrivate: true })` — filters out private routes at build time

#### Type Safety
- Phantom brand type `HonoForgeController` — compile-time enforcement that only `@Controller`-decorated classes are passed to `build()`
- `ControllerConstructor<T>` — exported utility type for typed controller references

#### DI Container
- `@Use` — alias for `@Middleware` (NestJS-style)
- `ValidatedBody<T>(schema)`, `ValidatedQuery<T>(schema)`, `ValidatedParam<T>(schema)` — type-safe parameter decorator aliases

#### Real-time
- `@Sse()` — SSE route decorator
- `@SseStream` — injects `SSEStreamingApi` into the handler
- `@WebSocket()` — WebSocket route decorator

### Fixed
- Guard decorators (`@RequireAuth`, `@RequireRole`, etc.) were mutating shared metadata arrays via `.push()` — replaced with spread to prevent cross-request state corruption
- `@Private()` execution order bug — now uses a dedicated metadata key instead of reading `ROUTES` metadata before `@Get`/`@Post` is applied

### Changed
- `@Transaction()` no longer swaps `this.db` on the class instance — uses `AsyncLocalStorage` for safe async propagation
- `src/core/index.ts` now re-exports `./types` so `ControllerConstructor` and `HonoForgeController` are accessible from the main package entry

---

## [0.1.3] - 2026-05-05

### Added
- `@Throttle(ms)` — method decorator that limits call frequency
- `@Memoize(opts?)` — method decorator with optional TTL caching
- `@ValidateResult(schema)` — validates method return value against a Zod schema
- `@Audit({ action })` — logs an audit entry before execution (uses `this.logger` or `console.log`)
- `defineSchemas` — initial version (no custom update option)
- OpenAPI generation via `OpenAPIGenerator`
- `discoverControllers` (Bun glob-based) and `fromModules` (bundler-agnostic) auto-discovery

### Fixed
- Metadata reflection version incompatibility with newer `reflect-metadata` releases

---

## [0.1.2] - 2026-05-04

### Added
- `@RequireAllRoles(...roles)` — requires ALL specified roles (stricter than `@RequireRole`)
- `@RequirePermission(...perms)` — requires ALL permissions
- `@RequireAnyPermission(...perms)` — requires at least ONE permission
- `@RateLimit(opts)` — pluggable rate limiting via `rateLimiterFactory`
- `requestLogger` hook — per-request logging with IP, device, UA, status, duration
- `onError` hook — global error handler for unhandled route exceptions
- SSE channel pub/sub system (`channels`, `SseChannelClient`)
- WebSocket channel pub/sub (`WsChannelClient`)
- Redis channel adapter support

### Fixed
- Logger not called for WebSocket upgrade paths

---

## [0.1.1] - 2026-05-04

### Added
- `@Retry(opts)` — retries method on failure with optional backoff
- `@Timeout(ms)` — rejects after timeout
- `@Transform(fn)` — transforms method return value
- `@Cache(opts)` — caches method result with TTL
- `@TrackMetrics(opts?)` — records method duration via `this.metrics`
- `@Singleton()` — marks a class as a singleton in the DI container
- `@Inject(token)` — injects by token (for interfaces / external values)
- `InjectionToken<T>` — typed token factory

### Changed
- Route builder now validates guard executor and rate limiter presence at `build()` time (fail-fast)

---

## [0.1.0] - 2026-05-03

### Added
- Initial release
- `@Controller(basePath, opts?)` — class decorator for route grouping
- `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options`, `@All` — HTTP method decorators
- `@Body(schema?)`, `@Query(key)`, `@Param(key)`, `@Headers(key?)` — parameter injection
- `@User()`, `@Ip()`, `@Device()`, `@UserAgent()`, `@Req()`, `@Res()`, `@Context()` — context injection
- `@RequireAuth()`, `@RequireRole(...roles)` — guard decorators with pluggable `guardExecutor`
- `@Public()` — bypasses guards on a route
- `@Middleware(fn)` — applies Hono middleware at class or method level
- `@Injectable()` — marks class for DI container
- `HonoRouteBuilder.build(Controller, platform?)` — registers controller routes on a Hono app
- `HonoRouteBuilder.configure(opts)` — sets global executor, logger, error handler
- `container` — global DI container with circular dependency detection
- Zod validation errors return `400` with `{ status, error: { code, message, details } }`

[Unreleased]: https://github.com/Mad1Duck/hono-decorator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Mad1Duck/hono-decorator/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/Mad1Duck/hono-decorator/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Mad1Duck/hono-decorator/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Mad1Duck/hono-decorator/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Mad1Duck/hono-decorator/releases/tag/v0.1.0
