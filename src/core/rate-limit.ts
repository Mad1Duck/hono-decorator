import type { Context, Next } from 'hono';
import { HttpException } from './http-exception';
import { extractIp } from '../utils/request';
import type { HonoMiddlewareFn } from '../decorators/metadata';
import type { RateLimiterFactoryOptions } from './route-builder';

/**
 * Default in-memory fixed-window rate limiter.
 *
 * Used automatically when {@link HonoRouteBuilderConfig.rateLimiterFactory} is
 * not configured — `@RateLimit` works out of the box. For multi-instance
 * deployments swap in a Redis-backed factory via `configure()`.
 *
 * Note: the default identity is the client IP via {@link extractIp}. Behind a
 * proxy, X-Forwarded-For/CF-Connecting-IP are trusted — rate limits can be
 * bypassed by header spoofing if the proxy does not sanitize them. Provide a
 * `keyGenerator` keyed on a trusted identity (e.g. authenticated user id) when
 * that matters.
 */
export function inMemoryRateLimiter(options: RateLimiterFactoryOptions): HonoMiddlewareFn {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c: Context, next: Next) => {
    const identity = options.keyGenerator ? options.keyGenerator(c) : (extractIp(c) ?? 'anonymous');
    const key = `${options.keyPrefix}${identity}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    // Standard rate-limit headers — clients use these for backoff.
    c.header('X-RateLimit-Limit', String(options.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      throw HttpException.tooManyRequests(options.message ?? 'Too many requests', {
        meta: { retryAfterMs: entry.resetAt - now },
      });
    }

    // Opportunistic cleanup to bound memory usage.
    if (hits.size > 1000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }

    return next();
  };
}
