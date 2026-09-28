# Task 18: Route introspection — `HonoRouteBuilder.describe()`

- File: `src/core/route-builder.ts`, `src/index.ts`
- Masalah: tidak ada cara programmatic melihat route apa yang terdaftar dari suatu controller — berguna untuk debugging, test assertions, dan tooling (generator client task 11 juga bisa consume ini).

## Deskripsi fitur

```ts
const routes = HonoRouteBuilder.describe(UserController);
// [{ method: 'get', path: '/users', handlerName: 'list', guards: [...],
//    middlewares: [...], isPublic: false, cache: { ttl }, sse: false, ws: false }]
```

Pure metadata read — tidak instantiate controller, tidak build app. Ini juga fondasi untuk task 11 (typed client) dan task 15 (OpenAPI).

## Checklist

- [x] `describe()` static method — baca semua metadata keys
- [x] Return type `RouteDescription[]` yang exported (via `core/index` barrel)
- [x] Unit test: field lengkap per route (guards, middleware, cache, sse/ws, private/public) — 3 test baru, controller tidak di-instantiate
- [x] README section singkat (Introspection di Building routes)
- [x] Verifikasi `bun run type-check` / `bun test` — 247 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
