import { METADATA_KEYS } from './metadata';
import type { CacheMetadata } from './metadata';

type AnyFn = (...args: unknown[]) => unknown;
type MethodDec = (value: Function, context: ClassMethodDecoratorContext) => Function;

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

export function TrackMetrics(options?: { name?: string; }): MethodDec {
  return (originalFn, context) => {
    const metricName = options?.name ?? `?.${String(context.name)}`;
    return async function (this: { metrics?: MetricsLike; }, ...args: unknown[]) {
      const start = Date.now();
      try {
        const result = await (originalFn as AnyFn).apply(this, args);
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'success');
        return result;
      } catch (error) {
        this.metrics?.trackMethodDuration?.(metricName, Date.now() - start, 'error');
        throw error;
      }
    };
  };
}

/* ================= TRANSFORM ================= */

export function Transform<TInput, TOutput>(transformer: (data: TInput) => TOutput): MethodDec {
  return (originalFn) => {
    return async function (this: unknown, ...args: unknown[]) {
      const result = (await (originalFn as AnyFn).apply(this, args)) as TInput;
      return transformer(result);
    };
  };
}

/* ================= RETRY ================= */

export function Retry(options: { attempts: number; delay?: number; backoff?: 'exponential' | 'linear'; }): MethodDec {
  return (originalFn) => {
    return async function (this: unknown, ...args: unknown[]) {
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
    };
  };
}

/* ================= TIMEOUT ================= */

export function Timeout(ms: number): MethodDec {
  return (originalFn) => {
    return async function (this: unknown, ...args: unknown[]) {
      return Promise.race([
        (originalFn as AnyFn).apply(this, args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
      ]);
    };
  };
}
