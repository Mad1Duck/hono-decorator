# default in memory rate limiter

**File:** see summary

@RateLimit required a configured rateLimiterFactory — now ships a default in-memory fixed-window limiter (src/core/rate-limit.ts), keyed by client IP via extractIp.

## Checklist

- [x] Implemented
- [x] Tested
- [x] README updated

## Status

Done — 288 tests passing, type-check and build green.
