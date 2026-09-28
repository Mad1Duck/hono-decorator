# Task 15: Auto-OpenAPI dari Zod schema / `@ApiBody` + `@ApiQuery`

- File: `src/openapi/generator.ts`, `src/decorators/` (`@ApiBody`, `@ApiQuery` baru), `src/decorators/param.ts`
- Masalah: schema Zod untuk body/query ditulis di `Body(c, schema)` tapi tidak terhubung ke OpenAPI — consumer harus duplikasi schema di `@ApiDoc`/`@ApiResponse` manual.

## Deskripsi fitur

Tambahkan decorator deklaratif (lebih reliable daripada runtime-introspection `Body(c, ...)`):

```ts
@Post()
@ApiBody(CreateUserSchema)
@ApiQuery('page', z.coerce.number())
create(c: Context) { const body = await Body(c, CreateUserSchema); ... }
```

Generator membaca metadata → `requestBody` + `parameters` (query) otomatis di spec. Bonus: `@ApiBody`/`@ApiQuery` bisa juga melakukan validasi otomatis sebelum handler (hapus kebutuhan `Body(c, schema)` manual — putuskan, ada trade-off).

## Checklist

- [x] `@ApiBody(schema, { required?, description? })` → OpenAPI requestBody (JSON content); `required` auto-infer via `schema.safeParse(undefined)` — `.optional()`/`.default()` → false
- [x] `@ApiQuery(name, schema, opts)` → OpenAPI query parameters, digabung dengan path params yang di-infer dari URL
- [x] Auto-validation diputuskan TIDAK dilakukan — `@ApiBody` murni dokumentasi; validasi tetap `Body(c, schema)` (tidak ada silent behavior change)
- [x] Unit test: requestBody schema + query params + required inference — 2 test baru
- [x] README: update section OpenAPI dengan contoh `@ApiBody`/`@ApiQuery`
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 264 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
