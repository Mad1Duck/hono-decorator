# Task 61 — Route collision detection at build time

**Status:** done

## Goal

Two handlers bound to the same `method + path` silently shadowed each
other (the earlier registration wins in Hono) — a frequent, invisible
miswiring.

## Implementation

`src/core/route-builder.ts` — a per-build `seenRoutes` set:

- `build()` creates a fresh set per app (no cross-build false positives).
- `buildModule()` shares one set across all controllers — catches
  collisions BETWEEN controllers, the invisible case.
- `registerRoute` gained an internal `seenRoutes` parameter; on a
  duplicate `METHOD /path` key it logs `[hono-forge] Duplicate route …`
  via `LOGGER.warn` (non-fatal — intentional overlaps like mounted
  sub-apps remain possible).

## Tests

`tests/production.test.ts` — `buildModule` over two controllers sharing
`GET /x` produces the warning through a captured `registerLogger` spy.
