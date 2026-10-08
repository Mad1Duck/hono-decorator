# Task 45 — `@Validate`: satu schema untuk validasi + OpenAPI

## Masalah

`Body(c, Schema)` / `ValidatedBody` memvalidasi request tapi tidak masuk ke spec OpenAPI — developer harus mendeklarasikan `@ApiBody` dengan schema yang sama. Dua sumber kebenaran untuk satu kontrak; lupa salah satunya = docs berbohong.

## Solusi

- `src/decorators/validate.ts` — `@Validate({ body?, query?, params? })`.
  - Runtime: menyimpan `ValidationMetadata` di `METADATA_KEYS.VALIDATION`.
  - Spec: merge ke `METADATA_KEYS.OPENAPI` — `body` → `requestBody`, `query`/`params` (ZodObject) di-expand per-field jadi parameter entries. Field `params` baru ditambahkan ke `OpenAPIMetadata`.
- `route-builder.ts` — middleware validasi berjalan setelah guards: parse `c.req.json()` / `c.req.query()` / `c.req.param()`, hasil `parseAsync` disimpan di context keys (`VALIDATED_BODY`/`VALIDATED_QUERY`/`VALIDATED_PARAMS`). `ZodError` → 400 `VALIDATION_ERROR` via `wrapMiddleware`; JSON rusak → 400 `Invalid JSON body`.
- `param.ts` — `Body(c)`, `Query(c)`, `Params<T>(c)` (baru) mengembalikan nilai tervalidasi dari context bila tersedia — tanpa schema kedua, tanpa parse kedua; schema eksplisit tetap didukung.
- `openapi/generator.ts` — path params memakai schema `@Validate({ params })` (format uuid dll) bila ada, fallback `{type:'string'}`.

## Desain

- `query`/`params` harus `ZodObject` agar bisa di-expand menjadi parameter spec; non-object shape diabaikan di spec (tetap divalidasi saat runtime).
- `@ApiBody`/`@ApiQuery` tetap bisa dilayer untuk `description`/`required` — merge, metadata eksplisit menang.
- Urutan middleware: middleware → rate limit → guards → **validate** → handler (konsisten dengan NestJS guard-sebelum-pipe).

## Verifikasi

- `tests/validate.test.ts` — 11 test: 400 invalid, defaults/coercion, typed params, malformed JSON, emisi spec (requestBody/query/path params), `createApp`.
