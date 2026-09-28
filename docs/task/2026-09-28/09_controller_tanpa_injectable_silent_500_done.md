# Task 09: Controller dengan constructor params tapi tanpa @Injectable → TypeError saat request

- File: `src/core/container.ts` (`resolveViaConstructor`, baris ~132)
- Masalah: class tanpa `@Injectable` punya `INJECT_PARAMS = []` → `new target()` tanpa arg → dep `undefined` → `TypeError` di request time (500).

## Solusi yang diimplementasi

- `resolveViaConstructor`: jika `tokens.length === 0 && target.length > 0` → `DependencyResolutionError` dengan pesan "Did you forget @Injectable([...])?" — gagal saat `build()`/resolve, bukan saat request pertama.

## Checklist

- [x] Deteksi `target.length > 0` tanpa `INJECT_PARAMS` → throw error jelas saat resolve/build
- [x] Regression test: assert `DependencyResolutionError` dengan hint @Injectable; class tanpa param tetap resolve
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
