import { describe, it, expect } from 'bun:test';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Head,
  Options,
  All,
  Sse,
  WebSocket,
  RequireAuth,
  RequireRole,
  RequireAllRoles,
  RequirePermission,
  RequireAnyPermission,
  RateLimit,
  Public,
  Private,
  Middleware,
  Cache,
  Retry,
  Timeout,
  Transform,
  TrackMetrics,
  Throttle,
  Memoize,
  ValidateResult,
  Audit,
  Transaction,
  Stateless,
  runWithMemoScope,
  defineSchemas,
  useTransaction,
  paginate,
  paginatedSchema,
  PaginationQuerySchema,
  METADATA_KEYS,
  getClassMeta,
  getMethodMeta,
  HttpException,
} from '../src';
import type { TransactionExecutor } from '../src';
import type {
  RouteMetadata,
  GuardMetadata,
  RateLimitMetadata,
  CacheMetadata,
  HonoMiddlewareFn,
} from '../src';
import type { Context, Next } from 'hono';
import { z } from 'zod';

/* ================= CONTROLLER ================= */

@Controller('/users')
class UserController { }

@Controller()
class RootController { }

@Controller('/items', { platform: 'web', version: 'v2' })
class ItemController { }

describe('@Controller', () => {
  it('sets basePath metadata', () => {
    const meta = getClassMeta<{ basePath: string }>(UserController, METADATA_KEYS.CONTROLLER);
    expect(meta?.basePath).toBe('/users');
  });

  it('defaults to empty basePath when omitted', () => {
    const meta = getClassMeta<{ basePath: string }>(RootController, METADATA_KEYS.CONTROLLER);
    expect(meta?.basePath).toBe('');
  });

  it('prefixes platform and version in basePath', () => {
    const meta = getClassMeta<{ basePath: string }>(ItemController, METADATA_KEYS.CONTROLLER);
    expect(meta?.basePath).toBe('/web/v2/items');
  });
});

/* ================= HTTP METHODS ================= */

class Routes {
  @Get('/list')
  list() { }

  @Post('/create')
  create() { }

  @Put('/:id')
  update() { }

  @Patch('/:id/partial')
  patch() { }

  @Delete('/:id')
  remove() { }
}

class ExtendedRoutes {
  @Head('/ping')
  ping() { }

  @Options('/cors')
  cors() { }

  @All('/any')
  any() { }
}

class SseRoutes {
  @Sse('/events')
  events() { }
}

class WsRoutes {
  @WebSocket('/chat')
  chat() { }
}

describe('HTTP method decorators', () => {
  function getRoutes(cls: Function): RouteMetadata[] {
    return getClassMeta<RouteMetadata[]>(cls, METADATA_KEYS.ROUTES) ?? [];
  }

  it('registers all five routes', () => {
    expect(getRoutes(Routes)).toHaveLength(5);
  });

  it('@Get sets method and path', () => {
    const route = getRoutes(Routes).find(r => r.handlerName === 'list');
    expect(route?.method).toBe('get');
    expect(route?.path).toBe('/list');
  });

  it('@Post sets correct method', () => {
    expect(getRoutes(Routes).find(r => r.handlerName === 'create')?.method).toBe('post');
  });

  it('@Put sets correct method', () => {
    expect(getRoutes(Routes).find(r => r.handlerName === 'update')?.method).toBe('put');
  });

  it('@Patch sets correct method', () => {
    expect(getRoutes(Routes).find(r => r.handlerName === 'patch')?.method).toBe('patch');
  });

  it('@Delete sets correct method', () => {
    expect(getRoutes(Routes).find(r => r.handlerName === 'remove')?.method).toBe('delete');
  });
});

describe('Extended HTTP method decorators', () => {
  function getRoutes(): RouteMetadata[] {
    return getClassMeta<RouteMetadata[]>(ExtendedRoutes, METADATA_KEYS.ROUTES) ?? [];
  }

  it('registers all three extended routes', () => {
    expect(getRoutes()).toHaveLength(3);
  });

  it('@Head sets method "head"', () => {
    expect(getRoutes().find(r => r.handlerName === 'ping')?.method).toBe('head');
  });

  it('@Options sets method "options"', () => {
    expect(getRoutes().find(r => r.handlerName === 'cors')?.method).toBe('options');
  });

  it('@All sets method "all"', () => {
    expect(getRoutes().find(r => r.handlerName === 'any')?.method).toBe('all');
  });
});

describe('@Sse', () => {
  it('registers a GET route', () => {
    const routes = getClassMeta<RouteMetadata[]>(SseRoutes, METADATA_KEYS.ROUTES) ?? [];
    expect(routes.find(r => r.handlerName === 'events')?.method).toBe('get');
  });

  it('sets SSE_ROUTE metadata on the handler', () => {
    const isSse = getMethodMeta<boolean>(SseRoutes, METADATA_KEYS.SSE_ROUTE, 'events');
    expect(isSse).toBe(true);
  });
});

describe('@WebSocket', () => {
  it('registers a GET route', () => {
    const routes = getClassMeta<RouteMetadata[]>(WsRoutes, METADATA_KEYS.ROUTES) ?? [];
    expect(routes.find(r => r.handlerName === 'chat')?.method).toBe('get');
  });

  it('sets WEBSOCKET_ROUTE metadata on the handler', () => {
    const isWs = getMethodMeta<boolean>(WsRoutes, METADATA_KEYS.WEBSOCKET_ROUTE, 'chat');
    expect(isWs).toBe(true);
  });
});

/* ================= GUARDS ================= */

class SecureRoutes {
  @RequireAuth()
  authOnly() { }

  @RequireRole('admin', 'mod')
  roleRoute() { }

  @RequireAllRoles('admin', 'superuser')
  allRolesRoute() { }

  @RequirePermission('users:read', 'users:write')
  permRoute() { }

  @RequireAnyPermission('reports:read', 'admin:all')
  anyPermRoute() { }

  @Public()
  publicRoute() { }
}

function getGuards(method: string): GuardMetadata[] {
  return getMethodMeta<GuardMetadata[]>(SecureRoutes, METADATA_KEYS.GUARDS, method) ?? [];
}

describe('Guard decorators', () => {
  it('@RequireAuth adds AuthGuard', () => {
    expect(getGuards('authOnly').some(g => g.name === 'AuthGuard')).toBe(true);
  });

  it('@RequireRole adds RoleGuard with correct roles', () => {
    const guard = getGuards('roleRoute').find(g => g.name === 'RoleGuard');
    expect(guard?.options?.roles).toEqual(['admin', 'mod']);
  });

  it('@RequireRole does NOT require all roles', () => {
    const guard = getGuards('roleRoute').find(g => g.name === 'RoleGuard');
    expect(guard?.options?.requireAll).toBeFalsy();
  });

  it('@RequireAllRoles sets requireAll: true', () => {
    const guard = getGuards('allRolesRoute').find(g => g.name === 'RoleGuard');
    expect(guard?.options?.requireAll).toBe(true);
  });

  it('@RequirePermission adds PermissionGuard with requireAll: true', () => {
    const guard = getGuards('permRoute').find(g => g.name === 'PermissionGuard');
    expect(guard?.options?.permissions).toEqual(['users:read', 'users:write']);
    expect(guard?.options?.requireAll).toBe(true);
  });

  it('@RequireAnyPermission sets requireAll: false', () => {
    const guard = getGuards('anyPermRoute').find(g => g.name === 'PermissionGuard');
    expect(guard?.options?.requireAll).toBe(false);
  });

  it('@Public sets isPublic flag on the method', () => {
    const isPublic = getMethodMeta<boolean>(SecureRoutes, METADATA_KEYS.IS_PUBLIC, 'publicRoute');
    expect(isPublic).toBe(true);
  });
});

/* ================= PRIVATE ================= */

@Controller('/priv-test')
class PrivateRoutes {
  @Get('/open')
  open() { }

  @Get('/hidden')
  @Private()
  hidden() { }
}

describe('@Private', () => {
  it('sets isPrivate metadata on the annotated method', () => {
    expect(getMethodMeta<boolean>(PrivateRoutes, METADATA_KEYS.IS_PRIVATE, 'hidden')).toBe(true);
  });

  it('does not set isPrivate on non-annotated methods', () => {
    expect(getMethodMeta<boolean>(PrivateRoutes, METADATA_KEYS.IS_PRIVATE, 'open')).toBeUndefined();
  });
});

/* ================= STATELESS ================= */

describe('@Stateless', () => {
  it('sets stateless metadata on the class', () => {
    @Stateless()
    class StatelessRepo { }
    expect(getClassMeta<boolean>(StatelessRepo, METADATA_KEYS.STATELESS)).toBe(true);
  });

  it('does not set stateless on non-annotated class', () => {
    class StatefulSvc { }
    expect(getClassMeta<boolean>(StatefulSvc, METADATA_KEYS.STATELESS)).toBeUndefined();
  });
});

/* ================= RATE LIMIT ================= */

class RateLimitedRoutes {
  @RateLimit({ max: 10, windowMs: 60_000, message: 'Slow down' })
  limited() { }
}

describe('@RateLimit', () => {
  it('stores rate limit metadata on the method', () => {
    const meta = getMethodMeta<RateLimitMetadata>(RateLimitedRoutes, METADATA_KEYS.RATE_LIMIT, 'limited');
    expect(meta?.max).toBe(10);
    expect(meta?.windowMs).toBe(60_000);
    expect(meta?.message).toBe('Slow down');
  });
});

/* ================= MIDDLEWARE ================= */

const fn1: HonoMiddlewareFn = async (_c: Context, next: Next) => next();
const fn2: HonoMiddlewareFn = async (_c: Context, next: Next) => next();

class MwRoutes {
  @Middleware(fn1, fn2)
  handler() { }
}

@Middleware(fn1)
class MwClass { }

describe('@Middleware', () => {
  it('stores middleware array on the method', () => {
    const mws = getMethodMeta<HonoMiddlewareFn[]>(MwRoutes, METADATA_KEYS.METHOD_MIDDLEWARES, 'handler');
    expect(mws).toHaveLength(2);
    expect(mws?.[0]).toBe(fn1);
    expect(mws?.[1]).toBe(fn2);
  });

  it('stores middleware on the class when used as ClassDecorator', () => {
    const mws = getClassMeta<HonoMiddlewareFn[]>(MwClass, METADATA_KEYS.MIDDLEWARES);
    expect(mws).toHaveLength(1);
    expect(mws?.[0]).toBe(fn1);
  });

  it('instantiates a class middleware exactly once', () => {
    let ctorCalls = 0;
    class ClassMw {
      constructor() { ctorCalls++; }
      async use(_c: Context, next: Next) { return next(); }
    }
    Middleware(ClassMw);
    expect(ctorCalls).toBe(1);
  });
});

/* ================= CACHE ================= */

class CachedRoutes {
  @Cache({ ttl: 5000, key: 'my-key' })
  fetch() { }
}

describe('@Cache', () => {
  it('stores ttl and key in metadata', () => {
    const meta = getMethodMeta<CacheMetadata>(CachedRoutes, METADATA_KEYS.CACHE, 'fetch');
    expect(meta?.ttl).toBe(5000);
    expect(meta?.key).toBe('my-key');
  });
});

/* ================= INTERCEPTORS ================= */

describe('@Retry', () => {
  it('succeeds if method eventually passes within attempts', async () => {
    let calls = 0;
    class Svc {
      @Retry({ attempts: 3, delay: 0 })
      async fetch() {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      }
    }
    const result = await new Svc().fetch();
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws after exhausting all attempts', async () => {
    class Svc {
      @Retry({ attempts: 2, delay: 0 })
      async fetch(): Promise<string> { throw new Error('always fails'); }
    }
    await expect(new Svc().fetch()).rejects.toThrow('always fails');
  });
});

describe('@Timeout', () => {
  it('resolves when method completes before timeout', async () => {
    class Svc {
      @Timeout(1000)
      async fast() { return 'done'; }
    }
    await expect(new Svc().fast()).resolves.toBe('done');
  });

  it('rejects when method exceeds timeout', async () => {
    class Svc {
      @Timeout(10)
      async slow() { return new Promise(r => setTimeout(r, 500)); }
    }
    await expect(new Svc().slow()).rejects.toThrow(/Timeout/);
  });

  it('throws HttpException 504 on timeout', async () => {
    class Svc {
      @Timeout(10)
      async slow() { return new Promise(r => setTimeout(r, 500)); }
    }
    const err = await new Svc().slow().catch(e => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).status).toBe(504);
  });
});

describe('@Transform', () => {
  it('applies transform function to return value', async () => {
    class Svc {
      @Transform((x: number) => x * 2)
      async compute() { return 5; }
    }
    await expect(new Svc().compute()).resolves.toBe(10);
  });

  it('can transform to a different shape', async () => {
    class Svc {
      @Transform((u: { id: number; name: string; }) => ({ id: u.id }))
      async getUser() { return { id: 1, name: 'Alice' }; }
    }
    await expect(new Svc().getUser()).resolves.toEqual({ id: 1 } as { id: number; name: string; });
  });
});

describe('@TrackMetrics', () => {
  it('passes return value through unchanged', async () => {
    class Svc {
      @TrackMetrics({ name: 'test_metric' })
      async compute() { return 42; }
    }
    await expect(new Svc().compute()).resolves.toBe(42);
  });

  it('re-throws errors from the original method', async () => {
    class Svc {
      @TrackMetrics()
      async boom(): Promise<void> { throw new Error('metric error'); }
    }
    await expect(new Svc().boom()).rejects.toThrow('metric error');
  });

  it('uses ClassName.method as the default metric name', async () => {
    const names: string[] = [];
    class Svc {
      metrics = { trackMethodDuration: (n: string) => names.push(n) };
      @TrackMetrics()
      async work() { return 1; }
    }
    await new Svc().work();
    expect(names).toEqual(['Svc.work']);
  });
});

/* ================= THROTTLE ================= */

describe('@Throttle', () => {
  it('allows the first call through', async () => {
    class Svc {
      @Throttle(500)
      async ping() { return 'pong'; }
    }
    await expect(new Svc().ping()).resolves.toBe('pong');
  });

  it('throws on a second call within the throttle window', async () => {
    class Svc {
      @Throttle(5000)
      async ping() { return 'pong'; }
    }
    const svc = new Svc();
    await svc.ping();
    await expect(svc.ping()).rejects.toThrow('Throttled');
  });

  it('throws HttpException 429 with retryAfterMs meta', async () => {
    class Svc {
      @Throttle(5000)
      async ping() { return 'pong'; }
    }
    const svc = new Svc();
    await svc.ping();
    const err = await svc.ping().catch(e => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).status).toBe(429);
    expect((err as HttpException).meta?.['retryAfterMs']).toBeGreaterThan(0);
  });

  it('two separate instances have independent throttle windows', async () => {
    class Svc {
      @Throttle(5000)
      async ping() { return 'pong'; }
    }
    const a = new Svc();
    const b = new Svc();
    await a.ping();
    await expect(b.ping()).resolves.toBe('pong');
  });

  it('same instance is still throttled for subsequent calls', async () => {
    class Svc {
      @Throttle(5000)
      async ping() { return 'pong'; }
    }
    const svc = new Svc();
    await svc.ping();
    await expect(svc.ping()).rejects.toThrow('Throttled');
  });
});

/* ================= MEMOIZE ================= */

describe('@Memoize', () => {
  it('returns cached result on second call with same args', async () => {
    let calls = 0;
    class Svc {
      @Memoize()
      async fetch(id: number) { calls++; return { id }; }
    }
    const svc = new Svc();
    await svc.fetch(1);
    await svc.fetch(1);
    expect(calls).toBe(1);
  });

  it('re-executes for different args', async () => {
    let calls = 0;
    class Svc {
      @Memoize()
      async fetch(id: number) { calls++; return { id }; }
    }
    const svc = new Svc();
    await svc.fetch(1);
    await svc.fetch(2);
    expect(calls).toBe(2);
  });

  it('re-executes after ttl expires', async () => {
    let calls = 0;
    class Svc {
      @Memoize({ ttl: 50 })
      async fetch() { calls++; return calls; }
    }
    const svc = new Svc();
    await svc.fetch();
    await new Promise(r => setTimeout(r, 80));
    await svc.fetch();
    expect(calls).toBe(2);
  });

  it('scope: "global" shares cache across calls (default)', async () => {
    let calls = 0;
    class Svc {
      @Memoize({ scope: 'global' })
      async fetch(id: number) { calls++; return id; }
    }
    const svc = new Svc();
    await svc.fetch(1);
    await svc.fetch(1);
    expect(calls).toBe(1);
  });

  it('scope: "request" isolates cache per runWithMemoScope call', async () => {
    let calls = 0;
    class Svc {
      @Memoize({ scope: 'request' })
      async fetch(id: number) { calls++; return id; }
    }
    const svc = new Svc();

    await runWithMemoScope(async () => {
      await svc.fetch(1);
      await svc.fetch(1);
    });

    await runWithMemoScope(async () => {
      await svc.fetch(1);
    });

    expect(calls).toBe(2);
  });

  it('scope: "request" does NOT share results between concurrent requests', async () => {
    const results: number[] = [];
    class Svc {
      @Memoize({ scope: 'request' })
      async getUser(id: number) { return id * 10; }
    }
    const svc = new Svc();

    await Promise.all([
      runWithMemoScope(async () => { results.push(await svc.getUser(1)); }),
      runWithMemoScope(async () => { results.push(await svc.getUser(2)); }),
    ]);

    expect(results).toContain(10);
    expect(results).toContain(20);
  });
});

/* ================= VALIDATE RESULT ================= */

describe('@ValidateResult', () => {
  it('passes through a valid return value', async () => {
    const Schema = z.object({ id: z.number() });
    class Svc {
      @ValidateResult(Schema)
      async get() { return { id: 1 }; }
    }
    await expect(new Svc().get()).resolves.toEqual({ id: 1 });
  });

  it('throws ZodError when return value fails schema', async () => {
    const Schema = z.object({ id: z.number() });
    class Svc {
      @ValidateResult(Schema)
      async get() { return { id: 'not-a-number' }; }
    }
    await expect(new Svc().get()).rejects.toThrow();
  });
});

/* ================= AUDIT ================= */

describe('@Audit', () => {
  it('passes return value through unchanged', async () => {
    class Svc {
      @Audit({ action: 'user.read' })
      async getUser() { return { id: 1 }; }
    }
    await expect(new Svc().getUser()).resolves.toEqual({ id: 1 });
  });

  it('calls this.logger.info with audit metadata', async () => {
    const logged: unknown[] = [];
    class Svc {
      logger = { info: (data: unknown) => logged.push(data) };
      @Audit({ action: 'user.delete' })
      async remove() { return true; }
    }
    await new Svc().remove();
    expect(logged.length).toBe(1);
    expect((logged[0] as { action: string; }).action).toBe('user.delete');
  });
});

/* ================= TRANSACTION ================= */

describe('@Transaction', () => {
  it('wraps method call inside db.transaction', async () => {
    let txUsed = false;
    const fakeDb = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txUsed = true;
        return fn({});
      },
    };
    class Repo {
      db = fakeDb;
      @Transaction()
      async save() { return 'saved'; }
    }
    const result = await new Repo().save();
    expect(result).toBe('saved');
    expect(txUsed).toBe(true);
  });

  it('throws if no db property on the instance', async () => {
    class Repo {
      @Transaction()
      async save() { return 'saved'; }
    }
    await expect(new Repo().save()).rejects.toThrow('@Transaction');
  });

  it('uses a custom executor (Prisma-style $transaction)', async () => {
    let txUsed = false;
    const prismaExecutor: TransactionExecutor = (db, run) => {
      txUsed = true;
      return (db as { $transaction: typeof run; }).$transaction(run);
    };

    const fakePrisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    };

    class Repo {
      db = fakePrisma;
      @Transaction(prismaExecutor)
      async save() { return 'prisma-saved'; }
    }

    const result = await new Repo().save();
    expect(result).toBe('prisma-saved');
    expect(txUsed).toBe(true);
  });
});

/* ================= defineSchemas ================= */

describe('defineSchemas', () => {
  it('exposes select, insert, and update schemas', () => {
    const schemas = defineSchemas(
      z.object({ id: z.number(), name: z.string() }),
      z.object({ name: z.string().min(1), email: z.string().email() }),
    );
    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('insert validates required fields', () => {
    const schemas = defineSchemas(
      z.object({ id: z.number(), name: z.string() }),
      z.object({ name: z.string().min(1), email: z.string().email() }),
    );
    expect(schemas.insert.safeParse({ name: 'Alice', email: 'alice@example.com' }).success).toBe(true);
  });

  it('update makes all insert fields optional', () => {
    const schemas = defineSchemas(
      z.object({ id: z.number(), name: z.string() }),
      z.object({ name: z.string().min(1), email: z.string().email() }),
    );
    expect(schemas.update.safeParse({ name: 'Bob' }).success).toBe(true);
  });

  it('select validates full row shape', () => {
    const schemas = defineSchemas(
      z.object({ id: z.number(), name: z.string() }),
      z.object({ name: z.string() }),
    );
    expect(schemas.select.safeParse({ id: 1, name: 'Alice' }).success).toBe(true);
    expect(schemas.select.safeParse({ name: 'Alice' }).success).toBe(false);
  });
});

/* ================= useTransaction ================= */

describe('useTransaction', () => {
  it('returns undefined outside a @Transaction context', () => {
    expect(useTransaction()).toBeUndefined();
  });

  it('returns the tx object inside @Transaction', async () => {
    const fakeTx = { isTx: true };
    let captured: unknown;

    class Repo {
      db = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx) };

      @Transaction()
      async save() {
        captured = useTransaction();
        return 'ok';
      }
    }

    await new Repo().save();
    expect(captured).toBe(fakeTx);
  });

  it('tx context is cleared after @Transaction completes', async () => {
    class Svc {
      db = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
      @Transaction()
      async run() { return 'done'; }
    }
    await new Svc().run();
    expect(useTransaction()).toBeUndefined();
  });
});

/* ================= paginate ================= */

describe('paginate', () => {
  it('calculates totalPages and hasNext/hasPrev correctly', () => {
    const result = paginate(['a', 'b', 'c'], 95, { page: 1, limit: 20 });
    expect(result.meta.totalPages).toBe(5);
    expect(result.meta.hasNext).toBe(true);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('last page: hasNext false, hasPrev true', () => {
    const result = paginate(['x'], 95, { page: 5, limit: 20 });
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('single page: hasNext and hasPrev both false', () => {
    const result = paginate([1, 2], 2, { page: 1, limit: 20 });
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('data is passed through unchanged', () => {
    const data = [{ id: 1 }, { id: 2 }];
    expect(paginate(data, 2, { page: 1, limit: 10 }).data).toBe(data);
  });
});

describe('paginatedSchema', () => {
  it('validates a correct paginated response', () => {
    const schema = paginatedSchema(z.object({ id: z.number() }));
    const result = schema.safeParse({
      data: [{ id: 1 }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid item shape', () => {
    const schema = paginatedSchema(z.object({ id: z.number() }));
    const result = schema.safeParse({
      data: [{ id: 'not-a-number' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });
    expect(result.success).toBe(false);
  });
});

describe('PaginationQuerySchema', () => {
  it('coerces string page/limit to numbers', () => {
    const result = PaginationQuerySchema.safeParse({ page: '2', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it('applies defaults when page/limit are absent', () => {
    const result = PaginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('rejects limit above 100', () => {
    expect(PaginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
