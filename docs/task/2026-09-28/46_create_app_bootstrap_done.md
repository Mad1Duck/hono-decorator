# Task 46 — `createApp` application bootstrap

## Masalah

Wiring produksi masih manual: `buildModule` + `mountHealth` + `OpenAPIGenerator.mount` + `gracefulShutdown` + `printRoutes` — 4–5 langkah boilerplate di setiap app. Terasa "framework helper", bukan framework.

## Solusi

`src/utils/app.ts` — `createApp(ModuleClass, options)`:

| Opsi | Efek |
|------|------|
| `health` | `mountHealth` — `true` atau `{ path, checks }` |
| `openapi` | `OpenAPIGenerator.mount` satu-call — controllers dikoleksi otomatis dari module (`HonoRouteBuilder.moduleControllers`, API publik baru) |
| `printRoutes` | `HonoRouteBuilder.printRoutes` saat startup |
| `shutdown` | `gracefulShutdown` — `true` atau `{ timeoutMs, onShutdown }` |

`createApp(AppModule)` tanpa opsi setara `buildModule` + `app.route`.

## Verifikasi

- `tests/validate.test.ts` describe `createApp` — routes + `/health` + `/openapi.json` bekerja dalam satu call; mode zero-options.
