# Task 07: Class middleware di-instantiate 2x di normalize()

- File: `src/decorators/middleware.ts` (baris ~15)
- Masalah: `new m().use.bind(new m())` — `new m()` dipanggil dua kali; `use` di-bind ke instance ke-2, instance ke-1 dibuang.

## Checklist

- [x] Ganti ke `const instance = new m(); return instance.use.bind(instance);`
- [x] Unit test: middleware class dengan counter di constructor → assert dipanggil 1x
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
