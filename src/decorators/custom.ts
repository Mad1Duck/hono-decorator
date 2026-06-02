import type { ZodTypeAny } from 'zod';
import { txStorage } from '../utils/transaction';
import { getRequestContext, createRequestContext, runInRequestContext, type CacheEntry } from '../core/request-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/* ================= MEMOIZE REQUEST SCOPE ================= */

export function runWithMemoScope<T>(fn: () => T): T {
  if (getRequestContext()) return fn();
  return runInRequestContext(createRequestContext(''), fn);
}

/* ================= THROTTLE ================= */

export function Throttle(ms: number) {
  const lastCallMap = new WeakMap<object, number>();

  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: object, ...args: unknown[]) {
      const now = Date.now();
      const lastCall = lastCallMap.get(this) ?? 0;
      if (now - lastCall < ms) throw new Error(`Throttled: wait ${ms - (now - lastCall)}ms`);
      lastCallMap.set(this, now);
      return await (originalFn as AnyFn).apply(this, args);
    }) as unknown as T;
  };
}

/* ================= MEMOIZE ================= */

export function Memoize(
  options: { ttl?: number; scope?: 'global' | 'request'; } = {}
) {
  const globalCache = new Map<string, CacheEntry>();
  const methodId = `memo_${Math.random().toString(36).slice(2)}`;

  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: unknown, ...args: unknown[]) {
      const key = JSON.stringify(args);
      const scope = options.scope ?? 'global';

      let cache: Map<string, CacheEntry>;

      if (scope === 'request') {
        const ctx = getRequestContext();
        if (ctx) {
          if (!ctx.memoCache.has(methodId)) ctx.memoCache.set(methodId, new Map());
          cache = ctx.memoCache.get(methodId)!;
        } else {
          cache = globalCache;
        }
      } else {
        cache = globalCache;
      }

      const cached = cache.get(key);
      if (cached && (!options.ttl || Date.now() < cached.expires)) return cached.value;

      const result = await (originalFn as AnyFn).apply(this, args);
      cache.set(key, { value: result, expires: options.ttl ? Date.now() + options.ttl : Infinity });
      return result;
    }) as unknown as T;
  };
}

/* ================= VALIDATE RESULT ================= */

export function ValidateResult(schema: ZodTypeAny) {
  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: unknown, ...args: unknown[]) {
      const result = await (originalFn as AnyFn).apply(this, args);
      return await schema.parseAsync(result);
    }) as unknown as T;
  };
}

/* ================= AUDIT ================= */

type LoggerLike = { info?: (data: unknown, message?: string) => void; };

export function Audit(options: { action: string; }) {
  return <T extends AnyFn>(originalFn: T, context: ClassMethodDecoratorContext): T => {
    const methodRef = String(context.name);
    return (async function (this: { logger?: LoggerLike; currentUser?: { id?: string; }; }, ...args: unknown[]) {
      const log: LoggerLike = this.logger ?? {
        info: (data, msg) => console.log(`[${methodRef}]`, msg, data),
      };
      log.info?.(
        { action: options.action, user: this.currentUser?.id, timestamp: new Date().toISOString(), method: methodRef },
        'Audit log'
      );
      return await (originalFn as AnyFn).apply(this, args);
    }) as unknown as T;
  };
}

/* ================= TRANSACTION ================= */

type DbLike = { transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>; };

export type TransactionExecutor<TDb = unknown> = (
  db: TDb,
  run: (tx: TDb) => Promise<unknown>
) => Promise<unknown>;

const defaultExecutor: TransactionExecutor = (db, run) =>
  (db as DbLike).transaction((tx) => run(tx as typeof db));

export function Transaction(executor?: TransactionExecutor) {
  return <T extends AnyFn>(originalFn: T, context: ClassMethodDecoratorContext): T => {
    const exec = executor ?? defaultExecutor;
    return (async function (this: { db?: unknown; }, ...args: unknown[]) {
      if (!this.db) {
        throw new Error(`@Transaction: 'db' property not found on ${String(context.name)}`);
      }
      return exec(this.db, async (tx) =>
        txStorage.run(tx, () => (originalFn as AnyFn).apply(this, args))
      );
    }) as unknown as T;
  };
}

/* ================= UTILITIES ================= */

export function getMethodMetadata<T>(
  target: object,
  propertyKey: string,
  key: symbol
): T | undefined {
  const meta = (target.constructor as { [Symbol.metadata]?: Record<symbol, unknown> })[Symbol.metadata];
  const all = meta?.[key] as Record<string, T> | undefined;
  return all?.[propertyKey];
}

export function getClassMetadata<T>(
  target: Function,
  key: symbol
): T | undefined {
  const meta = (target as { [Symbol.metadata]?: Record<symbol, unknown> })[Symbol.metadata];
  return meta?.[key] as T | undefined;
}

export function hasDecorator(
  target: object,
  propertyKey: string,
  key: symbol
): boolean {
  return getMethodMetadata(target, propertyKey, key) !== undefined;
}
