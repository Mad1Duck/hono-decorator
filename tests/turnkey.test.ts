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
