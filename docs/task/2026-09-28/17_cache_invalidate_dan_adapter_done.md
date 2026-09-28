# Task 17: `@CacheInvalidate` + pluggable cache adapter

- File: `src/core/route-builder.ts`, `src/decorators/interceptor.ts`, `src/decorators/metadata.ts`, `src/core/` (cache adapter interface baru)
- Masalah: `@Cache` baru saja diimplementasi (task 05) tapi belum ada invalidation — mutation route tidak bisa membersihkan cache; store in-memory tidak bisa diganti Redis.

## Deskripsi fitur

```ts
@Get() @Cache({ ttl: 60_000, key: 'user-list' })
list() { ... }

@Post() @CacheInvalidate('user-list:*')   // wildcard prefix invalidation
create() { ... }
```

Plus interface `CacheAdapter { get, set, delete, deletePattern }` — default `InMemoryCacheAdapter`, bisa swap via `HonoRouteBuilder.configure({ cacheAdapter })`. Invalidation jalan *setelah* handler sukses (bukan sebelum).

## Checklist

- [x] `CacheAdapter` interface + `InMemoryCacheAdapter` default (`src/core/cache.ts`, export via barrel)
- [x] Refactor route cache task 05 ke adapter (`RouteBuilderConfig.cacheAdapter`)
- [x] `@CacheInvalidate(...patterns)` decorator + `METADATA_KEYS.CACHE_INVALIDATE` + invalidasi prefix setelah handler sukses
- [x] Unit test: invalidation setelah mutation; prefix tidak menyentuh key lain — 2 test baru (adapter swap diuji via `configure()` path yang sama; default adapter dipakai test)
- [x] README update section `@Cache` + `@CacheInvalidate` + `cacheAdapter`
- [x] `describe()` ikut expose `cacheInvalidate`
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 249 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
