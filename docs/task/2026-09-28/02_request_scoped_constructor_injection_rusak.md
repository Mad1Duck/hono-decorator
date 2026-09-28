# Task 02: @RequestScoped tidak bisa di-inject via constructor

- File: `src/core/route-builder.ts` (baris ~119), `src/core/container.ts` (baris ~66)
- Masalah: `container.resolve(ControllerClass)` dipanggil sekali saat `build()`, di luar request context. Konsekuensi:
  - Controller `@RequestScoped` → throw `DependencyResolutionError` saat build.
  - Service `@RequestScoped` di-inject ke constructor controller singleton → throw saat build.
  - Efektif `@RequestScoped` hanya jalan kalau consumer `container.resolve()` manual di dalam handler — bertentangan dengan klaim README "fresh instance per request".

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Injectable() @RequestScoped()
class ReqSvc { id = crypto.randomUUID(); }

@Controller('/a') @Injectable([ReqSvc])
class CtrlA { constructor(private s: ReqSvc) {} @Get() x() { return this.s.id; } }

HonoRouteBuilder.build(CtrlA); // THROWS: 'ReqSvc' is @RequestScoped but no active request scope
```

## Checklist

- [ ] Tentukan pendekatan: lazy-resolve controller per request, atau lazy-resolve hanya dep `@RequestScoped` (proxy/factory)
- [ ] Implementasi per request di dalam `runInRequestContext`/`runInScope`
- [ ] Pastikan `onDestroy` request-scoped tetap dipanggil di akhir request
- [ ] Tambah regression test: controller singleton + dep request-scoped → instance beda antar request
- [ ] Update README section `@RequestScoped` dengan cara kerja sebenarnya
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
