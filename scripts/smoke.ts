/**
 * Node-runtime smoke test — compiled to plain JS by `bun build --target node`
 * and executed with `node`. Exercises the real consumer path: TC39 decorators
 * compiled down, the Symbol.metadata polyfill, DI, routing, context helpers,
 * health, and the event bus — everything a Node user would hit.
 *
 * Run via `bun run test:node`.
 */
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
  getContext,
  mountHealth,
  events,
  startEventBus,
  OnEvent,
} from '../src/index';
import { z } from 'zod';
import type { Context } from 'hono';

let failures = 0;
const check = (name: string, cond: boolean) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`);
  }
};

const emitted: unknown[] = [];

@Injectable()
@Singleton()
class Greeting {
  hi(id: string) {
    return { msg: `hello ${id}`, trace: getContext()?.req.header('x-request-id') };
  }

  @OnEvent('smoke.*')
  onSmoke(p: unknown) {
    emitted.push(p);
  }
}

@Controller('/smoke')
@Injectable([Greeting])
class SmokeController {
  constructor(private svc: Greeting) {}

  @Get('/:id')
  @Public()
  get(c: Context) {
    return this.svc.hi(Param(c, 'id'));
  }

  @Post()
  @Public()
  async create(c: Context) {
    const body = await Body(c, z.object({ name: z.string() }));
    return { created: body.name };
  }
}

const app = HonoRouteBuilder.build(SmokeController);
mountHealth(app);
const stop = startEventBus(Greeting);
const req = (p: string, init?: RequestInit) => new Request(`http://x.local${p}`, init);

const r1 = await app.request(req('/smoke/42', { headers: { 'x-request-id': 't-1' } }));
const r1Body = (await r1.json()) as { msg: string; trace: string };
check('GET returns greeting', r1Body.msg === 'hello 42');
check('request-id echoed', r1.headers.get('x-request-id') === 't-1');
check('getContext inside service', r1Body.trace === 't-1');

const r2 = await app.request(
  req('/smoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'forge' }),
  })
);
check('POST validated body', ((await r2.json()) as { created: string }).created === 'forge');

const r3 = await app.request(
  req('/smoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
);
check('invalid body → 400', r3.status === 400);

const r4 = await app.request(req('/health'));
check('health endpoint 200', r4.status === 200);

await events.emit('smoke.done', { x: 1 });
check('@OnEvent wildcard dispatch', emitted.length === 1);
stop();

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke ok');
