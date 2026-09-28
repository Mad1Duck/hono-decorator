# hono-forge

NestJS-style decorators for [Hono](https://hono.dev) — controller routing, dependency injection, guards, SSE, WebSocket, channels, OpenAPI, and more.

**[📖 Documentation](https://frontend-hono-template-decorator.vercel.app/)** · **[npm](https://www.npmjs.com/package/hono-forge)** · **[GitHub](https://github.com/Mad1Duck/hono-decorator)** · **[Changelog](./CHANGELOG.md)**  · **[Feedback](https://wall-message-frontend.vercel.app/message/gandhi/hono-forge)**

## Features

- **Controller routing** — `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options`, `@All`
- **Context helpers** — `Body`, `Param`, `Query`, `Headers`, `User`, `Ip`, `Device`, `Cookie`, `UploadedFile` and more — typed functions called inside the handler with `c` as first arg
- **Dependency injection** — `@Injectable([deps])`, `@Singleton`, `@RequestScoped`, circular dependency detection, lifecycle hooks
- **Guards** — `@RequireAuth`, `@RequireRole`, `@RequireAllRoles`, `@RequirePermission`, `@RequireAnyPermission` with pluggable executor
- **Rate limiting** — `@RateLimit` works out of the box (in-memory), pluggable to Redis via factory
- **Idempotency** — `@Idempotent` replays responses per `Idempotency-Key`; `@SingleFlight` dedupes concurrent identical requests
- **Middleware** — `@Middleware` / `@Use` at class or method level; built-in `@Cors`, `@Compress`, `@SecureHeaders`, `@PrettyJson`
- **Auto-discovery** — `discoverControllers` (Bun) and `fromModules` (any bundler)
- **SSE** — `@Sse` with optional keepalive — handler receives `(c: Context, stream: SSEStreamingApi)`
- **WebSocket** — `@WebSocket` with pluggable upgrader
- **Channels** — pub/sub for SSE and WS; in-memory default, pluggable to Redis
- **Request logging** — pluggable `requestLogger` with IP, device, UA, duration
- **Error handling** — pluggable `onError` for unhandled route errors
- **Interceptors** — `@Retry`, `@Timeout`, `@Transform`, `@Cache`, `@TrackMetrics`
- **Operational helpers** — `mountHealth` health checks, `gracefulShutdown`, `printRoutes` route table, `LOGGER` DI token

## Install

```bash
npm install hono-forge hono zod
# or
bun add hono-forge hono zod
```

### TypeScript setup

No `tsconfig.json` flags required. hono-forge uses **TC39 Stage 3 decorators** — the standard decorator syntax supported natively by TypeScript 5.0+ and Bun.

```json
{
  "compilerOptions": {
    "target": "ESNext"
  }
}
```

No `reflect-metadata` import. No `experimentalDecorators`. Just install and use.

### Bun version

hono-forge requires **Bun ≥ 1.2** (earlier versions don't expose `Symbol.metadata` globally; much older versions don't support TC39 decorators at all). Bun ≥ 1.3 is recommended.

> **Docker users:** `oven/bun:latest` is frozen at whatever version you last pulled — Docker never auto-updates it. Pin an explicit version and refresh the base image:
>
> ```dockerfile
> FROM oven/bun:1.3
> ```
>
> ```bash
> docker build --pull -t myapp .
> docker exec <container> bun --version   # verify the version inside the container
> ```

---

## Quick start

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  Controller, Get, Post,
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
@Injectable([UserService])
class UserController {
  constructor(private userService: UserService) {}

  @Get()
  list() { return this.userService.getAll(); }

  @Post()
  async create(c: Context) {
    const body = await CreateUserSchema.parseAsync(await c.req.json());
    return this.userService.create(body);
  }

  @Get('/:id')
  getOne(c: Context) { return { id: c.req.param('id') }; }
}

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));
export default app;
```

> **Handlers receive `c: Context` directly.** Route params, query strings, request body, and headers are all accessed via Hono's standard `c.req` API. This keeps handlers simple and fully typed without any magic.

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

Or generate + mount in one call — pass controllers directly:

```ts
OpenAPIGenerator.mount(app, [UserController, OrderController], {
  info: { title: 'My API', version: '1.0.0' },
});
```

Annotate controllers with `@ApiTags`, `@ApiDoc`, `@ApiResponse`, `@ApiDeprecated` — auth, validation, and path params are reflected automatically. `@ApiDeprecated` also marks the route `deprecated` in the spec **and** emits an RFC 9745 `Deprecation: true` response header (pass a date for a `Sunset` header). For request bodies and query params, use `@ApiBody` and `@ApiQuery` — `required` is auto-inferred from the Zod schema (`.optional()`/`.default()` → optional):

```ts
@Post()
@ApiBody(CreateUserSchema, { description: 'New user payload' })
@ApiQuery('dryRun', z.boolean().optional())
create(c: Context) { /* ... */ }
```

---

## Modules

Group controllers and providers with `@Module`, then build the whole app in one call:

```ts
@Module({ controllers: [UserController], providers: [UserService] })
class UserModule {}

@Module({ imports: [UserModule], controllers: [OrderController] })
class AppModule {}

const app = new Hono();
app.route('/', HonoRouteBuilder.buildModule(AppModule));
```

`imports` are traversed recursively and deduped; `providers` are eagerly resolved at build time so DI errors fail fast (except `@RequestScoped`, resolved per request). Modules organize wiring — they do not create isolated DI scopes or configs.

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

### `@Injectable(tokens?)`

Marks a class as injectable. Pass an array of constructor dependencies as explicit tokens:

```ts
@Injectable()
class EmailService { send(to: string) { /* ... */ } }

@Injectable([EmailService])
class UserService { constructor(private email: EmailService) {} }
```

For zero dependencies, `@Injectable()` or `@Injectable([])` is equivalent.

### `@Singleton()`

Same instance returned on every `container.resolve()` call.

```ts
@Injectable()
@Singleton()
class Database { constructor() { this.conn = connect(process.env.DB_URL); } }
```

### Injecting by symbol or string token

Pass the token directly in the `@Injectable` array:

```ts
const LOGGER = Symbol('LOGGER');
container.registerSingleton(LOGGER, new PinoLogger());

@Injectable([LOGGER])
class UserService { constructor(private logger: Logger) {} }
```

The array index maps to the constructor parameter position.

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
@Injectable([DB])
export class UserRepo {
  constructor(private db: AppDb) {}

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

You can constructor-inject a request-scoped class into a `@Singleton` or another scoped class — hono-forge injects a **lazy proxy** that resolves the real instance inside the active request scope:

```ts
@Injectable([RequestContext])
@Singleton()
class AuditService {
  constructor(private ctx: RequestContext) {}
  log(action: string) { console.log(this.ctx.requestId, action); }  // resolved per request
}
```

A `@RequestScoped` controller also works — the controller itself is instantiated per request.

> A request-scoped instance cannot be resolved or accessed outside an active request scope (throws `DependencyResolutionError`). For `@WebSocket` handlers, request-scoped deps are resolved at upgrade time but never receive `onDestroy` — the socket outlives the request scope.

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

Use with Context helpers and OpenAPI:

```ts
@Controller('/users')
@Injectable([UserRepo])
class UserController {
  constructor(private repo: UserRepo) {}

  @Post()
  async create(c: Context) {
    const body = await ValidatedBody(c, UserSchemas.insert);
    return this.repo.create(body);
  }

  @Patch('/:id')
  async update(c: Context) {
    const id   = Param(c, 'id');
    const body = await ValidatedBody(c, UserSchemas.update);
    return this.repo.update(id, body);
  }

  @Get('/:id')
  @ApiResponse(200, 'Success')
  getOne(c: Context) {
    return this.repo.findById(Param(c, 'id'));
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

**Return values:** a plain value is auto-serialized with `c.json()`; `undefined` returns an empty `200`. Returning a `Response` object (`c.json()`, `c.redirect()`, `c.html()`, raw `new Response()`) passes it through untouched.

**Trailing slash:** `HonoRouteBuilder.configure({ trailingSlash: 'strip' | 'add' })` redirects non-conforming URLs (`301` for GET/HEAD, `308` for other methods so the method and body are preserved). `'ignore'` (default) registers both variants without redirecting.

**Introspection:** `HonoRouteBuilder.describe(Controller)` returns a `RouteDescription[]` — a read-only metadata snapshot (`method`, `path`, `guards`, `middlewares`, `cache`, `rateLimit`, `sse`, `websocket`, `isPublic`, `isPrivate`) without instantiating anything. Useful for debugging, tests, and tooling.

---

## Context helpers

hono-forge exports typed helper functions for common request data — same names as the old parameter decorators, now called inside the handler with `c` as the first argument.

```ts
import {
  Body, Param, Query, Headers, User,
  Ip, Device, UserAgent, Cookie, Cookies,
  UploadedFile, UploadedFiles, FormBody,
  Req, Ctx,
} from 'hono-forge';
import type { Context } from 'hono';
import { z } from 'zod';

const CreateSchema = z.object({ name: z.string().min(1) });

@Post()
async create(c: Context) {
  const body = await Body(c, CreateSchema);  // validated + typed
  return this.svc.create(body.name);
}

@Get('/:id')
getOne(c: Context) {
  const id    = Param(c, 'id');          // string
  const token = Headers(c, 'x-token');  // string | undefined
  const u     = User<MyUser>(c);        // c.get('user') as MyUser
  return this.svc.findById(id);
}

@Get()
async list(c: Context) {
  const q = await Query(c, FilterSchema);  // validated query object
  return this.svc.getAll(q);
}
```

### Full reference

| Helper | Returns | Notes |
|---|---|---|
| `await Body(c, schema)` | `z.infer<schema>` | Parse + validate body |
| `await Body(c)` | `unknown` | Raw body, no validation |
| `Param(c, 'id')` | `string` | Route param |
| `Param(c)` | `Record<string, string>` | All route params |
| `await Query(c, schema)` | `z.infer<schema>` | Validated query params |
| `Query(c)` | `Record<string, string>` | All query params, no validation |
| `Headers(c, 'x-tok')` | `string \| undefined` | Single header |
| `Headers(c)` | `Record<string, string>` | All headers |
| `User<T>(c)` | `T` | `c.get('user')` — set by guard |
| `Ip(c)` | `string` | CF-Connecting-IP → X-Real-IP → X-Forwarded-For |
| `Device(c)` | `'mobile' \| 'tablet' \| 'desktop' \| 'bot'` | From User-Agent |
| `UserAgent(c)` | `string` | Raw User-Agent header |
| `Cookie(c, 'name')` | `string \| undefined` | Single cookie |
| `Cookies(c)` | `Record<string, string>` | All cookies |
| `await UploadedFile(c, 'field')` | `File \| null` | Single file from multipart |
| `await UploadedFiles(c, 'field?')` | `File[]` | Multiple files |
| `await FormBody(c)` | `FormData` | Raw form data |
| `Req(c)` | `HonoRequest` | Hono request object |
| `Ctx(c)` | `Context` | Full context (for redirect, set-cookie, etc.) |

> `Res(c)` is a deprecated alias of `Ctx(c)` — it returns the `Context`, not a `Response`.

### Validated shorthands

`ValidatedBody`, `ValidatedQuery`, and `ValidatedParam` are aliases with identical behaviour:

```ts
const id = await ValidatedParam(c, 'id', z.string().uuid());
```

Invalid input throws `ZodError` → route builder returns `400 VALIDATION_ERROR` automatically.

### Cookies

```ts
@Get('/profile')
@RequireAuth()
profile(c: Context) {
  const session = Cookie(c, 'session');
  const user    = User<MyUser>(c);
  return { session, user };
}
```

### File uploads

```ts
@Post('/avatar')
async uploadAvatar(c: Context) {
  const file = await UploadedFile(c, 'avatar');
  if (!file) return c.json({ error: 'no file' }, 400);
  return { name: file.name, size: file.size };
}

@Post('/gallery')
async uploadMany(c: Context) {
  const files = await UploadedFiles(c, 'photos');
  return files.map(f => ({ name: f.name, size: f.size }));
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

> `HttpException` is passed through at its own status code (e.g. `throw HttpException.unauthorized('Token expired')` → `401`). For plain `Error`s, a message containing `"Unauthorized"` → `401`, `"Forbidden"` → `403`. Return `false` → `403`. Anything else → `500`.

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

### Accessing authenticated user

When using `@RequireAuth()`, the guard executor sets the user on the context. Read it with `User(c)` or directly via `c.get('user')`:

```ts
@Get('/me')
@RequireAuth()
async me(c: Context) {
  const user = User<MyUser>(c);  // typed shorthand for c.get('user')
  return { address: user.address, roles: user.roles };
}

@Post('/users')
@RequireAuth()
async create(c: Context) {
  const user = User<MyUser>(c);
  const body = await Body(c, CreateUserSchema);
  return this.userService.create(user.address, body);
}
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

`@RateLimit` works out of the box — a per-route in-memory fixed-window limiter is used when no factory is configured, keyed by client IP (or `keyGenerator` when provided). Exceeding `max` returns `429 Too Many Requests` with `retryAfterMs` in `meta`.

```ts
@Post('/login')
@RateLimit({ max: 5, windowMs: 60_000, message: 'Too many attempts' })
async login(c: Context) {
  const body = await Body(c) as LoginDto;
  /* ... */
}
```

For multi-instance deployments, swap in a shared backend via `rateLimiterFactory`:

```ts
HonoRouteBuilder.configure({
  rateLimiterFactory: ({ max, windowMs, keyPrefix, message, keyGenerator }) => {
    // return a Hono middleware backed by Redis/etc.
    return async (c, next) => { await next(); };
  },
});
```

> The default key is the client IP via `extractIp` — trusted proxy headers (`X-Forwarded-For`, `CF-Connecting-IP`) are used when present. If your proxy does not sanitize them, provide a `keyGenerator` keyed on an authenticated identity to prevent bypass by header spoofing.

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
  async create(c: Context) { const body = await Body(c); /* ... */ }
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

### `@JwtAuth` — turnkey JWT auth

Wraps `hono/jwt` (HS256 by default — pass `alg` to change). On a valid token the decoded payload is exposed via `User(c)`; invalid or missing tokens return `401`:

```ts
@Controller('/api')
class MeController {
  @Get('/me')
  @JwtAuth({ secret: process.env.JWT_SECRET! })
  me(c: Context) {
    return User(c); // decoded JWT payload
  }
}
```

---

## SSE (Server-Sent Events)

`@Sse` registers a GET endpoint. The handler receives `(c: Context, stream: SSEStreamingApi)` as positional arguments.

```ts
import type { Context } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';

@Controller('/events')
class NotificationController {
  @Sse('/feed')
  @Public()
  async feed(c: Context, stream: SSEStreamingApi) {
    await stream.writeSSE({ event: 'connected', data: 'ok' });

    // keep-alive ping every 30s
    while (!stream.closed) {
      await stream.sleep(30_000);
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  }
}
```

For idle streams (e.g. `@ChannelRoute` feeds that may go quiet), pass `keepAliveMs` — a `:keepalive` SSE comment is sent on that interval while the stream is open, preventing proxies/load balancers from closing the connection:

```ts
@Sse('/feed', { keepAliveMs: 15_000 })
@ChannelRoute('notifications:*')
feed(c: Context, stream: SSEStreamingApi) { /* ... */ }
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
  chat(c: Context) {
    const room = Param(c, 'room');
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
  async userFeed(c: Context, stream: SSEStreamingApi) {
    const userId = Param(c, 'userId');
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
  chat(c: Context) {
    const room = Param(c, 'room');
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
channels.unsubscribe(channel, clientId)  // remove every connection with that id
channels.publish(channel, event, data)   // broadcast to all subscribers
channels.use(adapter)                    // swap adapter at startup
```

### `@ChannelRoute` — automatic subscribe bridge

On `@Sse` or `@WebSocket` routes, `@ChannelRoute` subscribes a channel client on connect and unsubscribes on disconnect — every published event is pushed to the stream/socket automatically:

```ts
@Sse('/events')
@ChannelRoute((c) => `user:${User(c)?.id}`)   // static string or fn of Context
async notifications(c: Context, stream: SSEStreamingApi) {
  // optionally write initial events; the channel bridge handles the rest
}

@WebSocket('/chat')
@ChannelRoute('room:general')
chat(c: Context) {
  return { onMessage: (e, ws) => { /* still works — bridge wraps onOpen/onClose */ } };
}
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

`ip`, `device`, and `userAgent` are available via Context helpers:

```ts
@Get('/info')
info(c: Context) {
  return { ip: Ip(c), device: Device(c), ua: UserAgent(c) };
}
```

IP resolution order: `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` (first) → `'unknown'`. These headers are trusted unconditionally — only rely on `Ip()` for rate limiting or security decisions behind a proxy that strips client-supplied headers.

Device types: `'mobile' | 'tablet' | 'desktop' | 'bot'`.

---

## Error handling

### `HttpException`

Throw `HttpException` from anywhere in a handler or service — the route builder catches it and returns a structured JSON response at the correct HTTP status code.

```ts
import { HttpException } from 'hono-forge';

@Get('/:id')
async getOne(c: Context) {
  const user = await this.repo.findById(Param(c, 'id'));
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

### Exception filters — `@Catch` / `@UseFilters`

Declarative per-type error handling, resolved through the DI container:

```ts
@Catch(PrismaClientKnownError)          // no args = catch-all
class DbErrorFilter implements ExceptionFilter {
  catch(err: unknown, c: Context) {
    return c.json({ status: 'error', error: { code: 'DB_ERROR' } }, 500);
  }
}

@Controller('/users')
@UseFilters(DbErrorFilter)              // class-level: every route
class UserController {
  @Post()
  @UseFilters(UploadErrorFilter)        // method-level: runs first
  create(c: Context) { /* ... */ }
}
```

Order: method-level filters → class-level filters → `onError` → default `HttpException` handling. A filter returning `void`/`undefined` falls through to the next step. Filters can inject services via `@Injectable`.

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

Throws `HttpException(504)` when exceeded — clients receive a proper `504 Gateway Timeout`.

### `@Transform`

```ts
@Transform((user: User) => ({ id: user.id, name: user.name }))
getUser() { /* ... */ }
```

### `@Cache`

Caches the handler's return value in memory, keyed by `key` (defaults to the method name) + request path + query string — so `/users/1` and `/users/2` cache separately. `ttl` (ms) is required.

```ts
@Cache({ ttl: 60_000, key: 'user-list' })
getAll() { /* ... */ }
```

> Cached hits skip the handler entirely. A handler returning a `Response` object is not cached. For return-value caching independent of HTTP, see `@Memoize`.

### `@CacheInvalidate`

Clears matching cache entries after a mutation handler succeeds. Each pattern is a key prefix — `'user-list'` deletes every `@Cache` entry whose key starts with `user-list:`:

```ts
@Post()
@CacheInvalidate('user-list')
create(c: Context) { /* ... */ }
```

Swap the in-memory store for Redis or another shared backend via `cacheAdapter`:

```ts
HonoRouteBuilder.configure({ cacheAdapter: new MyRedisCacheAdapter(redis) });
// implements CacheAdapter: get / set / delete / deletePattern
```

### `@Idempotent`

Safe retries for mutations: when the client sends an `Idempotency-Key` header, the first **successful** response is stored in the configured `CacheAdapter` and replayed for repeats of the same key — including concurrent duplicates, which share a single execution. Requests without the header pass through normally. Entries live for `ttl` ms (default 24h).

```ts
@Post('/orders')
@Idempotent({ ttl: 86_400_000 }) // optional — default 24h
createOrder(c: Context) { /* runs at most once per key */ }
```

### `@SingleFlight`

Dedupes concurrent identical requests (same method + path + query): while one execution is in-flight, the other callers wait and receive a copy of its response. Guards against thundering-herd spikes on expensive endpoints.

```ts
@Get('/report')
@SingleFlight()
async report(c: Context) { return generateExpensiveReport(); }
```

> Keyed by URL, not request body — intended for reads or endpoints where identical concurrent requests are semantically equal. For client-driven mutations use `@Idempotent`.

### `@Header` / `@Redirect`

```ts
@Get('/feed.xml') @Header('Cache-Control', 'max-age=300')
feed() { /* ... */ }

@Get('/old-users') @Redirect('/users', 308)
oldUsers() { /* never invoked — route always redirects */ }
```

`@Header` is repeatable (multiple decorators merge) and applies to responses produced via `c.json`/`c.body`/etc. — a raw `new Response()` bypasses it. `@Redirect` skips the handler entirely (guards/middleware still run).

### `@Throttle`

Limits how often a method can be called. Throws `HttpException(429)` (with `retryAfterMs` in `meta`) if called again before `ms` milliseconds have passed.

```ts
@Throttle(1000)
async sendWebhook() { /* ... */ }
```

> The throttle window is keyed on the instance (`this`) — on a singleton controller it applies **globally across all requests/users**, not per-client. For per-IP/user rate limiting use `@RateLimit` with a `keyGenerator`.

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

Logs an audit entry before the method executes. Reads `this.logger` (if present), else the logger registered via `registerLogger()`/`LOGGER`, else a `ConsoleLogger` fallback. Entry includes `action`, `userId`, `timestamp`, and method name.

```ts
@Audit({ action: 'user.delete' })
async remove(id: string) { /* ... */ }
```

The logger contract is `{ info?(data, msg?): void }` (pino-style) — see [Operational helpers](#operational-helpers) for `registerLogger`.

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

@Injectable([DB])
class UserRepo {
  constructor(private db: DrizzleDb) {}

  async create(data: NewUser) {
    const tx = useTransaction<DrizzleDb>() ?? this.db;
    return tx.insert(users).values(data);
  }
}

@Injectable([DB, UserRepo])
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

## Operational helpers

### Health check — `mountHealth`

```ts
import { mountHealth } from 'hono-forge';

mountHealth(app, {
  // optional — default '/health'
  path: '/health',
  checks: {
    db: async () => db.execute('select 1').then(() => true),
    redis: () => redis.ping() === 'PONG',
  },
});
// GET /health → 200 { status: 'ok', uptime, checks } or 503 when a check fails/throws
```

### Graceful shutdown — `gracefulShutdown`

```ts
import { gracefulShutdown } from 'hono-forge';

const detach = gracefulShutdown({
  timeoutMs: 10_000, // hard deadline before force-exit(1)
  onShutdown: async () => { await server.stop(); },
});
// SIGINT/SIGTERM → onShutdown() → container.shutdown() (@OnModuleDestroy hooks) → exit(0)
// returns a detach function that removes the signal listeners
```

### Route table — `printRoutes`

```ts
HonoRouteBuilder.printRoutes(AppModule); // or a controller class
// ┌────────┬─────────┬──────────────────┬─────────┬─────────┬───────────┐
// │ method │ path    │ handler          │ guards  │ flags   │ ...       │
// └────────┴─────────┴──────────────────┴─────────┴─────────┴───────────┘
```

Pure metadata read — nothing is instantiated. Great for verifying wiring at startup during development.

### Pluggable logger — `LOGGER` / `registerLogger`

Internal logs (`@Audit` today) go through the `LOGGER` DI token. Bind your own implementation once at startup — pino/winston-compatible (`level(data, msg?)`):

```ts
import { registerLogger, LOGGER } from 'hono-forge';

registerLogger(pinoInstance);          // or container.registerInstance(LOGGER, logger)

@Injectable([LOGGER])
class AuditService {
  constructor(private log: Logger) {}  // injectable like any token
}
```

## Typed client

End-to-end types from decorator metadata — `generateClientTypes` emits a route map where each `output` is the controller method's `Awaited<ReturnType>`, and `createClient` gives a typed fetch client:

```ts
// 1. generate once (e.g. a script or codegen step)
import { generateClientTypes } from 'hono-forge';
const src = generateClientTypes({
  controllers: [UserController],
  importPath: '../server/controllers', // module specifier in the generated file
});
await Bun.write('./client/routes.ts', src);

// 2. consume anywhere
import { createClient } from 'hono-forge';
import type { AppRoutes } from './client/routes';

const api = createClient<AppRoutes>('http://localhost:3000');
const users = await api.request('GET /users');                          // typed output
const one = await api.request('GET /users/:id', { params: { id: '1' } });
await api.request('POST /users', { body: { name: 'Ada' } });
```

Note: `output` is the handler's declared return type — handlers that return `Response` objects produce `Response` in the map (use plain-value returns for typed clients).

## Testing

`createTestingModule` gives you an isolated DI container for unit and e2e tests — framework-agnostic (works with `bun:test`, vitest, `node:test`):

```ts
import { createTestingModule } from 'hono-forge';

const mod = createTestingModule({ controllers: [UserController] })
  .overrideProvider(UserService).useValue({ findAll: () => [] }) // or .useClass() / .useFactory()
  .compile();

// unit-test the controller directly
mod.get(UserController);

// or e2e against a real Hono app
const res = await mod.createApp().fetch(new Request('http://t/users'));

mod.cleanup(); // restores the real container — always call this
```

Overrides win over already-resolved singletons, and `cleanup()` drops everything registered during the test.

## Full example

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  Controller, Get, Post, Delete, Sse,
  Body, Param, User, Cookie, Ip, Device,
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
@Injectable([UserRepo])
class UserController {
  constructor(private repo: UserRepo) {}

  @Get()
  @Public()
  list() { return this.repo.findAll(); }

  @Get('/:id')
  @RequireAuth()
  getOne(c: Context) { return this.repo.findById(Param(c, 'id')); }
}

@Controller('/events')
class EventController {
  @Sse('/user/:userId')
  @RequireAuth()
  async userFeed(c: Context, stream: SSEStreamingApi) {
    const userId = Param(c, 'userId');
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
