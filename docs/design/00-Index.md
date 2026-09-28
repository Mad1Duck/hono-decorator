---
tags: [hono-forge, design, index]
status: current
---

# hono-forge — Design & Feature Map

> **Satu kalimat:** Library TypeScript yang memberi Hono pengalaman NestJS — `@Controller`, DI container, guards, interceptors, SSE/WS, channels, dan OpenAPI — tanpa `reflect-metadata`, tanpa `experimentalDecorators`, zero runtime dependency.

Dokumen ini adalah peta fitur untuk maintainer/agent. Detail API lengkap dan contoh pemakaian ada di `README.md` root — file ini menjelaskan *apa* yang ada dan *di mana* implementasinya.

## Peta Fitur → Implementasi

| Fitur | Public API | Implementasi |
|-------|-----------|--------------|
| Controller routing | `@Controller`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`/`@Head`/`@Options`/`@All` | `src/decorators/controller.ts` → `src/core/route-builder.ts` |
| Context helpers | `Body`, `Param`, `Query`, `Headers`, `User`, `Ip`, `Device`, `Cookie`, `UploadedFile`, … | `src/decorators/param.ts` |
| Dependency injection | `@Injectable([deps])`, `@Singleton`, `@RequestScoped`, `@Stateless`, `container` | `src/core/container.ts` |
| Lifecycle | `OnInit`/`OnDestroy`, `container.boot()`/`shutdown()` | `src/core/container.ts` |
| Guards | `@RequireAuth`, `@RequireRole`, `@RequireAllRoles`, `@RequirePermission`, `@RequireAnyPermission`, `@Public`/`@Private` + pluggable `GuardExecutor` | `src/decorators/guard.ts` |
| Rate limiting | `@RateLimit` + pluggable `RateLimiterFactory` | `src/decorators/` + `route-builder.ts` |
| Middleware | `@Middleware`/`@Use`, class-based; built-ins `@Cors`, `@Compress`, `@SecureHeaders`, `@PrettyJson` | `src/decorators/middleware.ts`, `common-middleware.ts` |
| Interceptors | `@Retry`, `@Timeout`, `@Transform`, `@Cache`, `@TrackMetrics`, `@Throttle`, `@Memoize` | `src/decorators/interceptor.ts` |
| SSE | `@Sse` — handler `(c, stream)` | `src/decorators/sse.ts` |
| WebSocket | `@WebSocket` + pluggable `WebSocketUpgrader` | `src/decorators/websocket.ts` |
| Channels (pub/sub) | `channels` registry, `SseChannelClient`, `WsChannelClient`, `InMemoryChannelAdapter`, `RedisChannelAdapter` | `src/channels/` |
| Auto-discovery | `discoverControllers` (Bun), `fromModules` (bundler) | `src/utils/discover.ts` |
| Pagination | `paginate`, `paginatedSchema`, `PaginationQuerySchema` | `src/utils/pagination.ts` |
| Table schemas | `defineSchemas` — CRUD schema bundle per table | `src/utils/schema.ts` |
| OpenAPI 3.1 | `OpenAPIGenerator`, `@Api*` decorators, Scalar UI | `src/openapi/generator.ts`, `src/decorators/openapi.ts` |
| Request logging | pluggable `requestLogger` (IP, device, UA, duration) | `src/utils/request.ts` + `route-builder.ts` |
| Error handling | `HttpException`, `onError` hook, `exposeStack` | `src/core/http-exception.ts`, `route-builder.ts` |
| Observability | trace/correlation ID, `onRequestStart`, `runWithTraceId` | `src/utils/trace.ts`, `src/core/request-context.ts` |
| Transactions | `useTransaction` | `src/utils/transaction.ts` |
| Custom decorators | escape hatches for user-defined decorators | `src/decorators/custom.ts` |

## Prinsip Inti (jangan dilanggar)

1. **TC39 Stage 3 decorators.** Metadata lewat `Symbol.metadata`. Consumer tidak perlu tsconfig flag apa pun — jangan pernah reintroduce `experimentalDecorators`/`reflect-metadata`.
2. **Zero runtime dependency.** `hono` dan `zod` adalah peer deps. Integrasi opsional (Redis, WS upgrader, auth backend) selalu pluggable via injeksi — library tidak pernah import `ioredis` dsb.
3. **Metadata satu arah.** Decorator menulis `Symbol.metadata` (key terdaftar di `decorators/metadata.ts`); `HonoRouteBuilder` membacanya saat `build(app)`. Tidak ada global state selain `container`/`channels` singleton yang jelas lifecycle-nya.
4. **Pluggable by default.** Guard executor, rate limiter, WS upgrader, channel adapter, request logger, `onError` — semua opsi di `HonoRouteBuilder`, punya default yang masuk akal.
5. **`README.md` adalah kontrak publik.** Fitur yang tidak terdokumentasi di README dianggap belum ada.
6. **Semver ketat.** Semua export `src/index.ts` adalah API publik; breaking change butuh major + migration note.

## Referensi Cepat

- Konvensi task & rule prompt: `docs/README.md`
- Workflow AI: `docs/SETUP.md`
- Aturan arsitektur & packaging: `docs/rules/01_architecture.md`
- Layout `src/`: `docs/rules/02_source_structure.md`
- Release: `docs/release/publishing.md`
