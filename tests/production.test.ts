import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  CacheControl,
  ChannelRegistry,
  Concurrency,
  Controller,
  Cron,
  ETag,
  Get,
  HonoRouteBuilder,
  InMemoryChannelAdapter,
  Injectable,
  Module,
  mountDrain,
  mountHealth,
  mountMetrics,
  getMetricsRegistry,
  getRequestDrain,
  OnBootstrap,
  OnWsMessage,
  Public,
  RateLimit,
  registerLogger,
  Singleton,
  Throttle,
  WebSocket,
  redisRateLimiter,
  parseCron,
  nextCronTime,
  startScheduler,
} from '../src';
import type { ChannelClient, RedisRateLimitClient } from '../src';
import { HttpException, Post, Validate } from '../src';
import { z } from 'zod';

const makeRequest = (path: string, init?: RequestInit): Request =>
  new Request(`http://test.local${path}`, init);

/* ================= RETRY-AFTER ================= */

describe('Retry-After on 429', () => {
  it('@RateLimit emits Retry-After header (seconds)', async () => {
    @Controller('/rl')
    @Injectable()
    class RlController {
      @Get() @Public() @RateLimit({ max: 1, windowMs: 60_000 })
      hit() { return { ok: true }; }
    }
    const app = HonoRouteBuilder.build(RlController);
    const first = await app.fetch(makeRequest('/rl'));
    expect(first.status).toBe(200);
    const second = await app.fetch(makeRequest('/rl'));
    expect(second.status).toBe(429);
    const retryAfter = second.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it('redisRateLimiter emits Retry-After from PTTL', async () => {
    const store = new Map<string, { count: number; expiresAt: number }>();
    const fakeRedis: RedisRateLimitClient = {
      incr: async (k) => {
        const e = store.get(k) ?? { count: 0, expiresAt: 0 };
        e.count += 1;
        store.set(k, e);
        return e.count;
      },
      pexpire: async (k, ms) => { store.get(k)!.expiresAt = Date.now() + ms; },
      pttl: async (k) => Math.max(0, (store.get(k)?.expiresAt ?? 0) - Date.now()),
    };
    HonoRouteBuilder.configure({ rateLimiterFactory: redisRateLimiter(fakeRedis) });
    try {
      @Controller('/rlr')
      @Injectable()
      class RlRedisController {
        @Get() @Public() @RateLimit({ max: 1, windowMs: 30_000 })
        hit() { return { ok: true }; }
      }
      const app = HonoRouteBuilder.build(RlRedisController);
      await app.fetch(makeRequest('/rlr'));
      const second = await app.fetch(makeRequest('/rlr'));
      expect(second.status).toBe(429);
      expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(Number(second.headers.get('Retry-After'))).toBeLessThanOrEqual(30);
    } finally {
      HonoRouteBuilder.configure({ rateLimiterFactory: undefined });
    }
  });

  it('@Throttle on a singleton controller emits Retry-After', async () => {
    @Controller('/thr')
    @Injectable()
    @Singleton()
    class ThrottledController {
      @Get() @Public() @Throttle(60_000)
      hit() { return { ok: true }; }
    }
    const app = HonoRouteBuilder.build(ThrottledController);
    await app.fetch(makeRequest('/thr'));
    const second = await app.fetch(makeRequest('/thr'));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

/* ================= LIVENESS / READINESS ================= */

describe('mountHealth probes', () => {
  it('probes: /live is 200 without checks, /ready reflects dependencies', async () => {
    const app = new Hono();
    let dbUp = true;
    mountHealth(app, {
      probes: true,
      checks: { db: () => dbUp },
    });

    expect((await app.fetch(makeRequest('/health/live'))).status).toBe(200);
    expect((await app.fetch(makeRequest('/health/ready'))).status).toBe(200);

    dbUp = false;
    // Liveness stays 200 — a dead dependency must not trigger pod restart.
    expect((await app.fetch(makeRequest('/health/live'))).status).toBe(200);
    expect((await app.fetch(makeRequest('/health/ready'))).status).toBe(503);
    // Backward-compat base endpoint also reflects the failure.
    expect((await app.fetch(makeRequest('/health'))).status).toBe(503);
  });

  it('liveChecks gate /live independently', async () => {
    const app = new Hono();
    mountHealth(app, {
      probes: true,
      checks: { db: () => true },
      liveChecks: { deadlockDetector: () => false },
    });
    expect((await app.fetch(makeRequest('/health/live'))).status).toBe(503);
    expect((await app.fetch(makeRequest('/health/ready'))).status).toBe(200);
  });
});

/* ================= GRACEFUL DRAIN ================= */

describe('channel drain', () => {
  it('close() closes every client transport then clears the map', async () => {
    const registry = new ChannelRegistry();
    const adapter = new InMemoryChannelAdapter();
    registry.use(adapter);

    const closed: string[] = [];
    const fakeWs = (id: string): ChannelClient => ({
      id,
      send: async () => {},
      isAlive: () => true,
      close: () => { closed.push(id); },
    });
    await registry.subscribe('room:a', fakeWs('c1'));
    await registry.subscribe('room:a', fakeWs('c2'));
    await registry.subscribe('room:b', fakeWs('c3'));

    await registry.close();
    expect(closed.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(adapter.subscriberCount('room:a')).toBe(0);
    expect(adapter.subscriberCount('room:b')).toBe(0);
  });
});

/* ================= CRON ================= */

describe('cron parser', () => {
  it('parses wildcards, steps, ranges, and lists', () => {
    const c = parseCron('*/15 9-17 1,15 * 1-5');
    expect(c.minutes.has(0)).toBe(true);
    expect(c.minutes.has(30)).toBe(true);
    expect(c.minutes.has(7)).toBe(false);
    expect(c.hours.has(9)).toBe(true);
    expect(c.hours.has(18)).toBe(false);
    expect(c.dom.has(1)).toBe(true);
    expect(c.dom.has(15)).toBe(true);
    expect(c.dom.has(2)).toBe(false);
    expect(c.dow.has(1)).toBe(true);
    expect(c.dow.has(6)).toBe(false);
  });

  it('throws on malformed expressions', () => {
    expect(() => parseCron('0 2 *')).toThrow();
    expect(() => parseCron('99 * * * *')).toThrow();
    expect(() => parseCron('*/0 * * * *')).toThrow();
  });

  it('nextCronTime: daily 02:00 rolls to next day', () => {
    const from = new Date(2026, 0, 10, 3, 0); // Jan 10 03:00 local
    const next = nextCronTime('0 2 * * *', from);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(11);
  });

  it('nextCronTime: weekday-only skips weekends', () => {
    // Jan 10 2026 is a Saturday.
    const from = new Date(2026, 0, 10, 10, 0);
    const next = nextCronTime('0 9 * * 1-5', from);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
  });

  it('nextCronTime: OR semantics when dom and dow both restricted', () => {
    // From Jan 14: Jan 15 is a Thursday — dom=15 matches even though dow=1 doesn't.
    // (From Jan 10, Monday Jan 12 would fire first via dow — either match fires.)
    const from = new Date(2026, 0, 14, 0, 0);
    const next = nextCronTime('0 0 15 * 1', from);
    expect(next.getDate()).toBe(15);
    expect(next.getDay()).toBe(4);
  });
});

describe('@Cron scheduling', () => {
  it('registers and tears down without throwing', async () => {
    let ran = 0;
    @Injectable()
    class Jobs {
      @Cron('0 2 * * *')
      nightly() { ran++; }
    }
    const teardown = startScheduler(Jobs);
    teardown();
    expect(ran).toBe(0); // next fire is minutes away — just verifying no crash
  });

  it('invalid expression logs and skips instead of crashing', () => {
    @Injectable()
    class BadJobs {
      @Cron('not a cron')
      broken() {}
    }
    const teardown = startScheduler(BadJobs); // must not throw
    teardown();
  });
});

/* ================= METRICS ================= */

describe('mountMetrics', () => {
  it('collects request counters + histogram and exposes Prometheus text', async () => {
    getMetricsRegistry().reset();
    const app = new Hono();
    mountMetrics(app);
    app.get('/t', (c) => c.json({ ok: true }));
    app.get('/boom', (c) => c.json({ err: 1 }, 500));

    await app.fetch(makeRequest('/t'));
    await app.fetch(makeRequest('/t'));
    await app.fetch(makeRequest('/boom'));

    const res = await app.fetch(makeRequest('/metrics'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();

    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toMatch(/http_requests_total\{method="GET",route="\/t",status="200"\} 2/);
    expect(body).toMatch(/http_requests_total\{.*status="500"\} 1/);
    expect(body).toContain('http_request_duration_seconds_bucket');
    expect(body).toContain('le="+Inf"');
    expect(body).toContain('http_request_duration_seconds_sum');
  });

  it('does not count /metrics itself and honors exclude', async () => {
    getMetricsRegistry().reset();
    const app = new Hono();
    mountMetrics(app, { exclude: ['/internal'] });
    app.get('/internal', (c) => c.text('x'));
    await app.fetch(makeRequest('/internal'));
    const body = await (await app.fetch(makeRequest('/metrics'))).text();
    expect(body).not.toContain('/internal');
    expect(body).not.toContain('/metrics');
  });
});

/* ================= ON WS MESSAGE ================= */

describe('@OnWsMessage', () => {
  it('routes JSON envelope frames to the matching sibling method', async () => {
    let captured: Record<string, (e: unknown, ws: unknown) => unknown> | undefined;
    HonoRouteBuilder.configure({
      webSocketUpgrader: (factory) => async (c: Context) => {
        captured = (await factory(c)) as Record<string, (e: unknown, ws: unknown) => unknown>;
        return c.text('upgraded');
      },
    });
    try {
      const received: Array<{ method: string; data: unknown }> = [];
      const fallback: unknown[] = [];

      @Controller('/wsm')
      @Injectable()
      @Singleton()
      class WsController {
        readonly log = received;
        readonly fb = fallback;

        @WebSocket('/sock') @Public()
        sock() {
          return { onMessage: (e: unknown) => { this.fb.push((e as { data: unknown }).data); } };
        }

        @OnWsMessage('join')
        onJoin(data: unknown) { this.log.push({ method: 'join', data }); }

        @OnWsMessage('ping')
        onPing(data: unknown) { this.log.push({ method: 'ping', data }); }
      }

      const app = HonoRouteBuilder.build(WsController);
      await app.fetch(makeRequest('/wsm/sock'));
      expect(captured?.['onMessage']).toBeDefined();

      const ws = { send: () => {}, readyState: 1 };
      await captured!['onMessage']!({ data: JSON.stringify({ event: 'join', data: { room: 'x' } }) }, ws);
      await captured!['onMessage']!({ data: JSON.stringify({ event: 'ping', data: null }) }, ws);
      await captured!['onMessage']!({ data: JSON.stringify({ event: 'unknown' }) }, ws);
      await captured!['onMessage']!({ data: 'plain text frame' }, ws);

      expect(received).toEqual([
        { method: 'join', data: { room: 'x' } },
        { method: 'ping', data: null },
      ]);
      expect(fallback).toEqual([JSON.stringify({ event: 'unknown' }), 'plain text frame']);
    } finally {
      HonoRouteBuilder.configure({ webSocketUpgrader: undefined });
    }
  });
});

/* ================= REQUEST DRAIN ================= */

describe('request drain', () => {
  it('waits for in-flight requests and 503s new ones while draining', async () => {
    const drain = getRequestDrain();
    expect(drain.activeRequests).toBe(0);

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const app = new Hono();
    mountDrain(app);
    app.get('/slow', async (c) => { await gate; return c.text('done'); });

    const pending = app.fetch(makeRequest('/slow'));
    // give the request a tick to register
    await new Promise((r) => setTimeout(r, 10));
    expect(drain.activeRequests).toBe(1);

    const drainPromise = drain.drain(5_000);
    // new requests during drain → fast 503
    const rejected = await app.fetch(makeRequest('/slow'));
    expect(rejected.status).toBe(503);

    release();
    const res = await pending;
    expect(await res.text()).toBe('done');
    await drainPromise;
    expect(drain.activeRequests).toBe(0);
  });
});

/* ================= ROUTE COLLISION ================= */

describe('route collision detection', () => {
  it('warns when two controllers bind the same method+path', async () => {
    const warnings: string[] = [];
    registerLogger({
      info: () => {},
      warn: (_d: unknown, m?: string) => { warnings.push(String(m ?? _d)); },
      error: () => {},
      debug: () => {},
    } as never);
    try {
      @Controller('/x')
      @Injectable()
      class A {
        @Get() @Public()
        a() { return 'a'; }
      }
      @Controller('/x')
      @Injectable()
      class B {
        @Get() @Public()
        b() { return 'b'; }
      }
      @Module({ controllers: [A, B] })
      class CollidingModule {}

      HonoRouteBuilder.buildModule(CollidingModule);
      expect(warnings.some((w) => w.includes('Duplicate route GET /x'))).toBe(true);
    } finally {
      registerLogger(console as never); // restore console-backed default
    }
  });
});

/* ================= ON BOOTSTRAP ================= */

describe('@OnBootstrap', () => {
  it('runs hooks after the module is built — once per class', async () => {
    const ran: string[] = [];
    @Injectable()
    @Singleton()
    class BootstrapSvc {
      @OnBootstrap()
      ready() { ran.push('svc.ready'); }
    }
    @Controller('/boot')
    @Injectable()
    class BootController {
      @OnBootstrap()
      onReady() { ran.push('ctrl.onReady'); }

      @Get() @Public()
      ping() { return 'pong'; }
    }
    @Module({ providers: [BootstrapSvc], controllers: [BootController] })
    class BootModule {}

    HonoRouteBuilder.buildModule(BootModule);
    await new Promise((r) => setTimeout(r, 20)); // hooks run detached
    expect(ran).toContain('svc.ready');
    expect(ran).toContain('ctrl.onReady');

    // idempotent — a second build does not re-run hooks
    HonoRouteBuilder.buildModule(BootModule);
    await new Promise((r) => setTimeout(r, 20));
    expect(ran.filter((x) => x === 'svc.ready')).toHaveLength(1);
  });
});

/* ================= CONCURRENCY ================= */

describe('@Concurrency', () => {
  it('rejects excess parallel requests with 503 CONCURRENCY_LIMIT', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    @Controller('/bulk')
    @Injectable()
    class BulkController {
      @Get() @Public() @Concurrency(1)
      async slow() { await gate; return { ok: true }; }
    }
    const app = HonoRouteBuilder.build(BulkController);

    const first = app.fetch(makeRequest('/bulk'));
    await new Promise((r) => setTimeout(r, 10));

    const second = await app.fetch(makeRequest('/bulk'));
    expect(second.status).toBe(503);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONCURRENCY_LIMIT');

    release();
    expect((await first).status).toBe(200);

    // slot freed — next request passes
    const third = await app.fetch(makeRequest('/bulk'));
    expect(third.status).toBe(200);
  });
});

/* ================= CLI doctor ================= */

describe('hono-forge doctor', () => {
  it('reports issues and exits non-zero on a broken module', () => {
    const proc = Bun.spawnSync(
      [process.execPath, 'src/cli.ts', 'doctor', 'tests/fixtures/broken.module.ts'],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    );
    const out = proc.stdout.toString();
    expect(proc.exitCode).toBe(1);
    expect(out).toContain("di:");
    expect(out).toContain("route:");
    expect(out).toContain("cron:");
    expect(out).toContain("schedule:");
  });

  it('passes clean on the example module', () => {
    const proc = Bun.spawnSync(
      [process.execPath, 'src/cli.ts', 'doctor', 'examples/todo-api/index.ts'],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('no issues');
  });
});

/* ================= CLI client ================= */

describe('hono-forge client', () => {
  it('generates a typed route map from the example module', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'hono-forge-client-'));
    const out = join(dir, 'routes.gen.ts');
    try {
      const proc = Bun.spawnSync(
        [process.execPath, 'src/cli.ts', 'client', 'examples/todo-api/index.ts', '--out', out],
        { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
      );
      expect(proc.exitCode).toBe(0);
      const code = await Bun.file(out).text();
      expect(code).toContain('export interface AppRoutes');
      expect(code).toContain("'GET /todos':");
      expect(code).toContain("'POST /todos':");
      expect(code).toContain('TodoController');
      // SSE route excluded — not representable in a fetch client
      expect(code).not.toContain('/feed/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shows per-command help and suggests corrections', () => {
    const help = Bun.spawnSync(
      [process.execPath, 'src/cli.ts', 'flows', '--help'],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    );
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('hono-forge flows');
    expect(help.stdout.toString()).toContain('--base-url');

    const typo = Bun.spawnSync(
      [process.execPath, 'src/cli.ts', 'clent'],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    );
    expect(typo.exitCode).toBe(1);
    expect(typo.stderr.toString()).toContain("did you mean 'client'");
  });
});

/* ================= CLI init ================= */

describe('hono-forge init', () => {
  it('scaffolds a runnable project', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'hono-forge-init-'));
    const cliPath = join(process.cwd(), 'src/cli.ts');
    try {
      const proc = Bun.spawnSync(
        [process.execPath, cliPath, 'init', 'my-api'],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe' }
      );
      expect(proc.exitCode).toBe(0);
      const appDir = join(dir, 'my-api');
      for (const f of [
        'package.json', 'tsconfig.json', 'README.md',
        'src/index.ts', 'src/app.module.ts',
        'src/hello.controller.ts', 'src/hello.service.ts',
      ]) {
        expect(await Bun.file(join(appDir, f)).exists()).toBe(true);
      }
      const pkg = await Bun.file(join(appDir, 'package.json')).json() as { name: string; dependencies: Record<string, string> };
      expect(pkg.name).toBe('my-api');
      // scaffold pins ^<current major> — derive the expectation from our own package.json
      const selfPkg = await Bun.file(join(process.cwd(), 'package.json')).json() as { version: string };
      expect(pkg.dependencies['hono-forge']).toBe(`^${selfPkg.version.split('.')[0]}.0.0`);
      const controller = await Bun.file(join(appDir, 'src/hello.controller.ts')).text();
      expect(controller).toContain('@Controller');
      expect(controller).toContain('@Validate');

      // second run fails — refuses to clobber a non-empty dir
      const again = Bun.spawnSync(
        [process.execPath, cliPath, 'init', 'my-api'],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe' }
      );
      expect(again.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/* ================= CACHE CONTROL / ETAG ================= */

describe('@CacheControl / @ETag', () => {
  @Controller('/cached')
  @Injectable()
  class CachedController {
    @Get('/opts') @Public()
    @CacheControl({ public: true, maxAge: 60, staleWhileRevalidate: 30 })
    opts() { return { v: 1 }; }

    @Get('/raw') @Public()
    @CacheControl('private, no-store')
    raw() { return { v: 2 }; }

    @Get('/tagged') @Public() @ETag()
    tagged() { return { stable: 'body' }; }

    @Get('/strong') @Public() @ETag({ weak: false })
    strong() { return { stable: 'body' }; }
  }
  const app = HonoRouteBuilder.build(CachedController);

  it('CacheControl sets header from options object', async () => {
    const res = await app.fetch(makeRequest('/cached/opts'));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=30');
  });

  it('CacheControl passes through raw strings', async () => {
    const res = await app.fetch(makeRequest('/cached/raw'));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('ETag emits a weak tag and honors If-None-Match with 304', async () => {
    const first = await app.fetch(makeRequest('/cached/tagged'));
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\/"[0-9a-f]+"$/);

    const second = await app.fetch(makeRequest('/cached/tagged', { headers: { 'If-None-Match': etag! } }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');

    const third = await app.fetch(makeRequest('/cached/tagged', { headers: { 'If-None-Match': '"stale"' } }));
    expect(third.status).toBe(200);
    expect((await third.json()) as { stable: string }).toEqual({ stable: 'body' });
  });

  it('ETag({ weak: false }) emits a strong tag', async () => {
    const res = await app.fetch(makeRequest('/cached/strong'));
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]+"$/);
  });
});

/* ================= RFC 9457 PROBLEM DETAILS ================= */

describe('errorFormat: problem (RFC 9457)', () => {
  it('HttpException renders application/problem+json', async () => {
    @Controller('/prob')
    @Injectable()
    class ProbController {
      @Get('/missing') @Public()
      missing() { throw HttpException.notFound('User 42 not found', { meta: { userId: '42' } }); }

      @Post('/echo') @Public()
      @Validate({ body: z.object({ name: z.string() }) })
      echo() { return { ok: true }; }
    }

    HonoRouteBuilder.configure({ errorFormat: 'problem' });
    try {
      const app = HonoRouteBuilder.build(ProbController);

      const res = await app.fetch(makeRequest('/prob/missing'));
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      const body = await res.json() as Record<string, unknown>;
      expect(body.type).toBe('about:blank');
      expect(body.title).toBe('Not Found');
      expect(body.status).toBe(404);
      expect(body.detail).toBe('User 42 not found');
      expect(body.instance).toBe('/prob/missing');
      expect(body.code).toBe('NOT_FOUND');
      // meta fields are spread as extension members
      expect(body.userId).toBe('42');

      // ZodError → 400 problem+json with issues as 'errors' extension
      const bad = await app.fetch(makeRequest('/prob/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 1 }),
      }));
      expect(bad.status).toBe(400);
      expect(bad.headers.get('content-type')).toContain('application/problem+json');
      const vbody = await bad.json() as Record<string, unknown>;
      expect(vbody.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(vbody.errors)).toBe(true);
    } finally {
      HonoRouteBuilder.configure({ errorFormat: 'envelope' });
    }
  });

  it('envelope stays the default', async () => {
    @Controller('/env')
    @Injectable()
    class EnvController {
      @Get() @Public()
      boom() { throw HttpException.forbidden('nope'); }
    }
    const app = HonoRouteBuilder.build(EnvController);
    const res = await app.fetch(makeRequest('/env'));
    expect(res.status).toBe(403);
    const body = await res.json() as { status: string; error: { code: string } };
    expect(body.status).toBe('error');
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
