# Changelog

## [3.3.0](https://github.com/Mad1Duck/hono-decorator/compare/v3.1.0...v3.3.0) (2026-09-28)

## [3.2.0](https://github.com/Mad1Duck/hono-decorator/compare/v3.1.0...v3.2.0) (2026-09-28)

## [3.1.0](https://github.com/Mad1Duck/hono-decorator/compare/v3.0.0...v3.1.0) (2026-09-28)

## [3.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v1.0.0...v3.0.0) (2026-06-02)

## [2.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v1.0.0...v2.0.0) (2026-06-02)

## [1.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.6...v1.0.0) (2026-06-02)

> **Major release** — migrated to TC39 Stage 3 decorators. No tsconfig flags, no `reflect-metadata`. See breaking changes below.

### Breaking Changes

#### TC39 Stage 3 decorators

**No tsconfig flags required.** Remove `experimentalDecorators` and `emitDecoratorMetadata` from your `tsconfig.json`.

**`reflect-metadata` removed** — uninstall it, remove any `import 'reflect-metadata'`.

**Parameter decorators replaced by Context helper functions.** `@Body`, `@Query`, `@Param`, etc. are now typed helper functions called inside the handler with the same names:

```ts
// Before
@Post()
async create(@Body(schema) body: CreateDto, @Param('id') id: string) { ... }

// After — same names, add c as first argument
@Post()
async create(c: Context) {
  const body = await Body(c, schema);  // fully typed: z.infer<typeof schema>
  const id   = Param(c, 'id');
}
```

Full migration map:

| Before | After |
|---|---|
| `@Body(schema)` | `await Body(c, schema)` |
| `@Param('id')` | `Param(c, 'id')` |
| `@Query()` | `Query(c)` |
| `@Query(schema)` | `await Query(c, schema)` |
| `@Headers('x-tok')` | `Headers(c, 'x-tok')` |
| `@User()` | `User(c)` / `User<T>(c)` |
| `@Ip()` | `Ip(c)` |
| `@Device()` | `Device(c)` |
| `@UserAgent()` | `UserAgent(c)` |
| `@Cookie('name')` | `Cookie(c, 'name')` |
| `@Cookies()` | `Cookies(c)` |
| `@UploadedFile('f')` | `await UploadedFile(c, 'f')` |
| `@UploadedFiles('f')` | `await UploadedFiles(c, 'f')` |
| `@FormBody()` | `await FormBody(c)` |
| `@Req()` | `Req(c)` |
| `@Ctx()` / `@Res()` | `Ctx(c)` |

**SSE handlers** now receive `(c: Context, stream: SSEStreamingApi)` as positional arguments — no `@SseStream()` needed.

**`@Injectable` requires explicit dependency tokens:**

```ts
// Before
@Injectable()
class UserService { constructor(private db: Database) {} }

// After
@Injectable([Database])
class UserService { constructor(private db: Database) {} }
```

**`@Inject(token)` parameter decorator removed.** Pass the token in the `@Injectable` array instead:

```ts
// Before
@Injectable()
class UserService { constructor(@Inject(DB) private db: AppDb) {} }

// After
@Injectable([DB])
class UserService { constructor(private db: AppDb) {} }
```

**`strictValidation` config option removed** — was only meaningful alongside `@Body()` without a schema.

### Fixed

- Bundle size: 112 KB → 52 KB (no bundled `reflect-metadata`)

---

## [0.2.6](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.5...v0.2.6) (2026-05-08)

## [0.2.5](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.3...v0.2.5) (2026-05-08)

## [0.2.4](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.3...v0.2.4) (2026-05-08)

## [0.2.3](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.2...v0.2.3) (2026-05-08)

## [0.2.2](https://github.com/Mad1Duck/hono-decorator/compare/v0.2.1...v0.2.2) (2026-05-08)

## 0.2.1 (2026-05-05)

All notable changes to `hono-forge` will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## Notes on v0.x history

> Content from v0.2.x entries has been consolidated — see git log for full details.

---

## [0.1.3] - 2026-05-05

### Added
- `@Throttle(ms)` — method decorator that limits call frequency per instance
- `@Memoize(opts?)` — method decorator with optional TTL caching
- `@ValidateResult(schema)` — validates method return value against a Zod schema

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
