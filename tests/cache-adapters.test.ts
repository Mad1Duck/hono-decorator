import { describe, expect, it } from 'bun:test';
import {
  Controller,
  HonoRouteBuilder,
  Idempotent,
  InMemoryCacheAdapter,
  PostgresCacheAdapter,
  Post,
  Public,
  RedisCacheAdapter,
  type CacheEntry,
  type RedisCacheClient,
  type SqlQueryFn,
} from '../src';

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

/* ---------- fakes ---------- */

function fakeRedis(): RedisCacheClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, _mode, _ttl) {
      store.set(key, value);
    },
    async del(...keys) {
      for (const k of keys) store.delete(k);
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

function fakePg() {
  const rows = new Map<string, { value: unknown; expires: string }>();
  const query: SqlQueryFn = async (text, params) => {
    if (text.startsWith('SELECT value, expires')) {
      const r = rows.get(params[0] as string);
      return { rows: r ? [{ value: r.value, expires: r.expires }] : [] };
    }
    if (text.startsWith('INSERT INTO')) {
      rows.set(params[0] as string, {
        value: JSON.parse(params[1] as string),
        expires: params[2] as string,
      });
      return { rows: [] };
    }
    if (text.startsWith('DELETE FROM') && text.includes('LIKE')) {
      const prefix = (params[0] as string).replace(/%$/, '');
      const deleted: Record<string, unknown>[] = [];
      for (const k of rows.keys()) {
        if (k.startsWith(prefix)) {
          rows.delete(k);
          deleted.push({ key: k });
        }
      }
      return { rows: deleted };
    }
    if (text.startsWith('DELETE FROM')) {
      const k = params[0] as string;
      const had = rows.delete(k);
      return { rows: had ? [{ key: k }] : [] };
    }
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { query, rows };
}

/* ---------- RedisCacheAdapter ---------- */

describe('RedisCacheAdapter', () => {
  it('round-trips values as JSON CacheEntry blobs', async () => {
    const client = fakeRedis();
    const cache = new RedisCacheAdapter(client);
    await cache.set('k1', { id: 7 }, 60_000);
    const hit = await cache.get('k1');
    expect(hit?.value).toEqual({ id: 7 });
    expect(hit!.expires).toBeGreaterThan(Date.now());
    expect(client.store.keys().next().value).toBe('hono-forge:cache:k1');
  });

  it('returns undefined for misses and corrupt payloads', async () => {
    const client = fakeRedis();
    const cache = new RedisCacheAdapter(client);
    expect(await cache.get('nope')).toBeUndefined();
    client.store.set('hono-forge:cache:bad', '{not json');
    expect(await cache.get('bad')).toBeUndefined();
  });

  it('delete() and deletePattern() evict keys', async () => {
    const client = fakeRedis();
    const cache = new RedisCacheAdapter(client);
    await cache.set('todos:1', 1, 1000);
    await cache.set('todos:2', 2, 1000);
    await cache.set('users:1', 3, 1000);
    await cache.delete('todos:1');
    expect(await cache.get('todos:1')).toBeUndefined();
    await cache.deletePattern('todos:*');
    expect(await cache.get('todos:2')).toBeUndefined();
    expect((await cache.get('users:1'))?.value).toBe(3);
  });
});

/* ---------- PostgresCacheAdapter ---------- */

describe('PostgresCacheAdapter', () => {
  it('round-trips, upserts on conflict, and lazy-evicts expired rows', async () => {
    const { query, rows } = fakePg();
    const cache = new PostgresCacheAdapter(query);
    await cache.set('k', { a: 1 }, 60_000);
    expect((await cache.get('k'))?.value).toEqual({ a: 1 });

    await cache.set('k', { a: 2 }, 60_000); // upsert — no duplicate key error
    expect(rows.size).toBe(1);
    expect((await cache.get('k'))?.value).toEqual({ a: 2 });

    await cache.set('old', 1, -1); // already expired
    expect(await cache.get('old')).toBeUndefined();
    expect(rows.has('old')).toBe(false); // lazy eviction on read
  });

  it('deletePattern issues a LIKE delete', async () => {
    const { query } = fakePg();
    const cache = new PostgresCacheAdapter(query);
    await cache.set('todos:1', 1, 1000);
    await cache.set('todos:2', 2, 1000);
    await cache.set('users:1', 3, 1000);
    await cache.deletePattern('todos:*');
    expect(await cache.get('todos:1')).toBeUndefined();
    expect((await cache.get('users:1'))?.value).toBe(3);
  });

  it('rejects unsafe table names', () => {
    const { query } = fakePg();
    expect(() => new PostgresCacheAdapter(query, 'x; drop table y')).toThrow(/unsafe/i);
    expect(() => PostgresCacheAdapter.createTableSql('1bad')).toThrow(/unsafe/i);
  });
});

/* ---------- named adapters ---------- */

describe('named cache adapters', () => {
  it('fails fast at build() when a route names an unregistered adapter', () => {
    HonoRouteBuilder.configure({});
    @Controller('/idem-x')
    class C {
      @Post() @Public() @Idempotent({ adapter: 'pg' })
      create() {
        return { id: 1 };
      }
    }
    expect(() => HonoRouteBuilder.build(C)).toThrow(/adapter "pg"/);
  });

  it('@Idempotent({ adapter }) reads/writes the named store, not the default', async () => {
    const durable = new InMemoryCacheAdapter();
    HonoRouteBuilder.configure({ cacheAdapters: { pg: durable } });
    let calls = 0;
    @Controller('/idem-named')
    class C {
      @Post() @Public() @Idempotent({ adapter: 'pg' })
      create() {
        calls++;
        return { id: calls };
      }
    }
    const app = HonoRouteBuilder.build(C);
    const key = { 'Idempotency-Key': 'named-1' };
    const r1 = await app.request(makeRequest('/idem-named', { method: 'POST', headers: key }));
    const r2 = await app.request(makeRequest('/idem-named', { method: 'POST', headers: key }));
    expect(await r1.json()).toEqual({ id: 1 });
    expect(await r2.json()).toEqual({ id: 1 });
    expect(calls).toBe(1);
    // proof it went to the named adapter: the entry is physically in `durable`
    const stored = [...(durable as unknown as { store: Map<string, CacheEntry> }).store.keys()];
    expect(stored.some((k) => k.includes('named-1'))).toBe(true);
  });
});
