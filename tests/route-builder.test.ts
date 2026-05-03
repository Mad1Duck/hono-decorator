import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Controller,
  Get,
  Post,
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
  HonoRouteBuilder,
  container,
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

  /* -------- misc -------- */

  describe('response', () => {
    it('returns 200 with null body when handler returns undefined', async () => {
      const app = HonoRouteBuilder.build(VoidController);
      const res = await app.fetch(makeRequest('/void-test'));
      expect(res.status).toBe(200);
    });
  });
});
