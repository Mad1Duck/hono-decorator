# Task 06: @TrackMetrics default metric name menghasilkan "?.method"

- File: `src/decorators/interceptor.ts` (baris ~25)
- Masalah: `` options?.name ?? `?.${String(context.name)}` `` — default literal `?.list` dst. Placeholder yang tidak sempat diisi class name.

## Solusi yang diimplementasi

- Nama class ditangkap via `context.addInitializer` (`this` = instance untuk method non-static, class untuk static) → default `ClassName.method`; fallback `methodName` kalau belum ter-init.

## Checklist

- [x] Default name benar: `ClassName.methodName` via `addInitializer`; fallback `methodName`
- [x] Implementasi fix
- [x] Unit test assert metric name default (`Svc.work`)
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
