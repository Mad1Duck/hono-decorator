# Task 64 — `@Concurrency` per-route bulkhead

**Status:** done

## Goal

`@SingleFlight` dedupes identical requests but doesn't cap total load —
an expensive endpoint can still be driven into overload. A bulkhead
limits simultaneous executions and sheds excess fast.

## Implementation

- `src/decorators/guard.ts` — `@Concurrency(n)` sets `CONCURRENCY`
  metadata on the method.
- `route-builder.ts` — per-route counter; when active count reaches the
  limit the request throws `HttpException.serviceUnavailable(...)`
  INSIDE the standard try/catch so it becomes a normal 503 error
  response (filters included) rather than an unhandled rejection.
  Counter decrements in `finally` — exceptions and early returns never
  leak capacity.

## Tests

`tests/production.test.ts` — N+1 concurrent calls → exactly N run, the
extra gets 503; slots release on success AND on throw (proven by a
second wave succeeding).
