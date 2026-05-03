import 'reflect-metadata';
import type { ZodTypeAny } from 'zod';

/* ================= TYPES ================= */

type AnyMethod = (...args: unknown[]) => unknown;

type ClassCtor = new (...args: unknown[]) => unknown;

type CacheEntry = {
  value: unknown;
  expires: number;
};

type LoggerLike = {
  info?: (data: unknown, message?: string) => void;
};

type DbLike = {
  transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

/* ================= THROTTLE ================= */

export function Throttle(ms: number): MethodDecorator {
  let lastCall = 0;

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
      const now = Date.now();

      if (now - lastCall < ms) {
        throw new Error(`Throttled: wait ${ms - (now - lastCall)}ms`);
      }

      lastCall = now;
      return await original.apply(this, args);
    }) as T;

    return descriptor;
  };
}

/* ================= MEMOIZE ================= */

export function Memoize(
  options: { ttl?: number; } = {}
): MethodDecorator {
  const cache = new Map<string, CacheEntry>();

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

export function Transaction(): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: { db?: DbLike; },
      ...args: unknown[]
    ) {
      if (!this.db) {
        throw new Error(
          `@Transaction: 'db' property not found on ${target.constructor.name}`
        );
      }

      return this.db.transaction(async (tx) => {
        const originalDb = this.db;
        this.db = tx as DbLike;

        try {
          const result = await original.apply(this, args);
          this.db = originalDb;
          return result;
        } catch (err) {
          this.db = originalDb;
          throw err;
        }
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
