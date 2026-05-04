import 'reflect-metadata';
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
  Body,
  Param,
  Query,
  User,
  Injectable,
  Singleton,
  RequireAuth,
  RequireRole,
  Public,
  RateLimit,
  Middleware,
  Use,
  Cors,
  Compress,
  SecureHeaders,
  PrettyJson,
  UploadedFile,
  UploadedFiles,
  FormBody,
  HonoRouteBuilder,
  container,
  fromModules,
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

@Injectable()
class ItemService {
  constructor(private store: ItemStore) {}
  getAll() { return this.store.getAll(); }
  getById(id: string) { return this.store.getById(id); }
  create(name: string) { return this.store.create(name); }
}

/* -------- controllers -------- */

const CreateItemSchema = z.object({ name: z.string().min(1) });

// NOTE: @Get('/search') must be registered BEFORE @Get('/:id')
// so Hono matches static paths before dynamic ones
@Controller('/items')
class ItemController {
  constructor(private svc: ItemService) {}

  @Get()
  @Public()
  list() { return this.svc.getAll(); }

  @Get('/search')
  @Public()
  search(@Query() q: Record<string, string>) { return { query: q }; }

  @Get('/:id')
  @Public()
  getOne(@Param('id') id: string) { return this.svc.getById(id); }

  @Post()
  @Public()
  create(@Body(CreateItemSchema) body: z.infer<typeof CreateItemSchema>) {
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
  adminDelete(@Param('id') id: string, @User() user: { name: string }) {
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
    return { onMessage: (_e: unknown, _ws: unknown) => {} };
  }
}

const PatchItemSchema = z.object({ name: z.string().min(1) });
const QueryFilterSchema = z.object({ search: z.string().optional(), limit: z.coerce.number().optional() });

@Controller('/patch-test')
class PatchController {
  private items: Record<string, string> = { '1': 'Apple', '2': 'Banana' };

  @Patch('/:id')
  @Public()
  update(@Param('id') id: string, @Body(PatchItemSchema) body: z.infer<typeof PatchItemSchema>) {
    this.items[id] = body.name;
    return { id, name: body.name };
  }
}

@Controller('/qschema-test')
class QuerySchemaController {
  @Get()
  @Public()
  list(@Query(QueryFilterSchema) q: z.infer<typeof QueryFilterSchema>) {
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
      HonoRouteBuilder.configure({
        rateLimiterFactory: () => async (_c, next) => next(),
      });
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
      const body = await res.json() as { id: string };
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
      const body = await res.json() as { name: string };
      expect(body.name).toBe('Cherry');
    });
  });

  /* -------- parameter injection -------- */

  describe('parameter injection', () => {
    it('@Param resolves route parameter', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items/2'));
      const body = await res.json() as { id: string };
      expect(body.id).toBe('2');
    });

    it('@Query resolves query string', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items/search?name=apple&page=1'));
      expect(res.status).toBe(200);
      const body = await res.json() as { query: Record<string, string> };
      expect(body.query['name']).toBe('apple');
      expect(body.query['page']).toBe('1');
    });

    it('@Body with Zod returns 400 on invalid payload', async () => {
      const app = HonoRouteBuilder.build(ItemController);
      const res = await app.fetch(makeRequest('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
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
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when guardExecutor throws Forbidden', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async () => { throw new Error('Forbidden: Insufficient role'); },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 when guardExecutor returns false', async () => {
      HonoRouteBuilder.configure({ guardExecutor: async () => false });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(403);
    });

    it('allows request when guardExecutor returns true', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async (c) => {
          c.set('user', { name: 'Alice', roles: ['admin'] });
          return true;
        },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure'));
      expect(res.status).toBe(200);
    });

    it('@User injects user set by guardExecutor', async () => {
      HonoRouteBuilder.configure({
        guardExecutor: async (c) => {
          c.set('user', { name: 'Bob', roles: ['admin'] });
          return true;
        },
      });
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure/1', { method: 'DELETE' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { by: string };
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
        webSocketUpgrader: (factory) => async (c, next) => {
          await factory(c);
          await next();
        },
      });
      expect(() => HonoRouteBuilder.build(WsController)).not.toThrow();
    });
  });

  /* -------- onError -------- */

  describe('onError', () => {
    it('calls onError when handler throws a non-validation error', async () => {
      @Controller('/err-test')
      class ErrController {
        @Get()
        @Public()
        boom() { throw new Error('something went wrong'); }
      }

      HonoRouteBuilder.configure({
        onError: (_err, c) => c.json({ error: { code: 'INTERNAL_SERVER_ERROR' } }, 500),
      });

      const app = HonoRouteBuilder.build(ErrController);
      const res = await app.fetch(makeRequest('/err-test'));
      expect(res.status).toBe(500);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('onError receives the thrown error instance', async () => {
      @Controller('/err-capture')
      class ErrCaptureController {
        @Get()
        @Public()
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

    it('validation errors still return 400 even when onError is configured', async () => {
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
      const body = await res.json() as { id: string; name: string };
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
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  /* -------- @Query with Zod schema -------- */

  describe('@Query with Zod schema', () => {
    it('passes valid query params through schema', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test?search=hello&limit=5'));
      expect(res.status).toBe(200);
      const body = await res.json() as { search: string; limit: number };
      expect(body.search).toBe('hello');
      expect(body.limit).toBe(5);
    });

    it('returns 400 when query fails Zod validation', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test?limit=notanumber'));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('optional fields are null when omitted', async () => {
      const app = HonoRouteBuilder.build(QuerySchemaController);
      const res = await app.fetch(makeRequest('/qschema-test'));
      expect(res.status).toBe(200);
      const body = await res.json() as { search: null; limit: null };
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
      const body = await res.json() as { platform: string };
      expect(body.platform).toBe('web');
    });

    it('mobile platform routes respond under /mobile/v1/', async () => {
      const app = HonoRouteBuilder.build(MobileController);
      const res = await app.fetch(makeRequest('/mobile/v1/platform-test'));
      expect(res.status).toBe(200);
      const body = await res.json() as { platform: string };
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
      @Get()
      @Public()
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
      @Get()
      @Public()
      @Use(useMw)
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

      class NotAController {}

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
        './plain.ts': { PlainClass: class PlainClass {}, value: 123 },
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
      @Controller('/secure-test')
      @SecureHeaders()
      class SecureController {
        @Get() @Public() info() { return { secure: true }; }
      }
      const app = HonoRouteBuilder.build(SecureController);
      const res = await app.fetch(makeRequest('/secure-test'));
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
  });

  describe('@PrettyJson', () => {
    it('pretty-prints JSON when ?pretty query present', async () => {
      @Controller('/pretty-test')
      @PrettyJson()
      class PrettyController {
        @Get() @Public() data() { return { key: 'value' }; }
      }
      const app = HonoRouteBuilder.build(PrettyController);
      const res = await app.fetch(makeRequest('/pretty-test?pretty'));
      const text = await res.text();
      expect(text).toContain('\n');
    });
  });
});

/* ================= FILE UPLOAD ================= */

describe('file upload decorators', () => {
  function makeMultipart(path: string, fields: Record<string, string | { name: string; content: string; type?: string }>) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string') {
        form.append(key, value);
      } else {
        form.append(key, new File([value.content], value.name, { type: value.type ?? 'text/plain' }));
      }
    }
    return new Request(`http://test.local${path}`, { method: 'POST', body: form });
  }

  describe('@UploadedFile', () => {
    it('injects a single File by field name', async () => {
      @Controller('/upload')
      class UploadCtrl {
        @Post() @Public()
        upload(@UploadedFile('avatar') file: File | null) {
          return { name: (file as File).name, size: (file as File).size };
        }
      }
      const app = HonoRouteBuilder.build(UploadCtrl);
      const res = await app.fetch(makeMultipart('/upload', { avatar: { name: 'pic.png', content: 'abc', type: 'image/png' } }));
      const body = await res.json() as { name: string; size: number };
      expect(body.name).toBe('pic.png');
      expect(body.size).toBe(3);
    });

    it('returns null when the field is missing', async () => {
      @Controller('/upload-null')
      class UploadNullCtrl {
        @Post() @Public()
        upload(@UploadedFile('missing') file: File | null) {
          return { isNull: file === null };
        }
      }
      const app = HonoRouteBuilder.build(UploadNullCtrl);
      const res = await app.fetch(makeMultipart('/upload-null', { other: 'value' }));
      const body = await res.json() as { isNull: boolean };
      expect(body.isNull).toBe(true);
    });
  });

  describe('@UploadedFiles', () => {
    it('injects all files for a given field name', async () => {
      @Controller('/upload-multi')
      class MultiCtrl {
        @Post() @Public()
        upload(@UploadedFiles('photos') files: File[]) {
          return { count: files.length, names: files.map(f => f.name) };
        }
      }
      const app = HonoRouteBuilder.build(MultiCtrl);
      const form = new FormData();
      form.append('photos', new File(['a'], 'a.png', { type: 'image/png' }));
      form.append('photos', new File(['bb'], 'b.png', { type: 'image/png' }));
      const res = await app.fetch(new Request('http://test.local/upload-multi', { method: 'POST', body: form }));
      const body = await res.json() as { count: number; names: string[] };
      expect(body.count).toBe(2);
      expect(body.names).toContain('a.png');
    });

    it('injects all files across all fields when no fieldName given', async () => {
      @Controller('/upload-all')
      class AllCtrl {
        @Post() @Public()
        upload(@UploadedFiles() files: File[]) {
          return { count: files.length };
        }
      }
      const app = HonoRouteBuilder.build(AllCtrl);
      const form = new FormData();
      form.append('doc', new File(['x'], 'doc.pdf'));
      form.append('img', new File(['y'], 'img.jpg'));
      form.append('name', 'text-field');
      const res = await app.fetch(new Request('http://test.local/upload-all', { method: 'POST', body: form }));
      const body = await res.json() as { count: number };
      expect(body.count).toBe(2);
    });
  });

  describe('@FormBody', () => {
    it('injects the raw FormData object', async () => {
      @Controller('/form')
      class FormCtrl {
        @Post() @Public()
        submit(@FormBody() form: FormData) {
          return { name: form.get('name'), age: form.get('age') };
        }
      }
      const app = HonoRouteBuilder.build(FormCtrl);
      const res = await app.fetch(makeMultipart('/form', { name: 'Alice', age: '30' }));
      const body = await res.json() as { name: string; age: string };
      expect(body.name).toBe('Alice');
      expect(body.age).toBe('30');
    });

    it('formData is parsed once even when multiple file params exist', async () => {
      @Controller('/form-multi-param')
      class MultiParamCtrl {
        @Post() @Public()
        submit(@UploadedFile('doc') file: File | null, @FormBody() form: FormData) {
          return { fileName: (file as File).name, field: form.get('note') };
        }
      }
      const app = HonoRouteBuilder.build(MultiParamCtrl);
      const form = new FormData();
      form.append('doc', new File(['hello'], 'report.pdf'));
      form.append('note', 'important');
      const res = await app.fetch(new Request('http://test.local/form-multi-param', { method: 'POST', body: form }));
      const body = await res.json() as { fileName: string; field: string };
      expect(body.fileName).toBe('report.pdf');
      expect(body.field).toBe('important');
    });
  });
});
