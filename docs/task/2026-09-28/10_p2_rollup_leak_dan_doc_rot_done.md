# Task 10: (P2) Channel leak, doc rot, dan hardening kecil

- File: `src/channels/*`, `src/utils/discover.ts`, `src/utils/request.ts`, `src/utils/pagination.ts`, `src/channels/registry.ts`, `src/openapi/generator.ts`, `src/core/route-builder.ts`, `src/core/container.ts`, `src/decorators/param.ts`, `package.json`
- Masalah: kumpulan temuan prioritas rendah dari audit.

## Checklist

- [x] `redis.adapter.ts` + `memory.adapter.ts`: `send()` dibungkus try/catch per-client (satu client gagal tidak menghentikan publish ke subscriber lain); redis `handleMessage` menghapus channel kosong + `sub.unsubscribe`; `subscribe()` rollback `localClients` jika `sub.subscribe` throw
- [x] `unsubscribe(channel, clientId)` menghapus semua client dengan id itu (bukan match pertama saja) di kedua adapter
- [x] `discover.ts`: `import()` via `pathToFileURL`; JSDoc mencatat pola `cwd`-relatif (leading `./` tidak match)
- [x] `route-builder.ts`: trailing-slash redirect → 301 untuk GET/HEAD, 308 untuk method lain (method + body dipertahankan)
- [x] `request.ts`: `extractIp` JSDoc mendokumentasikan caveat trust proxy header
- [x] `container.shutdown()` kini clear `singletons` + `factories`; `runInScope` menghapus instance yang di-destroy dari `diScope`
- [x] `generator.ts`: `operationId` kini `${method}_${ControllerClass}_${handlerName}` (unik antar-controller); regex path mendukung Hono regex param `:id{[0-9]+}`; Scalar CDN di-pin ke `@1.72.1`
- [x] `node:async_hooks` → keyword `edge` dihapus dari `package.json` (library memang belum edge-compatible)
- [x] Doc rot: JSDoc `pagination.ts` pakai syntax `ValidatedQuery(c, schema)` baru; `registry.ts` `hono-decorators` → `hono-forge`
- [x] `Res` di `param.ts` ditandai `@deprecated` (alias `Ctx` — rename langsung breaking)
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 244 tests hijau

## Sengaja tidak diubah

- `METADATA_KEYS.VALIDATION`/`CUSTOM`/`INJECTABLE` yang tidak dibaca — dibiarkan (bagian public API yang di-export; menghapus = breaking)
- `discoverControllers` tetap Bun-only — sudah didokumentasikan; Node pakai `fromModules()`
- `HonoRouteBuilder.config` static global — refactor ke instance config adalah perubahan API besar, di luar scope P2

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
