# hono-forge

NestJS-style decorators for [Hono](https://hono.dev) — controller routing, dependency injection, guards, SSE, WebSocket, channels, OpenAPI, and more.

**[📖 Documentation](https://frontend-hono-template-decorator.vercel.app/)** · **[npm](https://www.npmjs.com/package/hono-forge)** · **[GitHub](https://github.com/Mad1Duck/hono-decorator)** · **[Changelog](./CHANGELOG.md)**

## Features

- **Controller routing** — `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options`, `@All`
- **Dependency injection** — `@Injectable`, `@Singleton`, `@Inject`, circular dependency detection
- **Parameter decorators** — `@Body`, `@Query`, `@Param`, `@Headers`, `@User`, `@Ip`, `@Device`, `@UserAgent` with optional Zod validation
- **Guards** — `@RequireAuth`, `@RequireRole`, `@RequireAllRoles`, `@RequirePermission`, `@RequireAnyPermission` with pluggable executor
- **Rate limiting** — `@RateLimit` with pluggable factory
- **Middleware** — `@Middleware` / `@Use` at class or method level; built-in `@Cors`, `@Compress`, `@SecureHeaders`, `@PrettyJson`
- **Auto-discovery** — `discoverControllers` (Bun) and `fromModules` (any bundler)
- **SSE** — `@Sse`, `@SseStream` with streaming API
- **WebSocket** — `@WebSocket` with pluggable upgrader
- **Channels** — pub/sub for SSE and WS; in-memory default, pluggable to Redis
- **Request logging** — pluggable `requestLogger` with IP, device, UA, duration
- **Error handling** — pluggable `onError` for unhandled route errors
- **Interceptors** — `@Retry`, `@Timeout`, `@Transform`, `@Cache`, `@TrackMetrics`

## Install

```bash
npm install hono-forge hono zod
# or
bun add hono-forge hono zod
```

> `reflect-metadata` is bundled as a direct dependency — no separate install needed.

### TypeScript setup

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once at your app entry point:

```ts
import 'reflect-metadata';
```

> **Note:** This package uses **legacy TypeScript decorators** (`experimentalDecorators: true`), not the TC39 Stage 3 decorators. They are not compatible.

> **Bundler note:** `emitDecoratorMetadata` requires [`@swc/core`](https://swc.rs/) with esbuild/Vite. With `tsc` or `ts-node` it works out of the box.

---

## Quick start

```ts
import 'reflect-metadata';
import { Hono } from 'hono';
import {
  Controller, Get, Post, Body, Param,
  Injectable, HonoRouteBuilder,
} from 'hono-forge';
import { z } from 'zod';

const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });

@Injectable()
class UserService {
  getAll() { return [{ id: 1, name: 'Alice' }]; }
  create(data: { name: string; email: string }) { return { id: 2, ...data }; }
}

@Controller('/users')
class UserController {
  constructor(private userService: UserService) {}

  @Get()
  list() { return this.userService.getAll(); }

  @Post()
  create(@Body(CreateUserSchema) body: z.infer<typeof CreateUserSchema>) {
    return this.userService.create(body);
  }

  @Get('/:id')
  getOne(@Param('id') id: string) { return { id }; }
}

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));
export default app;
```

---

## OpenAPI 3.1 + Scalar UI

Auto-generate a full OpenAPI spec from your decorators and serve interactive docs in one call — no extra packages needed.

```ts
import { OpenAPIGenerator, HonoRouteBuilder } from 'hono-forge';
import { Hono } from 'hono';

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));

// Generates spec + serves Scalar UI at /docs and /openapi.json
const spec = OpenAPIGenerator.generate([UserController], {
  info: { title: 'My API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
});
OpenAPIGenerator.mount(app, spec);

export default app;
```

Annotate controllers with `@ApiTags`, `@ApiDoc`, `@ApiResponse`, `@ApiDeprecated` — auth, validation, and path params are reflected automatically.

---

## Auto-discovery

Avoid manually listing every controller. Use `discoverControllers` (Bun runtime) or `fromModules` (any bundler):

```ts
import { discoverControllers, fromModules, HonoRouteBuilder } from 'hono-forge';
import { Hono } from 'hono';

const app = new Hono();

// Bun — scan filesystem at runtime
const controllers = await discoverControllers('./src/controllers/**/*.ts');
for (const ctrl of controllers) {
  app.route('/', HonoRouteBuilder.build(ctrl));
}

// Any bundler — use import.meta.glob (eager)
const modules = import.meta.glob('./controllers/**/*.ts', { eager: true });
const controllers2 = fromModules(modules as Record<string, Record<string, unknown>>);
for (const ctrl of controllers2) {
  app.route('/', HonoRouteBuilder.build(ctrl));
}

export default app;
```

Both functions only pick up classes decorated with `@Controller` — other exports are ignored.

---

## Dependency injection

### `@Injectable()`

Marks a class as injectable. Required for constructor injection.

```ts
@Injectable()
class EmailService { send(to: string) { /* ... */ } }

@Injectable()
class UserService { constructor(private email: EmailService) {} }
```

### `@Singleton()`

Same instance returned on every `container.resolve()` call.

```ts
@Injectable()
@Singleton()
class Database { constructor() { this.conn = connect(process.env.DB_URL); } }
```

### `@Inject(token)`

Inject by string or symbol token — useful for interfaces or values.

```ts
const LOGGER = Symbol('LOGGER');
container.registerSingleton(LOGGER, new PinoLogger());

@Injectable()
class UserService { constructor(@Inject(LOGGER) private logger: Logger) {} }
```

### Manual registration

```ts
container.registerSingleton(Database, new Database(config));
container.registerFactory(Redis, () => new Redis(process.env.REDIS_URL));
```

### Database / external client integration

For external objects that are not classes (Drizzle ORM, Prisma, Redis clients, etc.), use `registerInstance` with a symbol token:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { container, Inject, Injectable } from 'hono-forge';

// 1. Define a token
export const DB = Symbol('db');
export type AppDb = ReturnType<typeof drizzle>;

// 2. Register the instance once at startup (before building routes)
const client = postgres(process.env.DATABASE_URL!);
container.registerInstance(DB, drizzle(client));

// 3. Inject into any service
@Injectable()
export class UserRepo {
  constructor(@Inject(DB) private db: AppDb) {}

  findAll() {
    return this.db.select().from(users);
  }
}
```

The same pattern works for any external dependency — Prisma client, Redis, S3, Resend, etc.:

```ts
export const REDIS   = Symbol('redis');
export const MAILER  = Symbol('mailer');

container.registerInstance(REDIS,  new Redis(process.env.REDIS_URL));
container.registerInstance(MAILER, new Resend(process.env.RESEND_KEY));
```

> **`registerInstance` vs `registerSingleton`**: both do the same thing. `registerInstance` is the recommended name when registering a pre-built external object. `registerSingleton` is kept for backwards compatibility.

### `@RequestScoped()`

A fresh instance is created per request and destroyed automatically when the request ends. The same instance is shared if resolved multiple times within the same request.

```ts
import { Injectable, RequestScoped } from 'hono-forge';
import type { OnDestroy } from 'hono-forge';

@Injectable()
@RequestScoped()
class RequestContext implements OnDestroy {
  readonly requestId = crypto.randomUUID();

  onDestroy() {
    console.log('request done', this.requestId);
  }
}
```

> Unlike `@Singleton`, a `@RequestScoped` class cannot be resolved outside a route handler (throws `DependencyResolutionError`).

### `@Stateless()`

No-op marker for `@Singleton()` classes that hold no mutable per-request state. Documents intent and can be enforced by future tooling.

```ts
@Injectable()
@Singleton()
@Stateless()
class UserRepo {
  findById(id: string) { return db.query(...); }
}
```

### Lifecycle hooks — `OnInit` / `OnDestroy`

```ts
import type { OnInit, OnDestroy } from 'hono-forge';

@Injectable()
@Singleton()
class RedisClient implements OnInit, OnDestroy {
  private client!: Redis;

  async onInit() {
    this.client = new Redis(process.env.REDIS_URL!);
    await this.client.ping();
  }

  async onDestroy() {
    await this.client.quit();
  }
}
```

### `container.boot()` / `container.shutdown()`

```ts
// At startup — calls onInit() on all registered singletons that implement OnInit
await container.boot();
app.listen(3000);

// On shutdown — calls onDestroy() in reverse registration order
process.on('SIGTERM', async () => {
  await container.shutdown();
  process.exit(0);
});
```

### Table column schemas with `defineSchemas`

`defineSchemas` generates a consistent `{ select, insert, update }` schema set from any two Zod schemas. It works with `drizzle-zod`, `zod-prisma`, or hand-written schemas.

```ts
import { defineSchemas } from 'hono-forge';
import { createSelectSchema, createInsertSchema } from 'drizzle-zod';
import { pgTable, serial, varchar, text } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
  id:    serial('id').primaryKey(),
  name:  varchar('name', { length: 255 }).notNull(),
  email: text('email').notNull(),
});

// Auto-generate from table columns
export const UserSchemas = defineSchemas(
  createSelectSchema(users),   // full row — id + name + email
  createInsertSchema(users),   // insert — name + email (id auto-generated)
);

// UserSchemas.select  — full row (GET responses, @ValidateResult)
// UserSchemas.insert  — required fields (POST body)
// UserSchemas.update  — all fields optional (PATCH body)
```

Use directly with parameter decorators and OpenAPI:

```ts
@Controller('/users')
class UserController {
  @Post()
  create(@ValidatedBody(UserSchemas.insert) body: typeof UserSchemas.insert._output) {
    return this.repo.create(body);
  }

  @Patch('/:id')
  update(
    @Param('id') id: string,
    @ValidatedBody(UserSchemas.update) body: typeof UserSchemas.update._output,
  ) {
    return this.repo.update(id, body);
  }

  @Get('/:id')
  @ApiResponse(200, { schema: UserSchemas.select })
  getOne(@Param('id') id: string) {
    return this.repo.findById(id);
  }
}
```

Works without Drizzle too — pass any two Zod objects:

```ts
export const PostSchemas = defineSchemas(
  z.object({ id: z.number(), title: z.string(), content: z.string() }),
  z.object({ title: z.string().min(1), content: z.string().min(1) }),
);
```

#### Custom update schema

When PATCH has different validation rules than a partial POST (e.g. email cannot be changed), pass a custom `update` schema via the third argument:

```ts
const insert = z.object({ name: z.string().min(1), email: z.string().email() });

export const UserSchemas = defineSchemas(
  z.object({ id: z.number(), name: z.string(), email: z.string() }),
  insert,
  { update: insert.omit({ email: true }).partial() },
);

// UserSchemas.update — only { name? } — email is excluded from PATCH
```

---

## Pagination

### `paginate`

Wraps a data array and total count into a standard `{ data, meta }` response:

```ts
import { paginate } from 'hono-forge';

const [data, total] = await db.select().from(users).limit(limit).offset((page - 1) * limit);
return paginate(data, total, { page, limit });

// Returns:
// {
//   data: [...],
//   meta: { page: 1, limit: 20, total: 95, totalPages: 5, hasNext: true, hasPrev: false }
// }
```

### `PaginationQuerySchema`

Zod schema for standard `page` / `limit` query params. Use with `@ValidatedQuery`:

```ts
import { PaginationQuerySchema } from 'hono-forge';
import type { PaginationQuery } from 'hono-forge';

@Get()
list(@ValidatedQuery(PaginationQuerySchema) q: PaginationQuery) {
  const { page, limit } = q; // page defaults to 1, limit defaults to 20 (max 100)
  const [data, total] = await this.repo.findAndCount({ limit, offset: (page - 1) * limit });
  return paginate(data, total, q);
}
```

### `paginatedSchema`

Wraps an item schema into a full paginated response schema for `@ApiResponse` or `@ValidateResult`:

```ts
import { paginatedSchema, PaginationQuerySchema } from 'hono-forge';

const UserListSchema = paginatedSchema(UserSchemas.select);

@Get()
@ApiResponse(200, { schema: UserListSchema })
@ValidateResult(UserListSchema)
async list(@ValidatedQuery(PaginationQuerySchema) q: PaginationQuery) {
  const [data, total] = await this.repo.findAndCount(q);
  return paginate(data, total, q);
}
```

---

## Controllers

### `@Controller(basePath?, options?)`

```ts
@Controller('/users', { platform: 'web', version: 'v2' })
// registers routes under /web/v2/users
class UserController {}
```

### HTTP method decorators

```ts
@Get('/path')
@Post('/path')
@Put('/path')
@Patch('/path')
@Delete('/path')
@Head('/path')    // registers as GET; Hono handles HEAD automatically
@Options('/path')
@All('/path')     // matches all HTTP methods
```

Each accepts optional `{ platform?: 'web' | 'mobile' | 'all', isPrivate?: boolean }`.

### Building routes

```ts
const app = new Hono();

app.route('/', HonoRouteBuilder.build(UserController));

// filter by platform
app.route('/', HonoRouteBuilder.build(UserController, 'web'));
app.route('/', HonoRouteBuilder.build(UserController, 'mobile'));
```

---

## Parameter decorators

| Decorator | Injects |
|-----------|---------|
| `@Body()` | `await c.req.json()` |
| `@Query()` | `c.req.query()` |
| `@Param(name)` | `c.req.param(name)` |
| `@Headers(name)` | `c.req.header(name)` |
| `@User()` | `c.get('user')` — set by guard |
| `@Ip()` | Real client IP (CF-Connecting-IP → X-Real-IP → X-Forwarded-For) |
| `@Device()` | `'mobile' \| 'tablet' \| 'desktop' \| 'bot'` |
| `@UserAgent()` | Raw `User-Agent` header string |
| `@Req()` | Hono `HonoRequest` |
| `@Res()` | Hono `Context` |
| `@SseStream()` | SSE stream (inside `@Sse` handlers) |

### With Zod validation

```ts
const Schema = z.object({ name: z.string(), age: z.number() });

@Post()
create(@Body(Schema) body: z.infer<typeof Schema>) {
  // body is validated; returns 400 VALIDATION_ERROR if invalid
}
```

### File uploads

Use `@UploadedFile`, `@UploadedFiles`, or `@FormBody` on multipart/form-data routes.

```ts
@Post('/avatar')
uploadAvatar(@UploadedFile('avatar') file: File | null) {
  if (!file) return c.json({ error: 'no file' }, 400);
  return { name: file.name, size: file.size, type: file.type };
}

@Post('/gallery')
uploadMany(@UploadedFiles('photos') files: File[]) {
  return files.map(f => ({ name: f.name, size: f.size }));
}

@Post('/submit')
handleForm(@FormBody() form: FormData, @UploadedFile('doc') doc: File | null) {
  const title = form.get('title') as string;
  return { title, docName: doc?.name };
}
```

| Decorator | Returns | Notes |
|-----------|---------|-------|
| `@UploadedFile(fieldName)` | `File \| null` | Single file by field name |
| `@UploadedFiles(fieldName?)` | `File[]` | Multiple files; omit field to get all files in the form |
| `@FormBody()` | `FormData` | Raw form data object |

`FormData` is parsed **once per request** even when multiple file decorators are used on the same handler.

### `@ValidatedBody` / `@ValidatedQuery` / `@ValidatedParam`

Type-safe aliases that carry the inferred Zod type so TypeScript can narrow the parameter without an explicit annotation:

```ts
const UserSchema = z.object({ name: z.string(), age: z.number() });
const IdSchema   = z.string().uuid();

@Post()
create(@ValidatedBody(UserSchema) body: typeof UserSchema._output) { /* ... */ }

@Get()
list(@ValidatedQuery(z.object({ page: z.coerce.number() })) q: { page: number }) { /* ... */ }

@Get('/:id')
getOne(@ValidatedParam('id', IdSchema) id: string) { /* ... */ }
```

Behaves identically to `@Body` / `@Query` / `@Param` — invalid input returns `400 VALIDATION_ERROR`.

---

## Guards

Configure your executor once — no auth library is bundled.

> **Security:** `HonoRouteBuilder.build()` throws at startup if a guarded route has no `guardExecutor` configured. Silent skipping is not allowed.

```ts
HonoRouteBuilder.configure({
  guardExecutor: async (c, guards) => {
    for (const guard of guards) {
      if (guard.name === 'AuthGuard') {
        const token = c.req.header('authorization')?.split(' ')[1];
        if (!token) throw new Error('Unauthorized: No token');
        c.set('user', verifyJwt(token));
      }
      if (guard.name === 'RoleGuard') {
        const user = c.get('user') as { roles: string[] };
        const ok = guard.options?.roles?.some(r => user.roles.includes(r));
        if (!ok) throw new Error('Forbidden: Insufficient role');
      }
    }
    return true;
  },
});
```

> Errors with `"Unauthorized"` → `401`. Errors with `"Forbidden"` → `403`. Return `false` → `403`.

### Guard decorators

```ts
@RequireAuth()                              // AuthGuard
@RequireRole('admin', 'mod')               // RoleGuard — needs ONE
@RequireAllRoles('admin', 'superuser')     // RoleGuard — needs ALL
@RequirePermission('users:read')           // PermissionGuard — needs ALL
@RequireAnyPermission('reports:read', 'admin:all') // PermissionGuard — needs ONE
@Public()                                  // skips guards entirely
@Private()                                 // marks route as internal-only
```

### `@Private`

Marks a route as internal-only. It does **not** affect normal request handling — a private route is still registered and accessible. The flag is only meaningful when you pass `{ excludePrivate: true }` to `build()`:

```ts
// internal-only health check — skip it on the public-facing Hono instance
@Controller('/admin')
class AdminController {
  @Get('/healthz')
  @Private()
  health() { return { status: 'ok' }; }

  @Get('/dashboard')
  dashboard() { return { ... }; }
}

// Public instance — private routes excluded
const publicApp = new Hono();
publicApp.route('/', HonoRouteBuilder.build(AdminController, undefined, { excludePrivate: true }));

// Internal instance — all routes included (default)
const internalApp = new Hono();
internalApp.route('/', HonoRouteBuilder.build(AdminController));
```

---

## Rate limiting

```ts
HonoRouteBuilder.configure({
  rateLimiterFactory: ({ max, windowMs, keyPrefix, message, keyGenerator }) => {
    // return a Hono middleware using your own Redis/memory store
    return async (c, next) => { await next(); };
  },
});

@Post('/login')
@RateLimit({ max: 5, windowMs: 60_000, message: 'Too many attempts' })
login(@Body() body: LoginDto) { /* ... */ }
```

---

## Middleware

Apply any Hono middleware at class level (all routes) or method level (one route) using `@Middleware`.

```ts
const logMw = async (c: Context, next: Next) => {
  console.log(c.req.method, c.req.path);
  await next();
};

@Controller('/api')
@Middleware(logMw)             // applies to every route in this controller
class ApiController {
  @Get()
  @Middleware(tracingMw)       // applies to this route only
  list() { /* ... */ }

  @Post()
  create(@Body() body: unknown) { /* ... */ }
}
```

Multiple middleware are applied in order:

```ts
@Get('/admin')
@Middleware(authMw, auditMw)   // authMw runs first, then auditMw
adminOnly() { /* ... */ }
```

`@Use` is an alias for `@Middleware` — pick whichever reads better:

```ts
@Get()
@Use(logMw)
list() { /* ... */ }
```

### Class-based middleware

Implement the `MiddlewareClass` interface for reusable stateful middleware:

```ts
import type { MiddlewareClass } from 'hono-forge';
import type { Context, Next } from 'hono';

class AuthMiddleware implements MiddlewareClass {
  async use(c: Context, next: Next) {
    const token = c.req.header('authorization');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  }
}

@Controller('/admin')
@Use(AuthMiddleware)
class AdminController { /* ... */ }
```

### Built-in middleware decorators

Common Hono middleware available as first-class decorators — no `@Middleware(cors(...))` boilerplate needed.

```ts
import { Cors, Compress, SecureHeaders, PrettyJson } from 'hono-forge';

@Controller('/api')
@Cors({ origin: 'https://example.com' })     // CORS headers
@SecureHeaders()                              // CSP, HSTS, X-Frame-Options, etc.
@Compress()                                   // gzip / deflate compression
class ApiController {
  @Get('/debug')
  @PrettyJson()                               // formatted JSON output
  debug() { return { status: 'ok' }; }
}
```

All four can be used at class level (applies to every route) or method level (applies to one route). Options match Hono's underlying middleware — see [Hono middleware docs](https://hono.dev/docs/middleware/builtin/cors) for full option reference.

---

## SSE (Server-Sent Events)

`@Sse` registers a GET endpoint. The handler receives the stream via `@SseStream()` and writes events until the client disconnects.

```ts
import type { SSEStreamingApi } from 'hono/streaming';

@Controller('/events')
class NotificationController {
  @Sse('/feed')
  @Public()
  async feed(@SseStream() stream: SSEStreamingApi) {
    await stream.writeSSE({ event: 'connected', data: 'ok' });

    // keep-alive ping every 30s
    while (!stream.closed) {
      await stream.sleep(30_000);
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  }
}
```

---

## WebSocket

Requires a platform-specific upgrader — configure once at startup.

```ts
import { upgradeWebSocket } from 'hono/bun'; // or hono/cloudflare-workers, etc.

HonoRouteBuilder.configure({ webSocketUpgrader: upgradeWebSocket });
```

The handler returns WebSocket event callbacks:

```ts
@Controller('/ws')
class ChatController {
  @WebSocket('/:room')
  @Public()
  chat(@Param('room') room: string) {
    return {
      onOpen(_event, ws) { console.log('connected to', room); },
      onMessage(event, ws) { ws.send(`Echo: ${event.data}`); },
      onClose() { console.log('disconnected'); },
    };
  }
}
```

---

## Channels (pub/sub)

A shared registry for broadcasting events to SSE and WebSocket clients — in-memory by default, pluggable to Redis for multi-instance deployments.

### Setup

```ts
import { channels } from 'hono-forge';

// default: in-memory, nothing to configure

// multi-instance: swap to Redis
import { RedisChannelAdapter } from 'hono-forge';
import Redis from 'ioredis';
channels.use(new RedisChannelAdapter(new Redis(), new Redis()));
```

### SSE with user-specific channels

```ts
import { channels, SseChannelClient } from 'hono-forge';
import type { SSEStreamingApi } from 'hono/streaming';

@Controller('/events')
class EventController {
  @Sse('/user/:userId')
  @RequireAuth()
  async userFeed(
    @Param('userId') userId: string,
    @SseStream() stream: SSEStreamingApi
  ) {
    const client = new SseChannelClient(userId, stream);
    await channels.subscribe(`user:${userId}`, client);
    stream.onAbort(() => channels.unsubscribe(`user:${userId}`, userId));

    while (!stream.closed) {
      await stream.sleep(30_000);
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  }
}

// push from anywhere in the app:
await channels.publish(`user:${userId}`, 'order.created', { id: 123 });
```

### WebSocket with room channels

```ts
import { channels, WsChannelClient } from 'hono-forge';

@Controller('/ws')
class ChatController {
  @WebSocket('/:room')
  @Public()
  chat(@Param('room') room: string) {
    return {
      onOpen: (_e, ws) => channels.subscribe(`room:${room}`, new WsChannelClient(ws.id, ws)),
      onMessage: (e) => channels.publish(`room:${room}`, 'message', { text: e.data }),
      onClose: (_e, ws) => channels.unsubscribe(`room:${room}`, ws.id),
    };
  }
}
```

### Channel API

```ts
channels.subscribe(channel, client)      // add a client to a channel
channels.unsubscribe(channel, clientId)  // remove a client
channels.publish(channel, event, data)   // broadcast to all subscribers
channels.use(adapter)                    // swap adapter at startup
```

---

## Request logging

```ts
HonoRouteBuilder.configure({
  requestLogger: (entry) => {
    // entry: { method, path, ip, device, userAgent, statusCode, durationMs, userId? }
    console.log(JSON.stringify(entry));
  },
});
```

`ip`, `device`, and `userAgent` are also available as parameter decorators:

```ts
@Get('/info')
info(@Ip() ip: string, @Device() device: string, @UserAgent() ua: string) {
  return { ip, device, ua };
}
```

IP resolution order: `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` (first) → `'unknown'`.

Device types: `'mobile' | 'tablet' | 'desktop' | 'bot'`.

---

## Error handling

### `HttpException`

Throw `HttpException` from anywhere in a handler or service — the route builder catches it and returns a structured JSON response at the correct HTTP status code.

```ts
import { HttpException } from 'hono-forge';

@Get('/:id')
async getOne(@Param('id') id: string) {
  const user = await this.repo.findById(id);
  if (!user) throw HttpException.notFound('User not found');
  return user;
}
```

Static factories:

| Factory | Status |
|---------|--------|
| `HttpException.badRequest(msg?, meta?)` | 400 |
| `HttpException.unauthorized(msg?, meta?)` | 401 |
| `HttpException.forbidden(msg?, meta?)` | 403 |
| `HttpException.notFound(msg?, meta?)` | 404 |
| `HttpException.conflict(msg?, meta?)` | 409 |
| `HttpException.unprocessable(msg?, meta?)` | 422 |
| `HttpException.tooManyRequests(msg?, meta?)` | 429 |
| `HttpException.internal(msg?, meta?)` | 500 |
| `HttpException.serviceUnavailable(msg?, meta?)` | 503 |

All errors serialize to:
```json
{ "status": "error", "error": { "code": "NOT_FOUND", "message": "User not found" } }
```

### `exposeStack`

Controls whether `HttpException` stack traces appear in error responses:

```ts
HonoRouteBuilder.configure({
  exposeStack: 'development', // only when NODE_ENV !== 'production'
  // exposeStack: true        // always
  // exposeStack: false       // never (default)
});
```

### `onError` hook

```ts
HonoRouteBuilder.configure({
  onError: async (err, c) => {
    // Called for every non-validation error (including HttpException).
    // Return a Response to override; return void to fall through to default handling.
    if (err instanceof HttpException) {
      await db.insert(errorLogs).values({ code: err.code, message: err.message });
      // return nothing → default structured JSON is still sent
    } else {
      return c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500);
    }
  },
});
```

- `HttpException` → auto-formatted as structured JSON at the correct status code
- Other errors → re-thrown to Hono's default 500 handler
- Validation errors (`ZodError`) always return `400` and bypass `onError`

---

## Observability

### Trace ID / Correlation ID

Every request automatically gets a `traceId` from the `X-Request-ID` header (or a generated UUID if absent). The ID is echoed back as `X-Request-ID` on the response.

```ts
import { getTraceId } from 'hono-forge';

@Injectable()
class AuditService {
  log(action: string) {
    console.log({ traceId: getTraceId(), action }); // works without passing traceId explicitly
  }
}
```

### `onRequestStart` hook

Called before middleware and guards on every request. Use it to start an OpenTelemetry span or attach a correlation ID to your logger:

```ts
HonoRouteBuilder.configure({
  onRequestStart: ({ method, path, traceId, ip, userAgent }) => {
    const span = tracer.startSpan(`${method} ${path}`, { attributes: { traceId } });
    // ...
  },
});
```

### `runWithTraceId`

For running code outside the route builder within a trace context:

```ts
import { runWithTraceId } from 'hono-forge';

await runWithTraceId('my-trace-id', async () => {
  // getTraceId() returns 'my-trace-id' here
  await myService.doWork();
});
```

---

## Interceptors

### `@Retry`

```ts
@Retry({ attempts: 3, delay: 500, backoff: 'exponential' })
async fetchExternalData() { /* ... */ }
```

### `@Timeout`

```ts
@Timeout(5000)
async slowOperation() { /* ... */ }
```

### `@Transform`

```ts
@Transform((user: User) => ({ id: user.id, name: user.name }))
getUser() { /* ... */ }
```

### `@Cache`

Stores cache metadata — integrate with your own cache layer.

```ts
@Cache({ ttl: 60_000, key: 'user-list' })
getAll() { /* ... */ }
```

### `@Throttle`

Limits how often a method can be called. Throws if called again before `ms` milliseconds have passed.

```ts
@Throttle(1000)
async sendWebhook() { /* ... */ }
```

### `@Memoize`

Caches the return value in memory keyed by serialized arguments. Optional `ttl` (ms) before the cache expires.

```ts
// Global cache — shared across all requests (default). Good for config, feature flags.
@Memoize({ ttl: 30_000 })
async getConfig() { return fetchRemoteConfig(); }

// Per-request cache — isolated per request. Use on singletons returning user-specific data.
@Memoize({ scope: 'request' })
async getCurrentUserPermissions() { return this.permRepo.findForUser(this.userId); }
```

| Option | Default | Description |
|--------|---------|-------------|
| `ttl` | `undefined` (indefinite) | Cache expiry in milliseconds |
| `scope` | `'global'` | `'global'` — shared cache; `'request'` — isolated per request |

### `@ValidateResult`

Validates the return value against a Zod schema. Throws `ZodError` if the result doesn't match — useful for enforcing response contracts at service boundaries.

```ts
const UserSchema = z.object({ id: z.number(), name: z.string() });

@ValidateResult(UserSchema)
async getUser(id: number) { return db.findUser(id); }
```

### `@Audit`

Logs an audit entry before the method executes. Reads `this.logger` (if present) or falls back to `console.log`. Entry includes `action`, `userId`, `timestamp`, and method name.

```ts
@Audit({ action: 'user.delete' })
async remove(id: string) { /* ... */ }
```

Expects `this.logger` to implement `{ info(data, msg?): void }` (compatible with Pino, Winston, etc.).

### `@Transaction`

Wraps the method inside a database transaction. Requires `this.db` on the instance.

By default uses `.transaction(fn)` — compatible with Drizzle, Knex, and TypeORM. Pass a custom executor for ORMs with different APIs:

```ts
// Drizzle / Knex / TypeORM — default, no executor needed
@Transaction()
async transfer(from: string, to: string, amount: number) {
  await this.db.update(accounts)...;
}

// Prisma — $transaction instead of .transaction
@Transaction((db: PrismaClient, run) => db.$transaction(run))
async transfer() { ... }

// Kysely — .transaction().execute()
@Transaction((db: Kysely<DB>, run) => db.transaction().execute(run))
async transfer() { ... }
```

The transaction is propagated via `AsyncLocalStorage`, so any nested repository that calls `useTransaction()` automatically receives the active `tx` — no manual passing required:

```ts
import { useTransaction } from 'hono-forge';

@Injectable()
class UserRepo {
  constructor(private db: DrizzleDb) {}

  async create(data: NewUser) {
    const tx = useTransaction<DrizzleDb>() ?? this.db;
    return tx.insert(users).values(data);
  }
}

@Injectable()
class AccountService {
  constructor(private db: DrizzleDb, private repo: UserRepo) {}

  @Transaction()
  async onboard(data: NewUser) {
    // repo.create() picks up the same tx automatically via useTransaction()
    await this.repo.create(data);
    await this.db.insert(accounts).values({ userId: data.id });
  }
}
```

Export `TransactionExecutor` type to type your custom executors:

```ts
import type { TransactionExecutor } from 'hono-forge';

const prismaExecutor: TransactionExecutor<PrismaClient> =
  (db, run) => db.$transaction(run);
```

---

## Full example

```ts
import 'reflect-metadata';
import { Hono } from 'hono';
import {
  Controller, Get, Post, Delete, Sse,
  Body, Param, User, Ip, Device, SseStream,
  RequireAuth, RequireRole, Public,
  Injectable, Singleton,
  HonoRouteBuilder, container,
  channels, SseChannelClient,
} from 'hono-forge';
import type { SSEStreamingApi } from 'hono/streaming';

@Injectable()
@Singleton()
class UserRepo {
  private users = [{ id: '1', name: 'Alice', roles: ['admin'] }];
  findAll() { return this.users; }
  findById(id: string) { return this.users.find(u => u.id === id); }
}

@Controller('/users')
class UserController {
  constructor(private repo: UserRepo) {}

  @Get()
  @Public()
  list() { return this.repo.findAll(); }

  @Get('/:id')
  @RequireAuth()
  getOne(@Param('id') id: string) { return this.repo.findById(id); }
}

@Controller('/events')
class EventController {
  @Sse('/user/:userId')
  @RequireAuth()
  async userFeed(@Param('userId') userId: string, @SseStream() stream: SSEStreamingApi) {
    const client = new SseChannelClient(userId, stream);
    await channels.subscribe(`user:${userId}`, client);
    stream.onAbort(() => channels.unsubscribe(`user:${userId}`, userId));
    while (!stream.closed) await stream.sleep(30_000);
  }
}

HonoRouteBuilder.configure({
  guardExecutor: async (c, guards) => {
    for (const g of guards) {
      if (g.name === 'AuthGuard') {
        const user = verifyJwt(c.req.header('authorization')?.split(' ')[1] ?? '');
        if (!user) throw new Error('Unauthorized');
        c.set('user', user);
      }
    }
    return true;
  },
  requestLogger: (e) => console.log(`${e.method} ${e.path} ${e.statusCode} ${e.durationMs}ms`),
  onError: (err, c) => {
    console.error(err);
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500);
  },
});

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));
app.route('/', HonoRouteBuilder.build(EventController));

export default app;
```

---

## License

MIT
