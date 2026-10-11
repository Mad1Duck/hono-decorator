# 70 — Hono-forge decorator DX batch

## Done

- `@Timeout(ms)` now also stamps metadata, so the OpenAPI generator emits `504 Gateway Timeout` response docs. Runtime race remains in `src/decorators/interceptor.ts`.
- `@Serialize(schema)` — run handler return through Zod to strip/coerce output. Added `src/decorators/serialize.ts` + export.
- `@ApiSecurity(name)` / `@ApiSecurityScheme(name, spec)` — arbitrary OpenAPI security schemes (apiKey, basic, oauth2). Generator emits `components.securitySchemes` and per-route `security`.
- `SetCookie(c, name, value, opts)` and `DeleteCookie(c, name, opts)` helpers in `src/decorators/param.ts`.
- `createApp({ cors: true | hono/cors options })` global CORS middleware.
- CLI `routes --json`, `graph --format mermaid`, `doctor --json`.
- `HttpException.gatewayTimeout` factory.

## Verification

- 366 tests pass
- tsc --noEmit clean
- tsup build + node smoke clean
