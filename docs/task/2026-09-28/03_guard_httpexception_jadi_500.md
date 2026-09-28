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

## Checklist

- [ ] Cek `error instanceof HttpException` dulu di guardMw — kembalikan status/code aslinya
- [ ] Atau bungkus `guardMw` dengan `wrapMiddleware` agar pipeline error konsisten
- [ ] Hapus/pertahankan string-matching `Unauthorized`/`Forbidden` hanya sebagai fallback untuk `Error` biasa
- [ ] Tambah regression test: executor throw `HttpException(401)`, `HttpException(403)`, `Error('Unauthorized')`
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
