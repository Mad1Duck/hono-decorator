/**
 * Benchmark: plain Hono vs hono-forge controller pipeline.
 * In-process dispatch (`app.request`) — isolates framework overhead from
 * the HTTP stack. Run: bun scripts/bench.ts
 */
import { Hono } from 'hono';
import {
  Controller,
  Get,
  Post,
  Public,
  Injectable,
  Singleton,
  HonoRouteBuilder,
  Body,
  Param,
} from '../src/index';
import { z } from 'zod';
import type { Context } from 'hono';

/* ---------- plain Hono app ---------- */

const plain = new Hono();
plain.get('/items/:id', (c) => c.json({ id: c.req.param('id') }));
plain.post('/items', async (c) => {
  const body = await c.req.json();
  return c.json({ created: body.name });
});
plain.get('/healthz', (c) => c.json({ ok: true }));

/* ---------- hono-forge app ---------- */

@Injectable()
@Singleton()
class ItemSvc {
  find(id: string) { return { id }; }
}

@Controller('/items')
@Injectable([ItemSvc])
class ItemController {
  constructor(private svc: ItemSvc) {}

  @Get('/:id')
  @Public()
  get(c: Context) { return this.svc.find(Param(c, 'id')); }

  @Post()
  @Public()
  async create(c: Context) {
    const body = await Body(c, z.object({ name: z.string() }));
    return { created: body.name };
  }
}

@Controller('')
class HealthController {
  @Get('/healthz')
  @Public()
  health() { return { ok: true }; }
}

HonoRouteBuilder.configure({});
const forge = new Hono();
forge.route('/', HonoRouteBuilder.build(ItemController));
forge.route('/', HonoRouteBuilder.build(HealthController));

/* ---------- bench ---------- */

async function bench(
  label: string,
  app: Hono,
  makeReq: () => Request,
  iterations: number,
  warmup = 2000
) {
  for (let i = 0; i < warmup; i++) await app.request(makeReq());
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) await app.request(makeReq());
  const ms = performance.now() - t0;
  const rps = Math.round((iterations / ms) * 1000);
  console.log(`${label.padEnd(46)} ${rps.toLocaleString().padStart(9)} req/s  (${(ms / iterations).toFixed(3)} ms/req)`);
  return rps;
}

const N = 50_000;

console.log(`\n=== in-process dispatch, ${N.toLocaleString()} requests ===\n`);

const getReq = () => new Request('http://b/items/42');
const postReq = () =>
  new Request('http://b/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
const healthReq = () => new Request('http://b/healthz');

const p1 = await bench('plain  GET /items/:id', plain, getReq, N);
const f1 = await bench('forge  GET /items/:id (DI+param)', forge, getReq, N);
console.log(`  → overhead vs plain: ${(((p1 - f1) / p1) * 100).toFixed(1)}% slower\n`);

const p2 = await bench('plain  POST /items (json)', plain, postReq, N);
const f2 = await bench('forge  POST /items (zod+DI)', forge, postReq, N);
console.log(`  → overhead vs plain: ${(((p2 - f2) / p2) * 100).toFixed(1)}% slower\n`);

const p3 = await bench('plain  GET /healthz', plain, healthReq, N);
const f3 = await bench('forge  GET /healthz', forge, healthReq, N);
console.log(`  → overhead vs plain: ${(((p3 - f3) / p3) * 100).toFixed(1)}% slower\n`);
