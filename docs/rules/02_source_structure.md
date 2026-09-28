# Source Structure Rules (src/)

## Directory layout

```
src/
├── index.ts              # barrel — re-exports core/, decorators/, channels/, utils/, openapi/
├── core/                 # runtime internals
│   ├── container.ts      # DI container: register/resolve, scopes, circular detection, OnInit/OnDestroy
│   ├── route-builder.ts  # HonoRouteBuilder — turns controller metadata into Hono routes
│   ├── request-context.ts# per-request AsyncLocalStorage context (trace id, request-scoped DI)
│   ├── http-exception.ts # HttpException + error response shaping
│   ├── types.ts          # shared core types (constructors, instances)
│   └── index.ts
├── decorators/           # all public decorators + context helpers
│   ├── metadata.ts       # METADATA_KEYS + metadata types (single registry — add keys here)
│   ├── controller.ts     # @Controller + HTTP method decorators (@Get, @Post, …, @All)
│   ├── param.ts          # context helpers: Body, Param, Query, Headers, User, Ip, Device, Cookie, UploadedFile, …
│   ├── guard.ts          # @RequireAuth, @RequireRole, @RequirePermission, @Public/@Private, …
│   ├── interceptor.ts    # @Retry, @Timeout, @Transform, @Cache, @TrackMetrics, @Throttle, @Memoize, …
│   ├── middleware.ts     # @Middleware / @Use + class-based middleware
│   ├── common-middleware.ts # built-ins: @Cors, @Compress, @SecureHeaders, @PrettyJson
│   ├── sse.ts            # @Sse
│   ├── websocket.ts      # @WebSocket
│   ├── openapi.ts        # @Api* decorators feeding the OpenAPI generator
│   ├── custom.ts         # custom/parameter-decorator escape hatches
│   └── index.ts
├── channels/             # pub/sub for SSE & WS
│   ├── types.ts          # ChannelAdapter, ChannelClient, RedisPubClient/RedisSubClient interfaces
│   ├── registry.ts       # ChannelRegistry + global `channels` singleton
│   ├── memory.adapter.ts # default in-memory adapter
│   ├── redis.adapter.ts  # Redis adapter — takes consumer-injected pub/sub clients
│   ├── clients.ts        # SseChannelClient / WsChannelClient bridges
│   └── index.ts
├── openapi/
│   ├── generator.ts      # OpenAPIGenerator — OpenAPI 3.1 spec from route metadata + zod schemas
│   └── index.ts
└── utils/
    ├── discover.ts       # discoverControllers (Bun fs scan) / fromModules (bundler-agnostic)
    ├── pagination.ts     # paginate, paginatedSchema, PaginationQuerySchema
    ├── schema.ts         # defineSchemas — per-table CRUD schema bundles
    ├── request.ts        # extractIp, detectDevice, extractUserAgent, RequestLogger types
    ├── trace.ts          # getTraceId, runWithTraceId
    ├── transaction.ts    # useTransaction helper
    └── index.ts
```

## Conventions

- **Every folder has an `index.ts` barrel**; `src/index.ts` re-exports them all. New public symbol = export from its file + its folder barrel.
- **Metadata keys are centralized** in `src/decorators/metadata.ts` (`METADATA_KEYS`) — decorators write, `route-builder.ts` reads. Never scatter ad-hoc symbols.
- **Types that describe a public option live next to the feature** (e.g. `GuardExecutor`, `RateLimiterFactory` in `route-builder.ts`; `ChannelAdapter` in `channels/types.ts`) and are exported for consumers.
- `import type` for type-only imports (`verbatimModuleSyntax` is on); single quotes; section banner comments (`/* ===== NAME ===== */`) as in existing files.

## Dependency rules

- `decorators/` may import from `core/` and `utils/` — never the reverse (core must not know decorator APIs, only metadata keys).
- `channels/`, `openapi/`, `utils/` are leaf-ish areas — they may use `core/` types but not `decorators/`.
- No circular imports; keep the flow `decorators → core → utils` one-directional.
- Only `hono` (and `hono/streaming`), `zod`, and Bun/Node/TS built-ins may be imported in `src/`. Optional integrations are injected (`RedisChannelAdapter` takes `RedisPubClient`/`RedisSubClient`).

## Tests

- Mirror structure in `tests/` — one `*.test.ts` per area (`decorators`, `container`, `route-builder`, `channels`, `openapi`, `logging`).

## Verification

- `bun run type-check` and `bun test` must stay clean after any refactor.
