import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import {
  mountHealth,
  gracefulShutdown,
  registerLogger,
  getLogger,
  LOGGER,
  ConsoleLogger,
  container,
  Injectable,
} from '../src';

/* ================= HEALTH CHECK ================= */

describe('mountHealth', () => {
  const req = (path: string) => new Request(`http://t.local${path}`);

  it('returns 200 ok with uptime and no checks', async () => {
    const app = new Hono();
    mountHealth(app);
    const res = await app.request(req('/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 503 with per-check details when any check fails', async () => {
    const app = new Hono();
    mountHealth(app, {
      checks: {
        db: () => true,
        redis: () => {
          throw new Error('connection refused');
        },
      },
    });
    const res = await app.request(req('/health'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe('error');
    expect(body.checks['db']!.status).toBe('up');
    expect(body.checks['redis']!.status).toBe('down');
  });

  it('supports a custom path and structured check results', async () => {
    const app = new Hono();
    mountHealth(app, {
      path: '/healthz',
      checks: { db: async () => ({ status: 'up' as const, details: { latencyMs: 3 } }) },
    });
    const res = await app.request(req('/healthz'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: { db: { details: { latencyMs: number } } } };
    expect(body.checks.db.details.latencyMs).toBe(3);
  });
});

/* ================= GRACEFUL SHUTDOWN ================= */

describe('gracefulShutdown', () => {
  it('registers signal listeners and returns a detach function', () => {
    const before = process.listenerCount('SIGTERM');
    const detach = gracefulShutdown({ signals: ['SIGTERM'], timeoutMs: 100 });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    detach();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});

/* ================= LOGGER TOKEN ================= */

describe('LOGGER token', () => {
  it('getLogger falls back to ConsoleLogger when nothing is registered', () => {
    if (container.has(LOGGER)) container.remove(LOGGER);
    expect(getLogger()).toBeInstanceOf(ConsoleLogger);
  });

  it('registerLogger binds a custom logger resolved by getLogger', () => {
    const logged: unknown[] = [];
    registerLogger({ info: (d) => logged.push(d) });
    const logger = getLogger();
    expect(logger).not.toBeInstanceOf(ConsoleLogger);
    logger.info?.({ a: 1 }, 'msg');
    expect(logged).toHaveLength(1);
    container.remove(LOGGER);
  });

  it('LOGGER is injectable via @Injectable tokens', () => {
    const logger = new ConsoleLogger();
    container.registerInstance(LOGGER, logger);

    @Injectable([LOGGER])
    class Svc {
      constructor(public log: unknown) {}
    }

    expect(container.resolve(Svc).log).toBe(logger);
    container.remove(LOGGER);
    container.remove(Svc);
  });
});

/* ================= REQUEST CONTEXT (Task 31) ================= */

import {
  Controller,
  Get,
  Public,
  HonoRouteBuilder,
  getContext,
  getRequestContext,
  registerConfig,
  getConfig,
  CONFIG,
  events,
  startEventBus,
  startScheduler,
  OnEvent,
  Interval,
  CircuitBreaker,
  CircuitOpenError,
  Status,
  NoContent,
  Singleton,
  Post,
  Delete,
} from '../src';
import { z } from 'zod';

describe('getContext / getRequestContext', () => {
  it('returns the active Hono context inside a handler and injected services', async () => {
    @Injectable()
    class Svc {
      ctxPath() { return getContext()?.req.path; }
      trace() { return getRequestContext()?.traceId; }
    }

    @Controller('/rc')
    @Injectable([Svc])
    class C {
      constructor(private svc: Svc) {}
      @Get() @Public()
      go() {
        return { fromSvc: this.svc.ctxPath(), trace: this.svc.trace(), direct: getContext()?.req.path };
      }
    }

    const res = await HonoRouteBuilder.build(C).request(new Request('http://t.local/rc'));
    const body = (await res.json()) as Record<string, string>;
    expect(body.fromSvc).toBe('/rc');
    expect(body.direct).toBe('/rc');
    expect(body.trace).toBeTruthy();
  });

  it('returns undefined outside a request', () => {
    expect(getContext()).toBeUndefined();
    expect(getRequestContext()).toBeUndefined();
  });
});

/* ================= CONFIG (Task 33) ================= */

describe('registerConfig / CONFIG', () => {
  it('parses a valid env once and exposes it typed + injectable', () => {
    const schema = z.object({ PORT: z.coerce.number(), NAME: z.string() });
    const cfg = registerConfig(schema, { PORT: '3000', NAME: 'demo' });
    expect(cfg.PORT).toBe(3000);

    @Injectable([CONFIG])
    class Svc {
      constructor(public env: unknown) {}
    }
    expect(container.resolve(Svc).env).toEqual(cfg);
    container.remove(CONFIG);
    container.remove(Svc);
  });

  it('throws a descriptive error listing invalid fields', () => {
    const schema = z.object({ PORT: z.coerce.number(), URL: z.string().url() });
    expect(() => registerConfig(schema, { PORT: 'x', URL: 'nope' })).toThrow(/Invalid config/);
  });

  it('getConfig throws when nothing is registered', () => {
    if (container.has(CONFIG)) container.remove(CONFIG);
    expect(() => getConfig()).toThrow(/registerConfig/);
  });
});

/* ================= EVENT BUS (Task 34) ================= */

describe('@OnEvent + events.emit', () => {
  it('dispatches payloads to DI-resolved subscribers; listener errors are isolated', async () => {
    const received: unknown[] = [];

    @Injectable()
    @Singleton()
    class Good {
      @OnEvent('user.created')
      onUser(p: unknown) { received.push(p); }
    }

    @Injectable()
    @Singleton()
    class Bad {
      @OnEvent('user.created')
      boom() { throw new Error('listener exploded'); }
    }

    const stop = startEventBus(Good, Bad);
    await events.emit('user.created', { id: '7' });
    stop();

    expect(received).toEqual([{ id: '7' }]);
    expect(events.listenerCount('user.created')).toBe(0);
    await events.emit('user.created', { id: '8' }); // after teardown: no-op
    expect(received).toHaveLength(1);
  });
});

/* ================= SCHEDULER (Task 35) ================= */

describe('@Interval + startScheduler', () => {
  it('ticks on the interval and stops cleanly via teardown', async () => {
    let ticks = 0;

    @Injectable()
    @Singleton()
    class Job {
      @Interval(10)
      run() { ticks++; }
    }

    const stop = startScheduler(Job);
    await new Promise((r) => setTimeout(r, 45));
    stop();
    const afterStop = ticks;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 25));
    expect(ticks).toBe(afterStop); // no ticks after teardown
  });
});

/* ================= CIRCUIT BREAKER (Task 36) ================= */

describe('@CircuitBreaker', () => {
  it('opens after threshold, fast-fails, then half-open probe closes it', async () => {
    let calls = 0;

    class Gateway {
      @CircuitBreaker({ failureThreshold: 2, resetAfterMs: 30 })
      async call(ok: boolean) {
        calls++;
        if (!ok) throw new Error('upstream down');
        return 'ok';
      }
    }

    const gw = new Gateway();
    await expect(gw.call(false)).rejects.toThrow('upstream down');
    await expect(gw.call(false)).rejects.toThrow('upstream down');
    expect(calls).toBe(2);

    // circuit open — fast fail, handler NOT invoked
    await expect(gw.call(true)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toBe(2);

    // after resetAfterMs — probe goes through and closes the circuit
    await new Promise((r) => setTimeout(r, 40));
    expect(await gw.call(true)).toBe('ok');
    expect(await gw.call(true)).toBe('ok');
    expect(calls).toBe(4);
  });
});

/* ================= STATUS / NOCONTENT (Task 37) ================= */

describe('@Status / @NoContent', () => {
  it('@Status(201) sets the response code; @NoContent returns empty 204', async () => {
    @Controller('/st')
    class C {
      @Post() @Public() @Status(201)
      create() { return { id: '1' }; }
      @Delete('/:id') @Public() @NoContent()
      remove() { return { anything: true }; }
      @Get('/raw') @Public() @Status(202)
      raw() { return new Response('custom', { status: 418 }); }
    }

    const app = HonoRouteBuilder.build(C);
    const r1 = await app.request(new Request('http://t.local/st', { method: 'POST' }));
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ id: '1' });

    const r2 = await app.request(new Request('http://t.local/st/9', { method: 'DELETE' }));
    expect(r2.status).toBe(204);
    expect(await r2.text()).toBe('');

    const r3 = await app.request(new Request('http://t.local/st/raw'));
    expect(r3.status).toBe(418); // Response passthrough wins over @Status
  });
});

/* ================= API VERSIONING (Task 32) ================= */

describe('controller versioning', () => {
  it('prefixes routes with /{version} when version is set', async () => {
    @Controller('/users', { version: 'v2' })
    class V2 {
      @Get() @Public()
      list() { return { v: 2 }; }
    }
    @Controller('/users')
    class V1 {
      @Get() @Public()
      list() { return { v: 1 }; }
    }

    const app = new Hono();
    app.route('/', HonoRouteBuilder.build(V2));
    app.route('/', HonoRouteBuilder.build(V1));

    const r2 = await app.request(new Request('http://t.local/v2/users'));
    expect(await r2.json()).toEqual({ v: 2 });
    const r1 = await app.request(new Request('http://t.local/users'));
    expect(await r1.json()).toEqual({ v: 1 });
  });
});
