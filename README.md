# hono-decorators

NestJS-style decorators for [Hono](https://hono.dev) — controller routing, dependency injection, guards, parameter validation, and more.

## Features

- **Controller routing** — `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`
- **Dependency injection** — `@Injectable`, `@Singleton`, `@Inject`, with circular dependency detection
- **Parameter decorators** — `@Body`, `@Query`, `@Param`, `@Headers`, `@User` with optional Zod validation
- **Guards** — `@RequireAuth`, `@RequireRole`, `@RequirePermission` with pluggable executor
- **Middleware** — `@Middleware` for class and function-based middleware
- **Interceptors** — `@Retry`, `@Timeout`, `@Transform`, `@TrackMetrics`, `@Cache`
- **OpenAPI** — `@ApiDoc`, `@ApiTags`, `@ApiResponse`, `@ApiDeprecated`
- **Utilities** — `@Throttle`, `@Memoize`, `@Audit`, `@Transaction`, `@ValidateResult`

## Install

```bash
npm install hono-decorators
# or
bun add hono-decorators
```

### Peer dependencies

```bash
npm install hono zod reflect-metadata
```

### TypeScript setup

Add to your `tsconfig.json`:

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

> **Note:** This package uses **legacy TypeScript decorators** (`experimentalDecorators: true`), not the TC39 Stage 3 decorators introduced in TypeScript 5.x. They are different and not compatible with each other.

> **Bundler note:** If you use esbuild or Vite, `emitDecoratorMetadata` requires [`@swc/core`](https://swc.rs/) or [`babel-plugin-transform-typescript`](https://babeljs.io/docs/babel-plugin-transform-typescript) to work correctly. With `tsc` or `ts-node` it works out of the box.

---

## Quick start

```ts
import 'reflect-metadata';
import { Hono } from 'hono';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Injectable,
  HonoRouteBuilder,
} from 'hono-decorators';
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

@Injectable()
class UserService {
  getAll() {
    return [{ id: 1, name: 'Alice' }];
  }

  create(data: { name: string; email: string }) {
    return { id: 2, ...data };
  }
}

@Controller('/users')
class UserController {
  constructor(private userService: UserService) {}

  @Get()
  list() {
    return this.userService.getAll();
  }

  @Post()
  create(@Body(CreateUserSchema) body: z.infer<typeof CreateUserSchema>) {
    return this.userService.create(body);
  }

  @Get('/:id')
  getOne(@Param('id') id: string) {
    return { id };
  }
}

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));

export default app;
```

---

## Dependency injection

### `@Injectable()`

Marks a class as injectable. Required for constructor injection.

```ts
@Injectable()
class EmailService {
  send(to: string, body: string) { /* ... */ }
}

@Injectable()
class UserService {
  constructor(private email: EmailService) {}
}
```

### `@Singleton()`

The same instance is returned on every `container.resolve()` call.

```ts
@Injectable()
@Singleton()
class Database {
  constructor() {
    this.conn = connect(process.env.DB_URL);
  }
}
```

### `@Inject(token)`

Inject by string or symbol token — useful for interfaces.

```ts
const LOGGER = Symbol('LOGGER');

container.registerSingleton(LOGGER, new PinoLogger());

@Injectable()
class UserService {
  constructor(@Inject(LOGGER) private logger: Logger) {}
}
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
@Controller('/users', { platform: 'web', version: 'v1' })
// registers routes under /web/v1/users
class UserController {}
```

| Option | Type | Default |
|--------|------|---------|
| `platform` | `'web' \| 'mobile'` | none |
| `version` | `string` | `'v1'` |

### HTTP method decorators

```ts
@Get('/path')
@Post('/path')
@Put('/path')
@Patch('/path')
@Delete('/path')
```

Each accepts `{ platform?: 'web' | 'mobile' | 'all', isPrivate?: boolean }`.

### Building routes

```ts
const app = new Hono();

// mount single controller
app.route('/', HonoRouteBuilder.build(UserController));

// filter by platform
app.route('/', HonoRouteBuilder.build(UserController, 'web'));
app.route('/', HonoRouteBuilder.build(UserController, 'mobile'));
```

---

## Parameter decorators

| Decorator | Source |
|-----------|--------|
| `@Body()` | `await c.req.json()` |
| `@Query()` | `c.req.query()` |
| `@Param(name)` | `c.req.param(name)` |
| `@Headers(name)` | `c.req.header(name)` |
| `@User()` | `c.get('user')` |
| `@Req()` | Hono `HonoRequest` |
| `@Res()` | Hono `Context` |

### With Zod validation

```ts
const Schema = z.object({ name: z.string(), age: z.number() });

@Post()
create(@Body(Schema) body: z.infer<typeof Schema>) {
  // body is already validated and typed
}
```

### Type-safe validated decorators

```ts
@Get()
search(@ValidatedQuery(SearchSchema) query: z.infer<typeof SearchSchema>) {}

@Post()
create(@ValidatedBody(CreateSchema) body: z.infer<typeof CreateSchema>) {}

@Get('/:id')
getOne(@ValidatedParam('id', z.string().uuid()) id: string) {}
```

---

## Guards

Guards run before the route handler. Configure your executor once at app startup — this keeps the package free of JWT or auth library dependencies.

> **Important:** If any route uses a guard decorator (`@RequireAuth`, `@RequireRole`, etc.) but `guardExecutor` is not configured, `HonoRouteBuilder.build()` will throw immediately at startup with a descriptive error. Same applies to `@RateLimit` without `rateLimiterFactory`. This is intentional — silent skipping of security checks is a footgun.

### Setup

```ts
import { HonoRouteBuilder } from 'hono-decorators';

HonoRouteBuilder.configure({
  guardExecutor: async (c, guards) => {
    for (const guard of guards) {
      if (guard.name === 'AuthGuard') {
        const token = c.req.header('authorization')?.split(' ')[1];
        if (!token) throw new Error('Unauthorized: No token');
        const user = verifyJwt(token); // your own JWT logic
        c.set('user', user);
      }

      if (guard.name === 'RoleGuard') {
        const user = c.get('user') as { roles: string[] };
        const hasRole = guard.options?.roles?.some(r => user.roles.includes(r));
        if (!hasRole) throw new Error('Forbidden: Insufficient role');
      }

      if (guard.name === 'PermissionGuard') {
        const user = c.get('user') as { permissions: string[] };
        const { permissions = [], requireAll } = guard.options ?? {};
        const check = requireAll
          ? permissions.every(p => user.permissions.includes(p))
          : permissions.some(p => user.permissions.includes(p));
        if (!check) throw new Error('Forbidden: Missing permissions');
      }
    }
    return true;
  },
});
```

> Errors thrown with `"Unauthorized"` in the message return `401`. Errors with `"Forbidden"` return `403`.

### Usage

```ts
@Controller('/admin')
class AdminController {
  @Get()
  @RequireAuth()
  dashboard() { /* ... */ }

  @Delete('/:id')
  @RequireRole('admin', 'moderator')    // user needs at least ONE
  deleteUser(@Param('id') id: string) { /* ... */ }

  @Post()
  @RequireAllRoles('admin', 'superuser') // user needs ALL
  sensitiveAction() { /* ... */ }

  @Patch('/:id')
  @RequirePermission('users:write')      // user needs ALL listed
  updateUser() { /* ... */ }

  @Get('/report')
  @RequireAnyPermission('reports:read', 'admin:all') // user needs ONE
  getReport() { /* ... */ }

  @Get('/public')
  @Public()
  publicEndpoint() { /* ... */ }
}
```

### Rate limiting

```ts
HonoRouteBuilder.configure({
  rateLimiterFactory: ({ max, windowMs, keyPrefix, message }) => {
    return async (c, next) => {
      // plug in your own rate limit logic (Redis, in-memory, etc.)
      await next();
    };
  },
});

@Post('/login')
@RateLimit({ max: 5, windowMs: 60_000, message: 'Too many attempts' })
login(@Body() body: LoginDto) { /* ... */ }
```

---

## Middleware

Apply middleware at class or method level.

```ts
const logMiddleware = async (c: Context, next: Next) => {
  console.log(c.req.method, c.req.path);
  await next();
};

class AuthMiddleware {
  async use(c: Context, next: Next) {
    // parse token...
    await next();
  }
}

@Controller('/api')
@Middleware(logMiddleware)           // applies to all routes in this controller
class ApiController {
  @Get()
  @Middleware(AuthMiddleware)        // applies to this route only
  protected() { /* ... */ }
}
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

### `@TrackMetrics`

Calls `this.metrics.trackMethodDuration(name, duration, status)` if available.

```ts
@TrackMetrics({ name: 'user.create' })
create() { /* ... */ }
```

### `@Cache`

Stores cache metadata — integrate with your own cache layer.

```ts
@Cache({ ttl: 60_000, key: 'user-list' })
getAll() { /* ... */ }
```

---

## Utilities

### `@Throttle(ms)`

```ts
@Throttle(1000)
expensiveAction() { /* max once per second */ }
```

### `@Memoize({ ttl? })`

```ts
@Memoize({ ttl: 30_000 })
async getConfig() { /* cached for 30s per unique args */ }
```

### `@ValidateResult(schema)`

Validates the return value of a method against a Zod schema.

```ts
@ValidateResult(UserSchema)
async getUser(id: string) { /* ... */ }
```

### `@Audit({ action })`

Logs an audit entry before the method runs. Uses `this.logger.info()` if present, falls back to `console.log`.

```ts
@Audit({ action: 'USER_DELETE' })
delete(id: string) { /* ... */ }
```

### `@Transaction()`

Wraps method in a database transaction. Expects `this.db` to implement `.transaction(fn)`.

```ts
@Transaction()
async transfer(from: string, to: string, amount: number) { /* ... */ }
```

---

## OpenAPI

```ts
@Controller('/users')
@ApiTags('Users')
class UserController {
  @Get()
  @ApiDoc({
    summary: 'List all users',
    description: 'Returns a paginated list of users',
  })
  @ApiResponse(200, 'Success', UserListSchema)
  @ApiResponse(401, 'Unauthorized')
  list() { /* ... */ }

  @Delete('/:id')
  @ApiDeprecated()
  remove() { /* ... */ }
}
```

---

## Full example

```ts
import 'reflect-metadata';
import { Hono } from 'hono';
import {
  Controller, Get, Post, Delete,
  Body, Param, User,
  RequireAuth, RequireRole, Public,
  Injectable, Singleton,
  HonoRouteBuilder, container,
} from 'hono-decorators';

@Injectable()
@Singleton()
class UserRepository {
  private users = [{ id: '1', name: 'Alice', role: 'admin' }];

  findAll() { return this.users; }
  findById(id: string) { return this.users.find(u => u.id === id); }
  delete(id: string) { this.users = this.users.filter(u => u.id !== id); }
}

@Injectable()
class UserService {
  constructor(private repo: UserRepository) {}

  getAll() { return this.repo.findAll(); }
  getOne(id: string) { return this.repo.findById(id); }
  remove(id: string) { this.repo.delete(id); }
}

@Controller('/users')
class UserController {
  constructor(private users: UserService) {}

  @Get()
  @Public()
  list() {
    return this.users.getAll();
  }

  @Get('/:id')
  @RequireAuth()
  getOne(@Param('id') id: string) {
    return this.users.getOne(id);
  }

  @Delete('/:id')
  @RequireRole('admin')
  remove(@Param('id') id: string, @User() user: { name: string }) {
    this.users.remove(id);
    return { deleted: id, by: user.name };
  }
}

HonoRouteBuilder.configure({
  guardExecutor: async (c, guards) => {
    for (const guard of guards) {
      if (guard.name === 'AuthGuard') {
        const user = c.get('user');
        if (!user) throw new Error('Unauthorized');
      }
      if (guard.name === 'RoleGuard') {
        const user = c.get('user') as { role: string };
        const ok = guard.options?.roles?.includes(user?.role);
        if (!ok) throw new Error('Forbidden');
      }
    }
    return true;
  },
});

const app = new Hono();
app.route('/', HonoRouteBuilder.build(UserController));

export default app;
```

---

## License

MIT
