# Task 69 — `@JwtAuth` → OpenAPI bearer security

**Status:** done

## Goal

Authenticated routes should show up as secured in the generated spec —
`security: [{ bearerAuth: [] }]`, `401`/`403` responses, and a `bearerAuth`
HTTP scheme in `components.securitySchemes` — so Scalar's Authorize button
actually works. Guard-based auth (`@RequireAuth`, `@RequireRole`,
permissions) already did this via guard metadata; `@JwtAuth` is a
**middleware**, so the generator couldn't see it.

## Implementation

- `src/decorators/common-middleware.ts` — `JwtAuth` stamps a
  `Symbol.for('hono-forge.jwtAuth')` marker on the middleware fn it returns.
- `src/openapi/generator.ts` — `needsAuth` now also scans class- and
  method-level middleware for that marker (metadata record cast via
  `unknown` for the symbol-keyed lookup). `@Public` still wins →
  `security: []`.

## Tests

`tests/openapi.test.ts` — `@JwtAuth` route emits bearerAuth security +
401/403 + the component scheme; a `@JwtAuth` + `@Public` route emits
`security: []`; no-auth specs still omit `components`.
