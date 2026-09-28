# Task 11: Typed client generation dari controller

- File: `src/core/route-builder.ts`, `src/utils/` (file baru), `src/index.ts`
- Masalah: Hono RPC (`hc<AppType>`) butuh route chaining manual — tidak kompatibel dengan decorator. Semua metadata route sudah ada, tapi tidak ada cara generate type untuk client.

## Deskripsi fitur

Generate tipe end-to-end dari controller class — misal `type AppType = ForgeClientType<typeof UserController>` yang kompatibel dengan `hc<>`, atau client object dengan method per route. Pertimbangan: tipe return handler bisa diambil via `ReturnType`, tapi path/method harus di-derive dari metadata runtime (types tidak bisa baca `Symbol.metadata` secara statis — kemungkinan butuh deklarasi type-level atau generate via `declare module` / codegen).

## Checklist

- [x] Keputusan desain: codegen — TS tidak bisa membaca `Symbol.metadata` di type-level, jadi `generateClientTypes()` emit file `.ts` yang referensi `Awaited<ReturnType<Controller['method']>>` (inferensi penuh tanpa runtime type info)
- [x] `generateClientTypes({ controllers, importPath, exportName? })` → route map `'METHOD /path/:param'` → `{ output }` (skip SSE/WS/all/head)
- [x] `createClient<Routes>(baseUrl)` — typed fetch client: `request('GET /users/:id', { params, query, body })`, `url()`, `ClientRequestError` untuk non-2xx
- [x] Unit test: isi file generated + round-trip request/params/query/body/error — 6 test baru (`tests/client.test.ts`)
- [x] README section "Typed client" + caveat Response passthrough
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 273 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
