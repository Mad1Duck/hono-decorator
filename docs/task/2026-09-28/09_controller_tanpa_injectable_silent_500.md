# Task 09: Controller dengan constructor params tapi tanpa @Injectable → TypeError saat request

- File: `src/core/container.ts` (`resolveViaConstructor`, baris ~132), `src/core/route-builder.ts` (baris ~119)
- Masalah: class tanpa `@Injectable` punya `INJECT_PARAMS = []` → `new target()` tanpa arg → dep `undefined` → `TypeError` di request time (500). Tidak ada sinyal saat build.

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Controller('/d')           // lupa @Injectable([ReqSvc])
class CtrlD { constructor(private s: ReqSvc) {} @Get() x() { return this.s.id; } }
// → 500 "undefined is not an object (evaluating 'this.s.id')"
```

## Checklist

- [ ] Saat resolve/build: jika `target.length > 0` (constructor punya param) dan tidak ada `INJECT_PARAMS` → throw error jelas ("did you forget @Injectable([...])?") atau minimal warning
- [ ] Lebih baik gagal saat `build()` daripada saat request pertama
- [ ] Tambah regression test
- [ ] Dokumentasikan di README bahwa `@Injectable` wajib untuk constructor injection
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
