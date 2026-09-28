# Task 03: HttpException dari guardExecutor jadi 500

- File: `src/core/route-builder.ts` (baris ~233-243)
- Masalah: catch di `guardMw` memetakan error via `error.message.includes('Unauthorized'|'Forbidden')`. `HttpException(401, 'Token expired')` tidak match pola string → rethrow → Hono default error → 500.
- Juga: `guardMw` tidak dibungkus `wrapMiddleware`, jadi `ZodError`/`HttpException`/`onError` pipeline tidak berlaku untuk guard.

## Reproduksi (terverifikasi 2026-09-28)

```ts
HonoRouteBuilder.configure({
  guardExecutor: async () => { throw new HttpException(401, 'Token expired'); },
});
// GET /g → 500 Internal Server Error (harusnya 401)
```

## Solusi yang diimplementasi

- `guardMw` kini rethrow `HttpException` apa adanya (bukan string-matching), lalu dibungkus `wrapMiddleware` → HttpException menghasilkan status + body terstruktur, `onError` tetap dipanggil, `ZodError` → 400. String-matching `Unauthorized`/`Forbidden` dipertahankan sebagai fallback untuk `Error` biasa.

## Checklist

- [x] Cek `error instanceof HttpException` dulu di guardMw — kembalikan status/code aslinya
- [x] `guardMw` dibungkus `wrapMiddleware` — pipeline error konsisten (onError, ZodError, HttpException)
- [x] String-matching `Unauthorized`/`Forbidden` dipertahankan sebagai fallback untuk `Error` biasa
- [x] Regression test: `HttpException(401)`, `HttpException(403)`, `onError` dipanggil — 3 test baru
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 233 tests hijau

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
