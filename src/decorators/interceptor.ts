import { METADATA_KEYS } from './metadata';
import type { CacheMetadata, HeadersMetadata, IdempotentMetadata, RedirectMetadata } from './metadata';
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

/**
 * Invalidate cache entries after this handler succeeds.
 * Each pattern is a key prefix — `'user-list'` or `'user-list:*'` deletes every
 * @Cache entry whose key starts with `user-list:`.
 *
 * @example
 * @Post() @CacheInvalidate('user-list')
 * create(c: Context) { ... }
 */
export function CacheInvalidate(...patterns: string[]): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.CACHE_INVALIDATE] as Record<string, string[]> | undefined) ?? {};
    all[String(context.name)] = patterns;
    context.metadata[METADATA_KEYS.CACHE_INVALIDATE] = all;
  };
}

/**
 * Make this route idempotent: when the client sends an `Idempotency-Key`
 * header, the first response is stored in the configured {@link CacheAdapter}
 * and replayed for any repeat of the same key (including concurrent
 * duplicates — only one handler execution happens).
 *
 * Requests without the header pass through normally. Stored snapshots live for
 * `ttl` ms (default 24h). Response headers `set-cookie`/`content-length` are
 * not replayed.
 *
 * @example
 * @Post() @Idempotent()
 * createOrder(c: Context) { ... }
 */
export function Idempotent(options: IdempotentMetadata = {}): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.IDEMPOTENT] as Record<string, IdempotentMetadata> | undefined) ?? {};
    all[String(context.name)] = options;
    context.metadata[METADATA_KEYS.IDEMPOTENT] = all;
  };
}

/**
 * Deduplicate concurrent identical requests: when N requests hit this route
 * while a handler for the same method+path+query is still running, only one
 * execution happens — the other callers receive a copy of that response.
 * Guards against thundering-herd spikes on expensive endpoints.
 *
 * Note: keyed by method+path+query (not body) — intended for safe reads or
 * endpoints where identical concurrent requests are semantically equal. For
 * mutations prefer {@link Idempotent}, which is client-keyed.
 */
export function SingleFlight(): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.SINGLE_FLIGHT] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.SINGLE_FLIGHT] = all;
  };
}

/**
 * Set a static response header. Repeatable — multiple @Header decorators
 * merge. Headers apply to responses produced via `c.json`/`c.body`/etc.;
 * a raw `new Response()` returned by the handler bypasses them (set headers
 * on that Response directly instead).
 */
export function Header(name: string, value: string): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.HEADERS] as Record<string, HeadersMetadata> | undefined) ?? {};
    const methodHeaders = all[String(context.name)] ?? {};
    methodHeaders[name] = value;
    all[String(context.name)] = methodHeaders;
    context.metadata[METADATA_KEYS.HEADERS] = all;
  };
}

/**
 * Always redirect — the handler is never invoked and DI/guards are skipped.
 * Use for renamed/legacy endpoints:
 *
 * @example
 * @Get('/old-users') @Redirect('/users')
 * oldUsers(c: Context) { ... }  // never runs
 */
export function Redirect(
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 302
): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.REDIRECT] as Record<string, RedirectMetadata> | undefined) ?? {};
    all[String(context.name)] = { location, status };
    context.metadata[METADATA_KEYS.REDIRECT] = all;
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
