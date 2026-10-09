# Task 51 — `redisRateLimiter` distributed rate limiting

**Status:** done

## Goal

The default `inMemoryRateLimiter` is per-process — under multi-instance
deployments each instance enforces its own counter, so the effective limit is
`max × instanceCount`. A shared backend fixes this.

## Implementation

- `src/core/rate-limit.ts`:
  - `RedisRateLimitClient` — minimal injected interface (`incr`, `pexpire`,
    `pttl`); ioredis-compatible, no runtime dependency.
  - `redisRateLimiter(client): RateLimiterFactory` — classic fixed-window
    `INCR` + `PEXPIRE`-on-first-hit, namespaced keys
    (`hono-forge:rl:{keyPrefix}{identity}`), `X-RateLimit-*` headers derived
    from `PTTL`, `429` with `retryAfterMs` on exceed.
- Tests in `tests/turnkey.test.ts` with a fake shared client proving
  cross-instance counting and header emission.
- README: `redisRateLimiter` example in the rate-limit section.

## Verify

- `bun test tests/turnkey.test.ts` — 21 pass (2 new).
