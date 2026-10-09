# Task 53 — `Retry-After` header on 429 responses

**Status:** done

## Goal

`retryAfterMs` already existed in `HttpException.meta` from all three
rate-limit paths, but never surfaced as the standard HTTP `Retry-After`
header — clients had no spec-compliant way to back off.

## Implementation

- `src/core/rate-limit.ts` — `inMemoryRateLimiter` and `redisRateLimiter`
  set `c.header('Retry-After', <seconds>)` before throwing 429. Redis path
  derives it from `PTTL`.
- `src/decorators/custom.ts` — `@Throttle` sets the header via
  `getContext()?.header(...)` (method-level, no direct `Context` param).
- Headers set via `c.header` survive the `HttpException` → `c.json` error
  path — verified by tests against real responses.

## Tests

`tests/production.test.ts` — 3 tests: `@RateLimit` (in-memory) 429 carries
`Retry-After` ≤ window, `redisRateLimiter` derives it from fake-client PTTL,
`@Throttle` on a singleton controller emits it.
