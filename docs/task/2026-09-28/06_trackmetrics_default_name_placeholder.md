# Task 06: @TrackMetrics default metric name menghasilkan "?.method"

- File: `src/decorators/interceptor.ts` (baris ~25)
- Masalah: `` options?.name ?? `?.${String(context.name)}` `` — default literal `?.list` dst. Kemungkinan placeholder yang tidak sempat diisi class name (`context` method decorator tidak expose nama class langsung).

## Checklist

- [ ] Tentukan default name yang benar: `methodName`, atau `ClassName.methodName` (baca `context.metadata`/nama class bila tersedia)
- [ ] Implementasi fix
- [ ] Tambah unit test yang assert metric name default (saat ini test mungkin tidak cover ini)
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
