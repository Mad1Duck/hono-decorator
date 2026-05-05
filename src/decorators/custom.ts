import 'reflect-metadata';
import type { ZodTypeAny } from 'zod';
import { txStorage } from '../utils/transaction';
import { getRequestContext, createRequestContext, runInRequestContext, type CacheEntry } from '../core/request-context';

/* ================= TYPES ================= */

type AnyMethod = (...args: unknown[]) => unknown;

type ClassCtor = new (...args: unknown[]) => unknown;

/* ================= MEMOIZE REQUEST SCOPE ================= */

/**
 * Wraps `fn` in a fresh per-request memoize scope.
 * Called automatically by HonoRouteBuilder for every HTTP handler.
 * Only needed manually when running handlers outside the route builder.
 */
export function runWithMemoScope<T>(fn: () => T): T {
  if (getRequestContext()) return fn();
  return runInRequestContext(createRequestContext(''), fn);
}

type LoggerLike = {
  info?: (data: unknown, message?: string) => void;
};

type DbLike = {
  transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

/**
 * Custom transaction executor — receives the db instance and a run function,
 * and is responsible for wrapping `run` inside a transaction.
 *
 * @example Prisma
 * (db, run) => db.$transaction(run)
 *
 * @example Kysely
 * (db, run) => db.transaction().execute(run)
 */
export type TransactionExecutor<TDb = unknown> = (
  db: TDb,
  run: (tx: TDb) => Promise<unknown>
) => Promise<unknown>;

/* ================= THROTTLE ================= */

export function Throttle(ms: number): MethodDecorator {
  const lastCallMap = new WeakMap<object, number>();

  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: object,
      ...args: unknown[]
    ) {
      const now = Date.now();
      const lastCall = lastCallMap.get(this) ?? 0;

      if (now - lastCall < ms) {
        throw new Error(`Throttled: wait ${ms - (now - lastCall)}ms`);
      }

      lastCallMap.set(this, now);
      return await original.apply(this, args);
    }) as T;

    return descriptor;
  };
}

/* ================= MEMOIZE ================= */

/**
 * Caches the method's return value.
 *
 * @param options.ttl       - Cache TTL in milliseconds. Omit for indefinite caching.
 * @param options.scope     - `'global'` — one cache shared across all requests (default).
 *                            `'request'` — fresh cache per request; safe for user-specific data.
 *                            Use `'request'` on singletons that return per-user results.
 *
 * @example Global cache (DB config, feature flags)
 * @Memoize({ ttl: 60_000 })
 * async getConfig() { ... }
 *
 * @example Request-scoped cache (user-specific data on a singleton service)
 * @Memoize({ scope: 'request' })
 * async getUser(id: string) { ... }
 */
export function Memoize(
  options: { ttl?: number; scope?: 'global' | 'request'; } = {}
): MethodDecorator {
  const globalCache = new Map<string, CacheEntry>();
  // unique key so different @Memoize applications don't share the per-request bucket
  const methodId = `memo_${Math.random().toString(36).slice(2)}`;

  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const key = JSON.stringify(args);
      const scope = options.scope ?? 'global';

      let cache: Map<string, CacheEntry>;

      if (scope === 'request') {
        const ctx = getRequestContext();
        if (ctx) {
          if (!ctx.memoCache.has(methodId)) {
            ctx.memoCache.set(methodId, new Map());
          }
          cache = ctx.memoCache.get(methodId)!;
        } else {
          // Outside request context — fall back to global silently
          cache = globalCache;
        }
      } else {
        cache = globalCache;
      }

      const cached = cache.get(key);
      if (cached && (!options.ttl || Date.now() < cached.expires)) {
        return cached.value;
      }

      const result = await original.apply(this, args);
      cache.set(key, {
        value: result,
        expires: options.ttl ? Date.now() + options.ttl : Infinity,
      });
      return result;
    }) as T;

    return descriptor;
  };
}

/* ================= VALIDATE RESULT ================= */

export function ValidateResult(schema: ZodTypeAny): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const result = await original.apply(this, args);
      return await schema.parseAsync(result);
    }) as T;

    return descriptor;
  };
}

/* ================= AUDIT ================= */

export function Audit(options: { action: string; }): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: {
        logger?: LoggerLike;
        currentUser?: { id?: string; };
      },
      ...args: unknown[]
    ) {
      const log: LoggerLike = this.logger ?? {
        info: (data, msg) => console.log(`[${target.constructor.name}]`, msg, data),
      };

      log.info?.(
        {
          action: options.action,
          user: this.currentUser?.id,
          timestamp: new Date().toISOString(),
          method: `${target.constructor.name}.${String(propertyKey)}`,
        },
        'Audit log'
      );

      return await original.apply(this, args);
    }) as T;

    return descriptor;
  };
}

/* ================= TRANSACTION ================= */

const defaultExecutor: TransactionExecutor = (db, run) =>
  (db as DbLike).transaction((tx) => run(tx as typeof db));

/**
 * Wraps a method inside a database transaction.
 *
 * Requires `this.db` to be set on the class instance.
 * The `tx` object replaces `this.db` for the duration of the call,
 * so nested repository calls automatically use the transaction.
 *
 * Pass a custom executor to support ORMs with non-standard transaction APIs.
 *
 * @example Drizzle / Knex / TypeORM (default — no executor needed)
 * @Transaction()
 * async transfer() { ... }
 *
 * @example Prisma
 * @Transaction((db: PrismaClient, run) => db.$transaction(run))
 * async transfer() { ... }
 *
 * @example Kysely
 * @Transaction((db: Kysely<DB>, run) => db.transaction().execute(run))
 * async transfer() { ... }
 */
export function Transaction(
  executor?: TransactionExecutor
): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    const exec = executor ?? defaultExecutor;

    descriptor.value = (async function (
      this: { db?: unknown; },
      ...args: unknown[]
    ) {
      if (!this.db) {
        throw new Error(
          `@Transaction: 'db' property not found on ${target.constructor.name}`
        );
      }

      return exec(this.db, async (tx) => {
        // Store tx in AsyncLocalStorage so injected repositories can pick
        // it up via useTransaction() without being passed tx explicitly.
        return txStorage.run(tx, () => original.apply(this, args));
      });
    }) as T;

    return descriptor;
  };
}

/* ================= UTILITIES ================= */

export function getMethodMetadata<T>(
  target: object,
  propertyKey: string,
  key: symbol
): T | undefined {
  return Reflect.getMetadata(key, target, propertyKey) as T | undefined;
}

export function getClassMetadata<T>(
  target: ClassCtor,
  key: symbol
): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

export function hasDecorator(
  target: object,
  propertyKey: string,
  key: symbol
): boolean {
  return Reflect.hasMetadata(key, target, propertyKey);
}
