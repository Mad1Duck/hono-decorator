import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Head,
  Options,
  All,
  WebSocket,
  Param,
  Body,
  Cookie,
  Cookies,
  Injectable,
  Singleton,
  RequestScoped,
  RequireAuth,
  RequireRole,
  Public,
  Private,
  RateLimit,
  Cache,
  Middleware,
  Use,
  Cors,
  Compress,
  SecureHeaders,
  PrettyJson,
  HonoRouteBuilder,
  container,
  fromModules,
  getTraceId,
  HttpException,
} from '../src';
import type { Context, Next } from 'hono';
import { z } from 'zod';

/* -------- helper -------- */

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://test.local${path}`, init);
}

/* -------- store & service -------- */

@Injectable()
@Singleton()
class ItemStore {
  private items = [
    { id: '1', name: 'Apple' },
    { id: '2', name: 'Banana' },
  ];
  getAll() { return this.items; }
  getById(id: string) { return this.items.find(i => i.id === id); }
  create(name: string) {
    const item = { id: String(this.items.length + 1), name };
    this.items.push(item);
    return item;
  }
}

@Injectable([ItemStore])
class ItemService {
  constructor(private store: ItemStore) { }
  getAll() { return this.store.getAll(); }
  getById(id: string) { return this.store.getById(id); }
  create(name: string) { return this.store.create(name); }
}

/* -------- controllers -------- */

const CreateItemSchema = z.object({ name: z.string().min(1) });

@Controller('/items')
@Injectable([ItemService])
class ItemController {
  constructor(private svc: ItemService) { }

  @Get()
  @Public()
  list() { return this.svc.getAll(); }

  @Get('/search')
  @Public()
  search(c: Context) { return { query: c.req.query() }; }

  @Get('/:id')
  @Public()
  getOne(c: Context) { return this.svc.getById(Param(c, 'id')); }

  @Post()
  @Public()
  async create(c: Context) {
    const body = await CreateItemSchema.parseAsync(await c.req.json());
    return this.svc.create(body.name);
  }
}

@Controller('/secure')
class SecureController {
  @Get()
  @RequireAuth()
  protectedList() { return { data: 'secret' }; }

  @Delete('/:id')
  @RequireRole('admin')
  adminDelete(c: Context) {
    const id = c.req.param('id');
    const user = c.get('user') as { name: string; };
    return { deleted: id, by: user.name };
  }
}

@Controller('/limited')
class LimitedController {
  @Get()
  @Public()
  @RateLimit({ max: 5, windowMs: 60_000 })
  limited() { return { ok: true }; }
}

const mwLog: string[] = [];
const tracingMw = async (_c: Context, next: Next) => {
  mwLog.push('before');
  await next();
  mwLog.push('after');
};

@Controller('/mw-test')
class MwController {
  @Get()
  @Public()
  @Middleware(tracingMw)
  handle() {
    mwLog.push('handler');
    return { ok: true };
  }
}

@Controller('/void-test')
class VoidController {
  @Get()
  @Public()
  handle() { /* returns undefined */ }
}

@Controller('/extended')
class ExtendedMethodController {
  @Head()
  @Public()
  ping() { return null; }

  @Options()
  @Public()
  cors() { return { allow: 'GET,POST' }; }

  @All('/any')
  @Public()
  any() { return { ok: true }; }
}

@Controller('/ws-test')
class WsController {
  @WebSocket()
  connect() {
    return { onMessage: (_e: unknown, _ws: unknown) => { } };
  }
}

const PatchItemSchema = z.object({ name: z.string().min(1) });
const QueryFilterSchema = z.object({ search: z.string().optional(), limit: z.coerce.number().optional() });

@Controller('/patch-test')
class PatchController {
  private items: Record<string, string> = { '1': 'Apple', '2': 'Banana' };

  @Patch('/:id')
  @Public()
  async update(c: Context) {
    const id = Param(c, 'id');
    const body = await PatchItemSchema.parseAsync(await c.req.json());
    this.items[id] = body.name;
    return { id, name: body.name };
  }
}

@Controller('/qschema-test')
class QuerySchemaController {
  @Get()
  @Public()
  async list(c: Context) {
    const q = await QueryFilterSchema.parseAsync(c.req.query());
    return { search: q.search ?? null, limit: q.limit ?? null };
  }
}

@Controller('/platform-test', { platform: 'web', version: 'v1' })
class WebController {
  @Get()
  @Public()
  list() { return { platform: 'web' }; }
}

@Controller('/platform-test', { platform: 'mobile', version: 'v1' })
class MobileController {
  @Get()
  @Public()
  list() { return { platform: 'mobile' }; }
}

/* ================= TESTS ================= */

describe('HonoRouteBuilder', () => {
  beforeEach(() => {
    HonoRouteBuilder.configure({});
    container.clear();
    mwLog.length = 0;
  });

  /* -------- security: throw at build time -------- */

  describe('security guards', () => {
    it('throws at build() when guards present but no guardExecutor', () => {
      expect(() => HonoRouteBuilder.build(SecureController)).toThrow(/guardExecutor/);
    });

    it('error message includes the route label', () => {
      expect(() => HonoRouteBuilder.build(SecureController)).toThrow(/GET \/secure/);
    });

    it('throws at build() when @RateLimit present but no rateLimiterFactory', () => {
      expect(() => HonoRouteBuilder.build(LimitedController)).toThrow(/rateLimiterFactory/);
    });

    it('does NOT throw when guardExecutor is configured', () => {
      HonoRouteBuilder.configure({ guardExecutor: async () => true });
      expect(() => HonoRouteBuilder.build(SecureController)).not.toThrow();
    });

    it('does NOT throw when rateLimiterFactory is configured', () => {
      HonoRouteBuilder.configure({ rateLimiterFactory: () => async (_c, next) => next() });
      expect(() => HonoRouteBuilder.build(LimitedController)).not.toThrow();
    });
  });

  /* -------- basic routing -------- */

  describe('routing', () => {
    it('GET /items returns list', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items'));
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it('GET /items/:id returns single item', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items/1'));
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; };
      expect(body.id).toBe('1');
    });

    it('POST /items creates new item', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Cherry' }),
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string; };
      expect(body.name).toBe('Cherry');
    });

    it('GET /items/:id resolves route param', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items/2'));
      const body = await res.json() as { id: string; };
      expect(body.id).toBe('2');
    });

    it('GET /items/search resolves query string', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items/search?name=apple&page=1'));
      expect(res.status).toBe(200);
      const body = await res.json() as { query: Record<string, string>; };
      expect(body.query['name']).toBe('apple');
      expect(body.query['page']).toBe('1');
    });

    it('POST /items returns 400 on invalid payload', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  /* -------- guards execution -------- */

  describe('guard execution', () => {
    it('returns 401 when guardExecutor throws Unauthorized', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw new Error('Unauthorized: No token'); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when guardExecutor throws Forbidden', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw new Error('Forbidden: Insufficient role'); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 when guardExecutor returns false', async () => {
      HonoRouteBuilder.configure({ guardExecutor: async () => false });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(403);
    });

    it('returns the HttpException status when guardExecutor throws HttpException', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw new HttpException(401, 'Token expired'); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: { code: string; message: string; }; };
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Token expired');
    });

    it('returns 403 for HttpException(403) from guardExecutor', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw HttpException.forbidden('Not your resource'); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('calls onError when guardExecutor throws', async () => {
      const errors: unknown[] = [];
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw new HttpException(401, 'Token expired'); },
        onError: (err) => { errors.push(err); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      await app.fetch(makeRequest('/secure'));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(HttpException);
    });

    it('allows request when guardExecutor returns true', async () => {
      HonoRouteBuilder.configure({ guardExecutor: async () => true });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(200);
    });

    it('handler can read user set by guardExecutor via c.get("user")', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async (c) => {
          c.set('user', { name: 'Bob', roles: ['admin'] });
          return true;
        },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure/1', { method: 'DELETE' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { by: string; };
      expect(body.by).toBe('Bob');
    });
  });

  /* -------- middleware -------- */

  describe('@Middleware', () => {
    it('executes method middleware even on @Public routes', async () => {
      const app = HonoRouteBuilder.build(MwController);
      await app.fetch(makeRequest('/mw-test'));
      expect(mwLog).toEqual(['before', 'handler', 'after']);
    });
  });

  /* -------- extended HTTP methods -------- */

  describe('extended HTTP methods', () => {
    it('HEAD /extended returns 200', async () => {
      const app = HonoRouteBuilder.build(ExtendedMethodController);
      const res = await app.fetch(makeRequest('/extended', { method: 'HEAD' }));
      expect(res.status).toBe(200);
    });

    it('OPTIONS /extended returns 200', async () => {
      const app = HonoRouteBuilder.build(ExtendedMethodController);
      const res = await app.fetch(makeRequest('/extended', { method: 'OPTIONS' }));
      expect(res.status).toBe(200);
    });

    it('ALL /extended/any responds to GET', async () => {
      const app = HonoRouteBuilder.build(ExtendedMethodController);
      const res = await app.fetch(makeRequest('/extended/any'));
      expect(res.status).toBe(200);
    });

    it('ALL /extended/any responds to POST', async () => {
      const app = HonoRouteBuilder.build(ExtendedMethodController);
      const res = await app.fetch(makeRequest('/extended/any', { method: 'POST' }));
      expect(res.status).toBe(200);
    });
  });

  /* -------- WebSocket -------- */

  describe('@WebSocket', () => {
    it('throws at build() when @WebSocket present but no webSocketUpgrader', () => {
      expect(() => HonoRouteBuilder.build(WsController)).toThrow(/webSocketUpgrader/);
    });

    it('error message includes the route label', () => {
      expect(() => HonoRouteBuilder.build(WsController)).toThrow(/GET \/ws-test/);
    });

    it('does NOT throw when webSocketUpgrader is configured', () => {
      HonoRouteBuilder.configure({
        webSocketUpgrader: (factory) => async (c, next) => { await factory(c); await next(); },
      });
      expect(() => HonoRouteBuilder.build(WsController)).not.toThrow();
    });
  });

  /* -------- onError -------- */

  describe('onError', () => {
    it('calls onError when handler throws a non-validation error', async () => {
      @Controller('/err-test')
      class ErrController {
        @Get() @Public()
        boom() { throw new Error('something went wrong'); }
      }

      HonoRouteBuilder.configure({
        onError: (_err, c) => c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500),
      });

      const app = HonoRouteBuilder.build(ErrController);
      const res = await app.fetch(makeRequest('/err-test'));
      expect(res.status).toBe(500);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('onError receives the thrown error instance', async () => {
      @Controller('/err-capture')
      class ErrCaptureController {
        @Get() @Public()
        boom() { throw new TypeError('bad type'); }
      }

      let captured: unknown;
      HonoRouteBuilder.configure({
        onError: (err, c) => { captured = err; return c.json({}, 500); },
      });

      const app = HonoRouteBuilder.build(ErrCaptureController);
      await app.fetch(makeRequest('/err-capture'));
      expect(captured).toBeInstanceOf(TypeError);
      expect((captured as TypeError).message).toBe('bad type');
    });

    it('Zod validation errors return 400 even when onError is configured', async () => {
      HonoRouteBuilder.configure({
        onError: (_err, c) => c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500),
      });
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }));
      expect(res.status).toBe(400);
    });
  });

  /* -------- @Patch -------- */

  describe('@Patch', () => {
    it('PATCH /:id updates and returns item', async () => {
      const app = HonoRouteBuilder.build(PatchController);
      const res = await app.fetch(makeRequest('/patch-test/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mango' }),
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; name: string; };
      expect(body.id).toBe('1');
      expect(body.name).toBe('Mango');
    });

    it('PATCH returns 400 when body fails Zod validation', async () => {
      const app = HonoRouteBuilder.build(PatchController);
      const res = await app.fetch(makeRequest('/patch-test/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  /* -------- query with Zod schema -------- */

  describe('query with Zod schema', () => {
    it('passes valid query params through schema', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test?search=hello&limit=5'));
      expect(res.status).toBe(200);
      const body = await res.json() as { search: string; limit: number; };
      expect(body.search).toBe('hello');
      expect(body.limit).toBe(5);
    });

    it('returns 400 when query fails Zod validation', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test?limit=notanumber'));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('optional fields are null when omitted', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test'));
      expect(res.status).toBe(200);
      const body = await res.json() as { search: null; limit: null; };
      expect(body.search).toBeNull();
      expect(body.limit).toBeNull();
    });
  });

  /* -------- platform filter -------- */

  describe('platform filter', () => {
    it('web platform routes respond under /web/v1/', async () => {
      const app = HonoRouteBuilder.build(WebController);
      const res = await app.fetch(makeRequest('/web/v1/platform-test'));
      expect(res.status).toBe(200);
      const body = await res.json() as { platform: string; };
      expect(body.platform).toBe('web');
    });

    it('mobile platform routes respond under /mobile/v1/', async () => {
      const app = HonoRouteBuilder.build(MobileController);
      const res = await app.fetch(makeRequest('/mobile/v1/platform-test'));
      expect(res.status).toBe(200);
      const body = await res.json() as { platform: string; };
      expect(body.platform).toBe('mobile');
    });
  });

  /* -------- @Public does not skip class middleware -------- */

  describe('@Public + class @Middleware', () => {
    const classLog: string[] = [];
    const classMw = async (_c: Context, next: Next) => {
      classLog.push('class-mw');
      await next();
    };

    @Controller('/public-mw')
    @Middleware(classMw)
    class PublicWithClassMwController {
      @Get() @Public()
      handle() { return { ok: true }; }
    }

    beforeEach(() => { classLog.length = 0; });

    it('class middleware still runs on @Public routes', async () => {
      const app = HonoRouteBuilder.build(PublicWithClassMwController);
      await app.fetch(makeRequest('/public-mw'));
      expect(classLog).toContain('class-mw');
    });
  });

  /* -------- @Use alias -------- */

  describe('@Use alias', () => {
    const useLog: string[] = [];
    const useMw = async (_c: Context, next: Next) => {
      useLog.push('use-mw');
      await next();
    };

    @Controller('/use-test')
    class UseController {
      @Get() @Public() @Use(useMw)
      handle() { return { ok: true }; }
    }

    beforeEach(() => { useLog.length = 0; });

    it('@Use behaves identically to @Middleware', async () => {
      const app = HonoRouteBuilder.build(UseController);
      await app.fetch(makeRequest('/use-test'));
      expect(useLog).toContain('use-mw');
    });
  });

  /* -------- fromModules -------- */

  describe('fromModules', () => {
    it('extracts @Controller classes from module map', () => {
      @Controller('/mod-a')
      class ModAController { @Get() @Public() list() { return []; } }

      class NotAController { }

      const modules = {
        './mod-a.ts': { ModAController, NotAController, someValue: 42 },
      } as Record<string, Record<string, unknown>>;

      const controllers = fromModules(modules);
      expect(controllers).toContain(ModAController);
      expect(controllers).not.toContain(NotAController);
      expect(controllers.length).toBe(1);
    });

    it('collects controllers from multiple modules', () => {
      @Controller('/mod-b') class ModBController { @Get() @Public() list() { return []; } }
      @Controller('/mod-c') class ModCController { @Get() @Public() list() { return []; } }

      const modules = {
        './mod-b.ts': { ModBController },
        './mod-c.ts': { ModCController },
      } as Record<string, Record<string, unknown>>;

      const controllers = fromModules(modules);
      expect(controllers).toContain(ModBController);
      expect(controllers).toContain(ModCController);
    });

    it('returns empty array when no @Controller classes found', () => {
      const modules = {
        './plain.ts': { PlainClass: class PlainClass { }, value: 123 },
      } as Record<string, Record<string, unknown>>;
      expect(fromModules(modules)).toHaveLength(0);
    });
  });

  /* -------- misc -------- */

  describe('response', () => {
    it('returns 200 with null body when handler returns undefined', async () => {
      const app = HonoRouteBuilder.build(VoidController);
      const res = await app.fetch(makeRequest('/void-test'));
      expect(res.status).toBe(200);
    });

    it('passes through a Response returned by the handler (c.json)', async () => {
      @Controller('/resp-test')
      class RespController {
        @Get('/json') @Public()
        json(c: Context) { return c.json({ ok: true }); }
      }
      const app = HonoRouteBuilder.build(RespController);
      const res = await app.fetch(makeRequest('/resp-test/json'));
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; };
      expect(body.ok).toBe(true);
    });

    it('passes through c.redirect', async () => {
      @Controller('/resp-test')
      class RespController {
        @Get('/redir') @Public()
        redir(c: Context) { return c.redirect('/resp-test/other'); }
        @Get('/other') @Public()
        other() { return { ok: true }; }
      }
      const app = HonoRouteBuilder.build(RespController);
      const res = await app.fetch(makeRequest('/resp-test/redir'));
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/resp-test/other');
    });

    it('passes through a raw Response object', async () => {
      @Controller('/resp-test')
      class RespController {
        @Get('/raw') @Public()
        raw() { return new Response('plain', { status: 201, headers: { 'Content-Type': 'text/plain' } }); }
      }
      const app = HonoRouteBuilder.build(RespController);
      const res = await app.fetch(makeRequest('/resp-test/raw'));
      expect(res.status).toBe(201);
      expect(await res.text()).toBe('plain');
    });
  });

  /* -------- @RequestScoped injection -------- */

  describe('@RequestScoped injection', () => {
    it('injects a fresh request-scoped dep into a singleton controller per request', async () => {
      @Injectable()
      @RequestScoped()
      class ReqDep { readonly id = crypto.randomUUID(); }

      @Controller('/req-dep')
      @Injectable([ReqDep])
      class ReqDepController {
        constructor(private dep: ReqDep) {}
        @Get() @Public()
        get() { return { id: this.dep.id }; }
      }

      const app = HonoRouteBuilder.build(ReqDepController);
      const r1 = await app.fetch(makeRequest('/req-dep'));
      const r2 = await app.fetch(makeRequest('/req-dep'));
      const b1 = await r1.json() as { id: string; };
      const b2 = await r2.json() as { id: string; };
      expect(b1.id).not.toBe(b2.id);
    });

    it('shares the same request-scoped instance within one request', async () => {
      @Injectable()
      @RequestScoped()
      class ReqDep { readonly id = crypto.randomUUID(); }

      @Controller('/req-dep')
      @Injectable([ReqDep])
      class ReqDepController {
        constructor(private dep: ReqDep) {}
        @Get() @Public()
        get() { return { a: this.dep.id, b: this.dep.id, same: this.dep === this.dep }; }
      }

      const app = HonoRouteBuilder.build(ReqDepController);
      const body = await (await app.fetch(makeRequest('/req-dep'))).json() as { a: string; b: string; same: boolean; };
      expect(body.a).toBe(body.b);
      expect(body.same).toBe(true);
    });

    it('supports a @RequestScoped controller class', async () => {
      @Controller('/req-ctrl')
      @Injectable()
      @RequestScoped()
      class ReqController {
        readonly id = crypto.randomUUID();
        @Get() @Public()
        get() { return { id: this.id }; }
      }

      const app = HonoRouteBuilder.build(ReqController);
      const b1 = await (await app.fetch(makeRequest('/req-ctrl'))).json() as { id: string; };
      const b2 = await (await app.fetch(makeRequest('/req-ctrl'))).json() as { id: string; };
      expect(b1.id).not.toBe(b2.id);
    });

    it('destroys request-scoped deps at end of request', async () => {
      const destroyed: string[] = [];
      @Injectable()
      @RequestScoped()
      class ReqDep {
        readonly id = crypto.randomUUID();
        onDestroy() { destroyed.push(this.id); }
      }

      @Controller('/req-dep')
      @Injectable([ReqDep])
      class ReqDepController {
        constructor(private dep: ReqDep) {}
        @Get() @Public()
        get() { return { id: this.dep.id }; }
      }

      const app = HonoRouteBuilder.build(ReqDepController);
      const body = await (await app.fetch(makeRequest('/req-dep'))).json() as { id: string; };
      expect(destroyed).toEqual([body.id]);
    });
  });

  /* -------- malformed input -------- */

  describe('malformed input', () => {
    it('returns 400 (not 500) for invalid JSON in Body()', async () => {
      @Controller('/body-test')
      class BodyController {
        @Post() @Public()
        async create(c: Context) { return { body: await Body(c) }; }
      }
      const app = HonoRouteBuilder.build(BodyController);
      const res = await app.fetch(makeRequest('/body-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json',
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string; }; };
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('handles malformed cookie encoding without crashing', async () => {
      @Controller('/cookie-test')
      class CookieController {
        @Get() @Public()
        read(c: Context) { return { session: Cookie(c, 'session'), flag: Cookies(c)['flag'] }; }
      }
      const app = HonoRouteBuilder.build(CookieController);
      const res = await app.fetch(makeRequest('/cookie-test', {
        headers: { cookie: 'session=%ZZ; plain=1; flag' },
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as { session: string; flag: string; };
      expect(body.session).toBe('%ZZ');
      expect(body.flag).toBe('');
    });
  });

  /* -------- @Cache -------- */

  describe('@Cache', () => {
    it('serves the second request from cache without re-invoking the handler', async () => {
      let calls = 0;
      @Controller('/cache-test')
      class CacheController {
        @Get() @Public() @Cache({ ttl: 60_000 })
        list() { calls++; return { n: calls }; }
      }
      const app = HonoRouteBuilder.build(CacheController);
      const b1 = await (await app.fetch(makeRequest('/cache-test'))).json() as { n: number; };
      const b2 = await (await app.fetch(makeRequest('/cache-test'))).json() as { n: number; };
      expect(b1.n).toBe(1);
      expect(b2.n).toBe(1);
      expect(calls).toBe(1);
    });

    it('does not share cache across different path params or queries', async () => {
      let calls = 0;
      @Controller('/cache-item')
      class CacheItemController {
        @Get('/:id') @Public() @Cache({ ttl: 60_000 })
        get(c: Context) { calls++; return { id: Param(c, 'id'), n: calls }; }
      }
      const app = HonoRouteBuilder.build(CacheItemController);
      const a = await (await app.fetch(makeRequest('/cache-item/1'))).json() as { n: number; };
      const b = await (await app.fetch(makeRequest('/cache-item/2'))).json() as { n: number; };
      expect(a.n).toBe(1);
      expect(b.n).toBe(2);
    });

    it('expires entries after ttl', async () => {
      let calls = 0;
      @Controller('/cache-ttl')
      class CacheTtlController {
        @Get() @Public() @Cache({ ttl: 30 })
        list() { calls++; return { n: calls }; }
      }
      const app = HonoRouteBuilder.build(CacheTtlController);
      await app.fetch(makeRequest('/cache-ttl'));
      await new Promise(r => setTimeout(r, 60));
      await app.fetch(makeRequest('/cache-ttl'));
      expect(calls).toBe(2);
    });
  });

  /* -------- HttpException -------- */

  describe('HttpException', () => {
    it('returns structured JSON at the correct status', async () => {
      @Controller('/exc-test')
      class ExcController {
        @Get() @Public()
        boom() { throw HttpException.notFound('Item not found'); }
      }
      const app = HonoRouteBuilder.build(ExcController);
      const res = await app.fetch(makeRequest('/exc-test'));
      expect(res.status).toBe(404);
      const body = await res.json() as { error: { code: string; message: string; }; };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Item not found');
    });
  });
});

/* ================= COMMON MIDDLEWARE DECORATORS ================= */

describe('common middleware decorators', () => {
  describe('@Cors', () => {
    it('sets Access-Control-Allow-Origin header (class-level)', async () => {
      @Controller('/cors-test')
      @Cors({ origin: 'https://example.com' })
      class CorsController {
        @Get() @Public() list() { return { ok: true }; }
      }
      const app = HonoRouteBuilder.build(CorsController);
      const res = await app.fetch(makeRequest('/cors-test', { headers: { Origin: 'https://example.com' } }));
      expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    });

    it('sets wildcard CORS header (method-level)', async () => {
      @Controller('/cors-method')
      class CorsMethodController {
        @Get() @Public() @Cors({ origin: '*' }) list() { return { ok: true }; }
      }
      const app = HonoRouteBuilder.build(CorsMethodController);
      const res = await app.fetch(makeRequest('/cors-method', { headers: { Origin: 'https://any.com' } }));
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('@Compress', () => {
    it('registers compress middleware without error', async () => {
      @Controller('/compress-test')
      @Compress()
      class CompressController {
        @Get() @Public() data() { return { compressed: true }; }
      }
      const app = HonoRouteBuilder.build(CompressController);
      const res = await app.fetch(makeRequest('/compress-test'));
      expect(res.status).toBe(200);
    });
  });

  describe('@SecureHeaders', () => {
    it('sets X-Content-Type-Options header', async () => {
      @Controller('/secure-headers-test')
      @SecureHeaders()
      class SecureHeadersController {
        @Get() @Public() info() { return { secure: true }; }
      }
      const app = HonoRouteBuilder.build(SecureHeadersController);
      const res = await app.fetch(makeRequest('/secure-headers-test'));
      expect(res.headers.get('x-content-type-options')).toBeTruthy();
    });
  });

  describe('@PrettyJson', () => {
    it('formats JSON when ?pretty is present', async () => {
      @Controller('/pretty-test')
      @PrettyJson()
      class PrettyController {
        @Get() @Public() data() { return { hello: 'world' }; }
      }
      const app = HonoRouteBuilder.build(PrettyController);
      const res = await app.fetch(makeRequest('/pretty-test?pretty'));
      const text = await res.text();
      expect(text).toContain('\n');
    });
  });
});

/* ================= TRACE ID ================= */

describe('trace ID', () => {
  it('echoes X-Request-ID back in response header', async () => {
    @Controller('/trace-test')
    class TraceController {
      @Get() @Public()
      check() { return { traceId: getTraceId() }; }
    }
    const app = HonoRouteBuilder.build(TraceController);
    const res = await app.fetch(makeRequest('/trace-test', { headers: { 'x-request-id': 'abc-123' } }));
    expect(res.headers.get('x-request-id')).toBe('abc-123');
  });

  it('generates a UUID trace ID when X-Request-ID is absent', async () => {
    @Controller('/trace-gen')
    class TraceGenController {
      @Get() @Public()
      check() { return { ok: true }; }
    }
    const app = HonoRouteBuilder.build(TraceGenController);
    const res = await app.fetch(makeRequest('/trace-gen'));
    const traceId = res.headers.get('x-request-id');
    expect(traceId).toBeTruthy();
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/* ================= @Private ================= */

describe('@Private', () => {
  @Controller('/priv')
  class PrivController {
    @Get('/open') @Public() open() { return { v: 'open' }; }
    @Get('/secret') @Private() secret() { return { v: 'secret' }; }
  }

  it('hidden route is accessible without excludePrivate', async () => {
    const app = HonoRouteBuilder.build(PrivController);
    const res = await app.fetch(makeRequest('/priv/secret'));
    expect(res.status).toBe(200);
  });

  it('hidden route is excluded when excludePrivate: true', async () => {
    const app = HonoRouteBuilder.build(PrivController, undefined, { excludePrivate: true });
    const res = await app.fetch(makeRequest('/priv/secret'));
    expect(res.status).toBe(404);
  });

  it('non-private route is always accessible', async () => {
    const app = HonoRouteBuilder.build(PrivController, undefined, { excludePrivate: true });
    const res = await app.fetch(makeRequest('/priv/open'));
    expect(res.status).toBe(200);
  });
});
