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
