# Task 04: @Throttle dan @Timeout melempar 500, bukan status yang benar

- File: `src/decorators/custom.ts` (baris ~24), `src/decorators/interceptor.ts` (baris ~84)
- Masalah: keduanya melempar `Error` biasa → error handler → 500 Internal Server Error.

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Throttle(60_000) → call ke-2 → 500 "Throttled: wait 60000ms"   (harusnya 429)
@Timeout(50)      → timeout  → 500 "Timeout after 50ms"          (harusnya 504 atau 408)
```

## Solusi yang diimplementasi

- `@Throttle` → `HttpException.tooManyRequests()` (429) dengan `meta.retryAfterMs`.
- `@Timeout` → `HttpException(504, 'Timeout after Xms')`.
- README didokumentasikan: status code + catatan bahwa throttle di-key per instance (global untuk singleton controller — per-IP pakai `@RateLimit`).

## Checklist

- [x] `@Throttle` throw `HttpException.tooManyRequests()` (429) — `meta.retryAfterMs` disertakan
- [x] `@Timeout` throw `HttpException(504)` — gateway timeout
- [x] Semantik `@Throttle` keyed `this` (global lintas user untuk singleton) → didokumentasikan di README
- [x] Regression test: assert `instanceof HttpException` + status 429/504 + meta
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 235 tests hijau

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
