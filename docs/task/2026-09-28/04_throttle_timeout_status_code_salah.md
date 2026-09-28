# Task 04: @Throttle dan @Timeout melempar 500, bukan status yang benar

- File: `src/decorators/custom.ts` (baris ~24), `src/decorators/interceptor.ts` (baris ~84)
- Masalah: keduanya melempar `Error` biasa → error handler → 500 Internal Server Error.

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Throttle(60_000) → call ke-2 → 500 "Throttled: wait 60000ms"   (harusnya 429)
@Timeout(50)      → timeout  → 500 "Timeout after 50ms"          (harusnya 504 atau 408)
```

## Checklist

- [ ] `@Throttle` throw `HttpException.tooManyRequests()` (429) — sertakan `Retry-After`-style meta bila memungkinkan
- [ ] `@Timeout` throw `HttpException(504, 'Gateway Timeout')` atau 408 — tentukan satu dan konsisten
- [ ] Pertimbangkan: `@Throttle` saat ini keyed `this` (singleton controller) → throttle global lintas user. Dokumentasikan atau tambah opsi keying (per-IP/per-user)
- [ ] Tambah regression test untuk status code keduanya
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
