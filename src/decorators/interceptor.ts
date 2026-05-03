import 'reflect-metadata';
import { METADATA_KEYS } from './metadata';
import type { CacheMetadata } from './metadata';

/* ================= TYPES ================= */

type AnyMethod = (...args: unknown[]) => unknown;

type MetricsLike = {
  trackMethodDuration?: (
    name: string,
    duration: number,
    status: 'success' | 'error'
  ) => void;
};

/* ================= CACHE ================= */

export function Cache(options: CacheMetadata): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata(
      METADATA_KEYS.CACHE,
      options,
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= TRACK METRICS ================= */

export function TrackMetrics(options?: { name?: string; }): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const original = descriptor.value as AnyMethod | undefined;
    if (!original) return descriptor;

    descriptor.value = (async function (
      this: { metrics?: MetricsLike; },
      ...args: unknown[]
    ) {
      const start = Date.now();
      const metricName =
        options?.name ??
        `${target.constructor.name}.${String(propertyKey)}`;

      try {
        const result = await original.apply(this, args);
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'success');
        return result;
      } catch (error) {
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'error');
        throw error;
      }
    }) as T;

    return descriptor;
  };
}

/* ================= TRANSFORM ================= */

export function Transform<TInput, TOutput>(
  transformer: (data: TInput) => TOutput
): MethodDecorator {
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
      const result = (await original.apply(this, args)) as TInput;
      return transformer(result);
    }) as T;

    return descriptor;
  };
}

/* ================= RETRY ================= */

export function Retry(options: {
  attempts: number;
  delay?: number;
  backoff?: 'exponential' | 'linear';
}): MethodDecorator {
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
      let lastError: unknown;

      for (let attempt = 1; attempt <= options.attempts; attempt++) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          lastError = error;

          if (attempt < options.attempts) {
            const baseDelay = options.delay ?? 1000;
            const waitTime =
              options.backoff === 'exponential'
                ? baseDelay * Math.pow(2, attempt - 1)
                : baseDelay * attempt;

            await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      throw lastError;
    }) as T;

    return descriptor;
  };
}

/* ================= TIMEOUT ================= */

export function Timeout(ms: number): MethodDecorator {
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
      return Promise.race([
        original.apply(this, args),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${ms}ms`)),
            ms
          )
        ),
      ]);
    }) as T;

    return descriptor;
  };
}
