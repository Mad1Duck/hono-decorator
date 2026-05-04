# hono-forge

NestJS-style decorators for [Hono](https://hono.dev) — controller routing, dependency injection, guards, SSE, WebSocket, channels, OpenAPI, and more.

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

```ts
HonoRouteBuilder.configure({
  onError: (err, c) => {
    console.error(err);
    // optionally: Sentry.captureException(err);
    return c.json(
      { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' } },
      500
    );
  },
});
```

- Validation errors (`ZodError`) always return `400` regardless of `onError`.
- If `onError` is not configured, unhandled errors re-throw to Hono's default 500 handler.

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
