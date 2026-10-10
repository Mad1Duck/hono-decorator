# Task 67 — `errorFormat: 'problem'` (RFC 9457)

**Status:** done

## Goal

The framework emits a custom error envelope; standards-aware tooling
(monitoring, SDKs, gateways) expects RFC 9457 `application/problem+json`.

## Implementation

- `src/core/problem.ts` — `problemResponse(c, error, exposeStack)` renders
  `type`/`title`/`status`/`detail`/`instance` for `HttpException` (meta
  fields spread as extension members, `code` included) and `ZodError`
  (`code: VALIDATION_ERROR`, issues under `errors`). Uses `c.body` so
  headers set before the throw (`Retry-After`) survive; content-type is
  `application/problem+json`.
- `RouteBuilderConfig.errorFormat: 'envelope' | 'problem'` — envelope
  stays the default (backward compatible).
- `route-builder.ts` — both duplicated catch blocks (middleware wrapper +
  handler) refactored into one `respondToError` closure that branches on
  the format. Guard denials now throw `HttpException` instead of writing
  envelopes directly, so they ride the same path — bonus: they now reach
  filters/onError like every other error.

## Tests

`tests/production.test.ts` — problem mode: 404 body members, meta spread,
`application/problem+json`; Zod 400 with `errors`; envelope remains
default.
