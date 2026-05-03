import 'reflect-metadata';
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
  Body,
  Query,
  Param,
  Headers,
  User,
  Req,
  Res,
  SseStream,
  RequireAuth,
  RequireRole,
  RequireAllRoles,
  RequirePermission,
  RequireAnyPermission,
  RateLimit,
  Public,
  Middleware,
  Cache,
  Retry,
  Timeout,
  Transform,
  TrackMetrics,
  METADATA_KEYS,
} from '../src';
import type {
  RouteMetadata,
  GuardMetadata,
  ParamMetadata,
  RateLimitMetadata,
  CacheMetadata,
  HonoMiddlewareFn,
} from '../src';
import type { Context, Next } from 'hono';

/* ================= CONTROLLER ================= */

@Controller('/users')
class UserController {}

@Controller()
class RootController {}

@Controller('/items', { platform: 'web', version: 'v2' })
class ItemController {}

describe('@Controller', () => {
  it('sets basePath metadata', () => {
    const meta = Reflect.getMetadata(METADATA_KEYS.CONTROLLER, UserController);
    expect(meta.basePath).toBe('/users');
  });

  it('defaults to empty basePath when omitted', () => {
    const meta = Reflect.getMetadata(METADATA_KEYS.CONTROLLER, RootController);
    expect(meta.basePath).toBe('');
  });

  it('prefixes platform and version in basePath', () => {
    const meta = Reflect.getMetadata(METADATA_KEYS.CONTROLLER, ItemController);
    expect(meta.basePath).toBe('/web/v2/items');
  });
});

/* ================= HTTP METHODS ================= */

class Routes {
  @Get('/list')
  list() {}

  @Post('/create')
  create() {}

  @Put('/:id')
  update() {}

  @Patch('/:id/partial')
  patch() {}

  @Delete('/:id')
  remove() {}
}

class ExtendedRoutes {
  @Head('/ping')
  ping() {}

  @Options('/cors')
  cors() {}

  @All('/any')
  any() {}
}

class SseRoutes {
  @Sse('/events')
  events(@SseStream() _stream: unknown) {}
}

class WsRoutes {
  @WebSocket('/chat')
  chat() {}
}

describe('HTTP method decorators', () => {
  function getRoutes(): RouteMetadata[] {
    return Reflect.getMetadata(METADATA_KEYS.ROUTES, Routes) ?? [];
  }

  it('registers all five routes', () => {
    expect(getRoutes()).toHaveLength(5);
  });

  it('@Get sets method and path', () => {
    const route = getRoutes().find(r => r.handlerName === 'list');
    expect(route?.method).toBe('get');
    expect(route?.path).toBe('/list');
  });

  it('@Post sets correct method', () => {
    expect(getRoutes().find(r => r.handlerName === 'create')?.method).toBe('post');
  });

  it('@Put sets correct method', () => {
    expect(getRoutes().find(r => r.handlerName === 'update')?.method).toBe('put');
  });

  it('@Patch sets correct method', () => {
    expect(getRoutes().find(r => r.handlerName === 'patch')?.method).toBe('patch');
  });

  it('@Delete sets correct method', () => {
    expect(getRoutes().find(r => r.handlerName === 'remove')?.method).toBe('delete');
  });
});

describe('Extended HTTP method decorators', () => {
  function getRoutes(): RouteMetadata[] {
    return Reflect.getMetadata(METADATA_KEYS.ROUTES, ExtendedRoutes) ?? [];
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
    const routes = Reflect.getMetadata(METADATA_KEYS.ROUTES, SseRoutes) as RouteMetadata[];
    expect(routes.find(r => r.handlerName === 'events')?.method).toBe('get');
  });

  it('sets SSE_ROUTE metadata on the handler', () => {
    const isSse = Reflect.getMetadata(
      METADATA_KEYS.SSE_ROUTE,
      SseRoutes.prototype,
      'events'
    );
    expect(isSse).toBe(true);
  });

  it('@SseStream sets param type "sse"', () => {
    const params = Reflect.getMetadata(
      METADATA_KEYS.PARAMS,
      new SseRoutes(),
      'events'
    ) as Array<{ type: string; index: number }>;
    const p = params.find(p => p.type === 'sse');
    expect(p?.index).toBe(0);
  });
});

describe('@WebSocket', () => {
  it('registers a GET route', () => {
    const routes = Reflect.getMetadata(METADATA_KEYS.ROUTES, WsRoutes) as RouteMetadata[];
    expect(routes.find(r => r.handlerName === 'chat')?.method).toBe('get');
  });

  it('sets WEBSOCKET_ROUTE metadata on the handler', () => {
    const isWs = Reflect.getMetadata(
      METADATA_KEYS.WEBSOCKET_ROUTE,
      WsRoutes.prototype,
      'chat'
    );
    expect(isWs).toBe(true);
  });
});

/* ================= PARAM DECORATORS ================= */

class ParamCtrl {
  handler(
    @Body() _body: unknown,
    @Query() _query: unknown,
    @Param('id') _id: unknown,
    @Headers('x-token') _token: unknown,
    @User() _user: unknown,
  ) {}
}

describe('Parameter decorators', () => {
  function getParams(): ParamMetadata[] {
    return Reflect.getMetadata(METADATA_KEYS.PARAMS, new ParamCtrl(), 'handler') ?? [];
  }

  it('@Body is at index 0 with type "body"', () => {
    const p = getParams().find(p => p.type === 'body');
    expect(p?.index).toBe(0);
  });

  it('@Query is at index 1 with type "query"', () => {
    const p = getParams().find(p => p.type === 'query');
    expect(p?.index).toBe(1);
  });

  it('@Param is at index 2 with correct name', () => {
    const p = getParams().find(p => p.type === 'param');
    expect(p?.index).toBe(2);
    expect(p?.name).toBe('id');
  });

  it('@Headers is at index 3 with correct name', () => {
    const p = getParams().find(p => p.type === 'headers');
    expect(p?.index).toBe(3);
    expect(p?.name).toBe('x-token');
  });

  it('@User is at index 4', () => {
    const p = getParams().find(p => p.type === 'user');
    expect(p?.index).toBe(4);
  });
});

/* ================= GUARDS ================= */

class SecureRoutes {
  @RequireAuth()
  authOnly() {}

  @RequireRole('admin', 'mod')
  roleRoute() {}

  @RequireAllRoles('admin', 'superuser')
  allRolesRoute() {}

  @RequirePermission('users:read', 'users:write')
  permRoute() {}

  @RequireAnyPermission('reports:read', 'admin:all')
  anyPermRoute() {}

  @Public()
  publicRoute() {}
}

const secureProto = SecureRoutes.prototype;

function getGuards(method: string): GuardMetadata[] {
  return Reflect.getMetadata(METADATA_KEYS.GUARDS, secureProto, method) ?? [];
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
    const isPublic = Reflect.getMetadata('isPublic', secureProto, 'publicRoute');
    expect(isPublic).toBe(true);
  });
});

/* ================= RATE LIMIT ================= */

class RateLimitedRoutes {
  @RateLimit({ max: 10, windowMs: 60_000, message: 'Slow down' })
  limited() {}
}

describe('@RateLimit', () => {
  it('stores rate limit metadata on the method', () => {
    const meta = Reflect.getMetadata(
      METADATA_KEYS.RATE_LIMIT,
      RateLimitedRoutes.prototype,
      'limited'
    ) as RateLimitMetadata;

    expect(meta.max).toBe(10);
    expect(meta.windowMs).toBe(60_000);
    expect(meta.message).toBe('Slow down');
  });
});

/* ================= MIDDLEWARE ================= */

const fn1: HonoMiddlewareFn = async (_c: Context, next: Next) => next();
const fn2: HonoMiddlewareFn = async (_c: Context, next: Next) => next();

class MwRoutes {
  @Middleware(fn1, fn2)
  handler() {}
}

@Middleware(fn1)
class MwClass {}

describe('@Middleware', () => {
  it('stores middleware array on the method', () => {
    const mws = Reflect.getMetadata(
      METADATA_KEYS.MIDDLEWARES,
      MwRoutes.prototype,
      'handler'
    ) as HonoMiddlewareFn[];

    expect(mws).toHaveLength(2);
    expect(mws[0]).toBe(fn1);
    expect(mws[1]).toBe(fn2);
  });

  it('stores middleware on the class when used as ClassDecorator', () => {
    const mws = Reflect.getMetadata(METADATA_KEYS.MIDDLEWARES, MwClass) as HonoMiddlewareFn[];
    expect(mws).toHaveLength(1);
    expect(mws[0]).toBe(fn1);
  });
});

/* ================= CACHE ================= */

class CachedRoutes {
  @Cache({ ttl: 5000, key: 'my-key' })
  fetch() {}
}

describe('@Cache', () => {
  it('stores ttl and key in metadata', () => {
    const meta = Reflect.getMetadata(
      METADATA_KEYS.CACHE,
      CachedRoutes.prototype,
      'fetch'
    ) as CacheMetadata;

    expect(meta.ttl).toBe(5000);
    expect(meta.key).toBe('my-key');
  });
});

/* ================= REQ / RES ================= */

class ReqResCtrl {
  handler(
    @Req() _req: unknown,
    @Res() _res: unknown,
  ) {}
}

describe('@Req / @Res', () => {
  function getParams(): ParamMetadata[] {
    return Reflect.getMetadata(METADATA_KEYS.PARAMS, new ReqResCtrl(), 'handler') ?? [];
  }

  it('@Req sets type "req" at index 0', () => {
    const p = getParams().find(p => p.type === 'req');
    expect(p?.index).toBe(0);
  });

  it('@Res sets type "res" at index 1', () => {
    const p = getParams().find(p => p.type === 'res');
    expect(p?.index).toBe(1);
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
      @Transform((u: { id: number; name: string }) => ({ id: u.id }))
      async getUser() { return { id: 1, name: 'Alice' }; }
    }
    await expect(new Svc().getUser()).resolves.toEqual({ id: 1 });
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
});
