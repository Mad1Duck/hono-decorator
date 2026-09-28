# Task 05: @Cache adalah no-op — tulis metadata tapi tidak ada yang baca

- File: `src/decorators/interceptor.ts` (baris ~13), `src/decorators/metadata.ts` (`METADATA_KEYS.CACHE`), `src/core/route-builder.ts`
- Masalah: `@Cache({ ttl, key })` hanya menulis metadata; tidak ada konsumer di `route-builder.ts` atau di mana pun.

## Solusi yang diimplementasi (keputusan user: implementasi di route-builder)

- Route-level response cache di `route-builder.ts`: per-route `Map` keyed `${key ?? handlerName}:${pathname}${search}` — path param/query berbeda tidak saling share.
- Cache hit melewati handler sepenuhnya; tetap log via `requestLogger`.
- Hanya hasil non-`Response` dan non-`undefined` yang di-cache; entry expired dihapus saat lookup; prune saat map > 1000 entry.

## Checklist

- [x] Keputusan: implementasi di route-builder (user-approved)
- [x] Implementasi: lookup sebelum `runInScope`, set sesudah handler sukses
- [x] Unit test: hit tidak re-invoke handler; path param berbeda tidak share; ttl expiry
- [x] Update README `@Cache` — sekarang caching nyata, bukan metadata-only
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 244 tests hijau

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
