/* ================= CACHE ADAPTER ================= */

export interface CacheEntry {
  value: unknown;
  /** Unix ms timestamp after which the entry is stale. */
  expires: number;
}

/**
 * Pluggable cache store used by @Cache and @CacheInvalidate.
 * Implement this to back the route cache with Redis or another shared store.
 */
export interface CacheAdapter {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  /** Delete every entry whose key starts with `prefix` (a trailing `*` is allowed). */
  deletePattern(prefix: string): void | Promise<void>;
}

/* ================= IN-MEMORY ================= */

/**
 * Default adapter — per-process Map with lazy expiry. Entries expire on read;
 * the store is pruned when it grows past `maxEntries`.
 */
export class InMemoryCacheAdapter implements CacheAdapter {
  private store = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 1000) { }

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) {
      const now = Date.now();
      for (const [k, v] of this.store) {
        if (v.expires <= now) this.store.delete(k);
      }
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deletePattern(prefix: string): void {
    const p = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    for (const key of this.store.keys()) {
      if (key.startsWith(p)) this.store.delete(key);
    }
  }

  /** Current entry count (including not-yet-pruned expired entries). */
  get size(): number {
    return this.store.size;
  }
}

export const defaultCacheAdapter = new InMemoryCacheAdapter();

/* ================= DURABLE ADAPTERS ================= */

/**
 * Minimal Redis client surface needed by {@link RedisCacheAdapter} —
 * satisfied by ioredis (`redis.get/set/del/keys`) out of the box. Injected by
 * the consumer — hono-forge never imports a Redis driver itself. node-redis
 * v4 needs a two-line wrapper (`set` takes an options object there).
 */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  /** ioredis form: `set(key, value, 'PX', ttlMs)`. */
  set(key: string, value: string, expiryMode: 'PX', ttlMs: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Redis-backed {@link CacheAdapter} — entries survive restarts and are shared
 * across instances, so `@Idempotent` keeps exactly-once semantics in a
 * multi-instance deployment and `@Cache` doesn't stampede after a deploy.
 *
 * Entries are JSON `{ value, expires }` blobs; the `expires` timestamp is
 * kept inside the payload (CacheAdapter contract) while the Redis TTL
 * handles physical eviction.
 *
 * @example
 * import Redis from 'ioredis';
 * const redis = new Redis();
 * HonoRouteBuilder.configure({
 *   cacheAdapter: new RedisCacheAdapter(redis),
 *   // or per-feature:
 *   cacheAdapters: { redis: new RedisCacheAdapter(redis) },
 * });
 */
export class RedisCacheAdapter implements CacheAdapter {
  constructor(
    private readonly client: RedisCacheClient,
    private readonly keyPrefix = 'hono-forge:cache:',
  ) { }

  async get(key: string): Promise<CacheEntry | undefined> {
    const raw = await this.client.get(this.keyPrefix + key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return undefined; // corrupt entry — treat as a miss
    }
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    const entry: CacheEntry = { value, expires: Date.now() + ttlMs };
    await this.client.set(
      this.keyPrefix + key,
      JSON.stringify(entry),
      'PX',
      Math.max(ttlMs, 1),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.keyPrefix + key);
  }

  /** KEYS is O(N) — fine for `@CacheInvalidate` bursts; swap for SCAN if a
   *  deployment invalidates against a huge keyspace on a hot path. */
  async deletePattern(prefix: string): Promise<void> {
    const p = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    const keys = await this.client.keys(`${this.keyPrefix}${p}*`);
    if (keys.length) await this.client.del(...keys);
  }
}

/** Any driver that can run parameterized SQL — `pg.Pool#query`,
 *  `postgres`' sql, Drizzle's `db.execute` (wrapped), Kysely, etc. */
export interface SqlQueryFn {
  (text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Postgres-backed {@link CacheAdapter} — the strongest option for
 * `@Idempotent` specifically: the row write is a single atomic
 * `INSERT ... ON CONFLICT` upsert, and the store rides on infrastructure the
 * app already has (no second failure domain like Redis).
 *
 * Requires one table — see {@link PostgresCacheAdapter.createTableSql}.
 *
 * @example
 * import { Pool } from 'pg';
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const cache = new PostgresCacheAdapter((sql, params) => pool.query(sql, params));
 * await pool.query(PostgresCacheAdapter.createTableSql());
 * HonoRouteBuilder.configure({
 *   cacheAdapters: { pg: cache },
 * });
 * // then: @Idempotent({ adapter: 'pg' })
 */
export class PostgresCacheAdapter implements CacheAdapter {
  constructor(
    private readonly query: SqlQueryFn,
    private readonly table = 'hono_forge_cache',
  ) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`PostgresCacheAdapter: unsafe table name "${table}"`);
    }
  }

  /** DDL for the backing table — run once at deploy time. */
  static createTableSql(table = 'hono_forge_cache'): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`PostgresCacheAdapter: unsafe table name "${table}"`);
    }
    return `CREATE TABLE IF NOT EXISTS ${table} (
  key       TEXT PRIMARY KEY,
  value     JSONB NOT NULL,
  expires   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ${table}_expires_idx ON ${table} (expires);`;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const { rows } = await this.query(
      `SELECT value, expires FROM ${this.table} WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    const expires = new Date(row.expires as string).getTime();
    if (expires <= Date.now()) {
      await this.query(`DELETE FROM ${this.table} WHERE key = $1`, [key]);
      return undefined;
    }
    const value =
      typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    return { value, expires };
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.query(
      `INSERT INTO ${this.table} (key, value, expires)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, expires = $3`,
      [key, JSON.stringify(value), new Date(Date.now() + ttlMs).toISOString()],
    );
  }

  async delete(key: string): Promise<void> {
    await this.query(`DELETE FROM ${this.table} WHERE key = $1`, [key]);
  }

  async deletePattern(prefix: string): Promise<void> {
    const p = (prefix.endsWith('*') ? prefix.slice(0, -1) : prefix)
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    await this.query(
      `DELETE FROM ${this.table} WHERE key LIKE $1 ESCAPE '\\'`,
      [`${p}%`],
    );
  }

  /** Optional housekeeping — delete all expired rows. Call on a cron or
   *  during idle time; rows are also evicted lazily on read. */
  async prune(): Promise<number> {
    const { rows } = await this.query(
      `DELETE FROM ${this.table} WHERE expires < now() RETURNING key`,
      [],
    );
    return rows.length;
  }
}
