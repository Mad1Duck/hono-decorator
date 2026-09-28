# Task 05: @Cache adalah no-op — tulis metadata tapi tidak ada yang baca

- File: `src/decorators/interceptor.ts` (baris ~13), `src/decorators/metadata.ts` (`METADATA_KEYS.CACHE`)
- Masalah: `@Cache({ ttl, key })` hanya menulis metadata; tidak ada konsumer di `route-builder.ts` atau di mana pun. README mencantumkannya di fitur "Interceptors" — misleading.
- Catatan: `@Memoize` di `custom.ts` sudah implementasi caching nyata — fungsinya overlap.

## Checklist

- [ ] Putuskan: implementasi caching di route-builder ATAU hapus `@Cache` dan andalkan `@Memoize`
- [ ] Jika implement: bungkus handler dengan cache lookup (key = serialized args, respect ttl, scope global/request?)
- [ ] Jika hapus: hapus decorator + `METADATA_KEYS.CACHE` + section README + test terkait (breaking change → minor/major note)
- [ ] Tambah/update unit test sesuai keputusan
- [ ] Update README agar akurat
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
