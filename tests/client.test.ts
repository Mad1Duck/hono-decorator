import { describe, it, expect, afterAll } from 'bun:test';
import {
  Controller, Get, Post, Public, Param,
  HonoRouteBuilder, createClient, generateClientTypes, ClientRequestError,
} from '../src';
import type { Context } from 'hono';

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://test.local${path}`, init);
}

/* -------- codegen -------- */

describe('generateClientTypes', () => {
  @Controller('/users')
  class UserCtrl {
    @Get() @Public() list() { return [{ id: '1' }]; }
    @Get('/:id') @Public() getOne() { return { id: '1' }; }
    @Post() @Public() create() { return { ok: true }; }
  }

  it('emits a route map keyed by METHOD path with typed outputs', () => {
    const src = generateClientTypes({ controllers: [UserCtrl], importPath: './ctrl' });
    expect(src).toContain("import type { UserCtrl } from './ctrl';");
    expect(src).toContain('export interface AppRoutes {');
    expect(src).toContain("'GET /users': { output: Awaited<ReturnType<UserCtrl['list']>> };");
    expect(src).toContain("'GET /users/:id': { output: Awaited<ReturnType<UserCtrl['getOne']>> };");
    expect(src).toContain("'POST /users': { output: Awaited<ReturnType<UserCtrl['create']>> };");
  });

  it('uses a custom exportName', () => {
    const src = generateClientTypes({ controllers: [UserCtrl], importPath: './c', exportName: 'MyRoutes' });
    expect(src).toContain('export interface MyRoutes {');
  });
});

/* -------- createClient round-trip -------- */

describe('createClient', () => {
  @Controller('/api')
  class ApiCtrl {
    @Get('/items') @Public() list() { return [{ id: '1', name: 'a' }]; }
    @Get('/items/:id') @Public() getOne(c: Context) { return { id: Param(c, 'id'), q: c.req.query('q') ?? null }; }
    @Post('/items') @Public() async create(c: Context) { return { got: await c.req.json() }; }
  }

  interface ApiRoutes {
    'GET /api/items': { output: { id: string; name: string; }[]; };
    'GET /api/items/:id': { output: { id: string; q: string | null; }; };
    'POST /api/items': { output: { got: unknown; }; };
  }

  const app = HonoRouteBuilder.build(ApiCtrl);
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    app.fetch(typeof input === 'string' || input instanceof URL
      ? new Request(String(input), init)
      : input)) as typeof fetch;

  afterAll(() => { globalThis.fetch = origFetch; });

  const api = createClient<ApiRoutes>('http://test.local');

  it('GET with params + query, typed output', async () => {
    const res = await api.request('GET /api/items/:id', { params: { id: '42' }, query: { q: 'x' } });
    expect(res.id).toBe('42');
    expect(res.q).toBe('x');
  });

  it('POST sends JSON body', async () => {
    const res = await api.request('POST /api/items', { body: { name: 'n' } });
    expect(res.got).toEqual({ name: 'n' });
  });

  it('throws ClientRequestError on non-2xx', async () => {
    try {
      await api.request('GET /api/missing' as never);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ClientRequestError);
      expect((e as ClientRequestError).status).toBe(404);
    }
  });

  it('url() builds the request URL', () => {
    expect(api.url('GET /api/items/:id', { params: { id: 7 }, query: { q: 'y', skip: undefined } }))
      .toBe('http://test.local/api/items/7?q=y');
  });
});
