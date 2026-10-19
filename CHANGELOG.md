# Changelog

## [6.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.6.2...v6.0.0) (2026-10-19)

### ⚠ BREAKING CHANGES

* `createApp` is now async — returns `Promise<Hono>` and awaits `container.boot()` after wiring; call sites must `await createApp(...)` ([146c779](https://github.com/Mad1Duck/hono-decorator/commit/146c7798114b315d314c65562d52286b92b8a46f))

### Features

* schema-first `ValidatedBody` / `ValidatedQuery` / `ValidatedParams` — return type infers as `z.infer<typeof schema>` with no manual generics; cache-first on the `@Validate` context keys, self-sufficient `schema.parseAsync` fallback on undecorated routes, schema-less calls degrade to the raw helpers ([146c779](https://github.com/Mad1Duck/hono-decorator/commit/146c7798114b315d314c65562d52286b92b8a46f))
* `createApp` auto-boots — `container.boot()` runs automatically so providers' `onInit()` hooks fire under the recommended entrypoint; `boot: false` escape hatch for tests managing the lifecycle manually ([146c779](https://github.com/Mad1Duck/hono-decorator/commit/146c7798114b315d314c65562d52286b92b8a46f))
* strict DI — `@Injectable(deps, { strict: true })` per class or `createApp(AppModule, { strictDi: true })` / `container.strictDi` globally makes bare `new` on injectable classes throw a "DI bypass" error; `container.construct(cls, ...args)` is the documented escape hatch for tests/scripts ([146c779](https://github.com/Mad1Duck/hono-decorator/commit/146c7798114b315d314c65562d52286b92b8a46f))

### Bug Fixes

* class-based middleware (`@Middleware(Foo)`) instantiated via `container.construct()` so `@Injectable` middleware keeps working under strict DI ([146c779](https://github.com/Mad1Duck/hono-decorator/commit/146c7798114b315d314c65562d52286b92b8a46f))

## [5.6.2](https://github.com/Mad1Duck/hono-decorator/compare/v5.6.1...v5.6.2) (2026-10-12)

## [5.6.1](https://github.com/Mad1Duck/hono-decorator/compare/v5.6.0...v5.6.1) (2026-10-11)

### Features

* generated flows emit complete request/response metadata ([c6c4e98](https://github.com/Mad1Duck/hono-decorator/commit/c6c4e989d014d77c2984dd9f68166e435b9dd992))
* generated flows now carry request bodies for all mutations ([591e61e](https://github.com/Mad1Duck/hono-decorator/commit/591e61e25d7fff424c8de46b12d45c17be2a3008))

## [5.6.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.5.2...v5.6.0) (2026-10-11)

### Features

* durable cache adapters (Redis/Postgres) + named per-decorator selection, flows --auth preamble ([b95af23](https://github.com/Mad1Duck/hono-decorator/commit/b95af2304c595d832217f686378551c83eca6c94)), closes [#5](https://github.com/Mad1Duck/hono-decorator/issues/5) [#6](https://github.com/Mad1Duck/hono-decorator/issues/6)

## [5.5.2](https://github.com/Mad1Duck/hono-decorator/compare/v5.5.1...v5.5.2) (2026-10-11)

### Bug Fixes

* CLI bun re-exec, @Idempotent body-hash+scope, doctor injectable resolution, @ChannelAuth ([40c4060](https://github.com/Mad1Duck/hono-decorator/commit/40c4060e86103832c214e6e23048d3b720eb4267)), closes [#1](https://github.com/Mad1Duck/hono-decorator/issues/1) [#2](https://github.com/Mad1Duck/hono-decorator/issues/2) [#3](https://github.com/Mad1Duck/hono-decorator/issues/3)

## [5.5.1](https://github.com/Mad1Duck/hono-decorator/compare/v5.5.0...v5.5.1) (2026-10-11)

### Features

* hono-forge schema command - export Drizzle tables to .schema.yaml ([fccd850](https://github.com/Mad1Duck/hono-decorator/commit/fccd85043a0b1699c1489b05b12b9d0db95b4e22))
* schema command sources beyond Drizzle — prisma, live pg, file passthrough ([ee3962c](https://github.com/Mad1Duck/hono-decorator/commit/ee3962c8e9907a4188c5f27987153662ced40e8c))
* seed response-shape assertions from @Serialize in generated flows ([ffc6e0e](https://github.com/Mad1Duck/hono-decorator/commit/ffc6e0e23f8a7920308cabfbac7829ec8b18c4c5))

## [5.5.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.3.0...v5.5.0) (2026-10-11)

### Features

* @Serialize, @ApiSecurity, SetCookie, createApp({cors}), CLI outputs ([cba9ad3](https://github.com/Mad1Duck/hono-decorator/commit/cba9ad33b50064ff0a0c608eb44562f96e73cedd))
* `hono-forge init` scaffolding and `@JwtAuth` OpenAPI security ([0294c3f](https://github.com/Mad1Duck/hono-decorator/commit/0294c3fb4a10351f84b83cab7c4fe8e734b022b1))
* add request drain, route collision warnings, and `doctor` CLI command ([e4d7374](https://github.com/Mad1Duck/hono-decorator/commit/e4d7374ea240b37838a524c07ef5f9b106dbb37f))

## [6.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.3.0...v6.0.0) (2026-10-11)

### Features

* @Serialize, @ApiSecurity, SetCookie, createApp({cors}), CLI outputs ([cba9ad3](https://github.com/Mad1Duck/hono-decorator/commit/cba9ad33b50064ff0a0c608eb44562f96e73cedd))
* `hono-forge init` scaffolding and `@JwtAuth` OpenAPI security ([0294c3f](https://github.com/Mad1Duck/hono-decorator/commit/0294c3fb4a10351f84b83cab7c4fe8e734b022b1))
* add request drain, route collision warnings, and `doctor` CLI command ([e4d7374](https://github.com/Mad1Duck/hono-decorator/commit/e4d7374ea240b37838a524c07ef5f9b106dbb37f))

## [5.4.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.3.0...v5.4.0) (2026-10-09)

## [5.3.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.2.0...v5.3.0) (2026-10-09)

## [5.2.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.1.0...v5.2.0) (2026-10-09)

## [5.1.0](https://github.com/Mad1Duck/hono-decorator/compare/v5.0.0...v5.1.0) (2026-10-08)

## [5.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v4.0.0...v5.0.0) (2026-09-29)

### Features

* add CI, Node smoke test, rate-limit headers, event wildcards, and repo hygiene ([79699bd](https://github.com/Mad1Duck/hono-decorator/commit/79699bd1a5a9957977aa8ad94c6e1790cdb4c5b4))
* add config validation, event bus, scheduler, circuit breaker, request context API, versioning, and status decorators ([5a1e55c](https://github.com/Mad1Duck/hono-decorator/commit/5a1e55c640fe418c4c7ef0f92eb7fc4ed6659d5c))
* add operational helpers, idempotency, single-flight, SSE keepalive, and logger DI ([f8cf07a](https://github.com/Mad1Duck/hono-decorator/commit/f8cf07aa7b27a376ce91438a1ce4d69dcb447231))

## [4.0.0](https://github.com/Mad1Duck/hono-decorator/compare/v3.3.0...v4.0.0) (2026-09-28)

### ⚠ BREAKING CHANGES

* OpenAPI operationId now includes the controller class name (e.g. get_UserController_list). Regenerate API clients. channels.unsubscribe() now removes every connection with the given id.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>

### Features

* add modules, exception filters, channel bridge, typed client, testing utils, and JWT auth ([672ba89](https://github.com/Mad1Duck/hono-decorator/commit/672ba89c55612095444009b218e9055c25dbf0a7))

### Bug Fixes

* response passthrough, request-scoped DI, error status codes, input handling, and channel leaks ([5c7ecb8](https://github.com/Mad1Duck/hono-decorator/commit/5c7ecb8153887a0c2b254deebf94d90ab547f945))

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
