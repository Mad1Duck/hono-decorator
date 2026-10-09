# Task 59 — `@CacheControl` / `@ETag` conditional requests

**Status:** done

## Goal

Cheap HTTP caching: `Cache-Control` directives and ETag-based conditional
requests (`If-None-Match` → `304`) as decorators.

## Implementation

- `src/decorators/metadata.ts` — `CACHE_CONTROL`, `ETAG` keys.
- `src/decorators/interceptor.ts`
  - `@CacheControl(options | string)` — typed `CacheControlOptions`
    (maxAge, sharedMaxAge, public/private, noCache/noStore,
    mustRevalidate, staleWhileRevalidate, immutable) → directive string,
    or pass a raw string through.
  - `@ETag({ weak = true })` — weak/strong flag.
- `src/core/route-builder.ts` — `Cache-Control` set beside `@Header`
  handling. `@ETag`: serialized result → truncated SHA-256 → `ETag`
  header; `If-None-Match` match → `304` with empty body. Raw `Response`
  returns bypass ETag (documented).

## Tests

`tests/production.test.ts` — options→directive mapping, raw string
passthrough, weak `W/"…"` tag, `If-None-Match` → 304, stale tag → 200,
`weak: false` strong tag.
