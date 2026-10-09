import type { Context, Next } from 'hono';
import { HttpException } from './http-exception';
import { extractIp } from '../utils/request';
import type { HonoMiddlewareFn } from '../decorators/metadata';
import type { RateLimiterFactory, RateLimiterFactoryOptions } from './route-builder';

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

/**
 * Minimal Redis client surface needed by {@link redisRateLimiter} —
 * satisfied by ioredis, node-redis v4 (`sendCommand`-wrapped), or any
 * client exposing INCR/PEXPIRE/PTTL. Injected by the consumer — hono-forge
 * never imports a Redis driver itself.
 */
export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
}

/**
 * Redis-backed fixed-window rate limiter for multi-instance deployments —
 * the default `inMemoryRateLimiter` is per-process, so limits are multiplied
 * by instance count. This factory shares counters across instances via Redis.
 *
 * INCR + PEXPIRE-on-first-hit is the classic fixed-window pattern; the tiny
 * race between the two commands only affects a window's first request and is
 * documented accepted behaviour (the alternative — Lua — buys atomicity at
 * the cost of requiring EVAL support).
 *
 * @example
 * import Redis from 'ioredis';
 * const redis = new Redis();
 * HonoRouteBuilder.configure({
 *   rateLimiterFactory: redisRateLimiter(redis),
 * });
 */
export function redisRateLimiter(client: RedisRateLimitClient): RateLimiterFactory {
  return (options) => async (c: Context, next: Next) => {
    const identity = options.keyGenerator ? options.keyGenerator(c) : (extractIp(c) ?? 'anonymous');
    const key = `hono-forge:rl:${options.keyPrefix}${identity}`;

    const count = await client.incr(key);
    if (count === 1) await client.pexpire(key, options.windowMs);
    const ttlMs = await client.pttl(key);
    const resetAt = Date.now() + Math.max(ttlMs, 0);

    c.header('X-RateLimit-Limit', String(options.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > options.max) {
      throw HttpException.tooManyRequests(options.message ?? 'Too many requests', {
        meta: { retryAfterMs: Math.max(ttlMs, 0) },
      });
    }
    return next();
  };
}
