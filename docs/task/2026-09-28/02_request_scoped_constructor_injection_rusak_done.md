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

## Solusi yang diimplementasi

- `container.ts`: `resolveViaConstructor` kini menginject **lazy proxy** (`createRequestScopedProxy`) untuk token yang `@RequestScoped` — instance asli di-resolve per property access di dalam request scope aktif, sehingga singleton tidak pernah menangkap instance stale. Akses di luar request throw `DependencyResolutionError`.
- `route-builder.ts`: controller `@RequestScoped` tidak lagi di-resolve eager saat `build()` — di-resolve per request via `getController()` di dalam `runInScope` (HTTP + SSE) dan `runInRequestContext` (WS).

## Checklist

- [x] Tentukan pendekatan — lazy proxy untuk dep request-scoped; controller request-scoped di-resolve per request
- [x] Implementasi per request di dalam `runInRequestContext`/`runInScope`
- [x] Pastikan `onDestroy` request-scoped tetap dipanggil di akhir request — tercover test "destroys request-scoped deps at end of request"
- [x] Tambah regression test — 4 test di `route-builder.test.ts` + 2 test di `container.test.ts` (proxy per-scope, error di luar scope)
- [x] Update README section `@RequestScoped` — lazy proxy, request-scoped controller, caveat WS
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 230 tests hijau

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
