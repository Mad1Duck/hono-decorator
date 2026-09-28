import { METADATA_KEYS } from './metadata';
import type { CacheMetadata } from './metadata';
import { HttpException } from '../core/http-exception';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

type MetricsLike = {
  trackMethodDuration?: (name: string, duration: number, status: 'success' | 'error') => void;
};

/* ================= CACHE ================= */

export function Cache(options: CacheMetadata): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.CACHE] as Record<string, CacheMetadata> | undefined) ?? {};
    all[String(context.name)] = options;
    context.metadata[METADATA_KEYS.CACHE] = all;
  };
}

/* ================= TRACK METRICS ================= */

export function TrackMetrics(options?: { name?: string; }) {
  return <T extends AnyFn>(originalFn: T, context: ClassMethodDecoratorContext): T => {
    const methodName = String(context.name);
    let className: string | undefined;
    context.addInitializer(function (this: unknown) {
      className = context.static ? (this as Function).name : (this as object).constructor.name;
    });
    return (async function (this: { metrics?: MetricsLike; }, ...args: unknown[]) {
      const metricName = options?.name ?? (className ? `${className}.${methodName}` : methodName);
      const start = Date.now();
      try {
        const result = await (originalFn as AnyFn).apply(this, args);
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'success');
        return result;
      } catch (error) {
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'error');
        throw error;
      }
    }) as unknown as T;
  };
}

/* ================= TRANSFORM ================= */

export function Transform<TInput, TOutput>(transformer: (data: TInput) => TOutput) {
  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: unknown, ...args: unknown[]) {
      const result = (await (originalFn as AnyFn).apply(this, args)) as TInput;
      return transformer(result);
    }) as unknown as T;
  };
}

/* ================= RETRY ================= */

export function Retry(options: { attempts: number; delay?: number; backoff?: 'exponential' | 'linear'; }) {
  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: unknown, ...args: unknown[]) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= options.attempts; attempt++) {
        try {
          return await (originalFn as AnyFn).apply(this, args);
        } catch (error) {
          lastError = error;
          if (attempt < options.attempts) {
            const base = options.delay ?? 1000;
            const wait = options.backoff === 'exponential'
              ? base * Math.pow(2, attempt - 1)
              : base * attempt;
            await new Promise<void>((r) => setTimeout(r, wait));
          }
        }
      }
      throw lastError;
    }) as unknown as T;
  };
}

/* ================= TIMEOUT ================= */

export function Timeout(ms: number) {
  return <T extends AnyFn>(originalFn: T, _context: ClassMethodDecoratorContext): T => {
    return (async function (this: unknown, ...args: unknown[]) {
      return Promise.race([
        (originalFn as AnyFn).apply(this, args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new HttpException(504, `Timeout after ${ms}ms`)), ms)
        ),
      ]);
    }) as unknown as T;
  };
}
