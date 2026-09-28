# Task 10: (P2) Channel leak, doc rot, dan hardening kecil

- File: `src/channels/*`, `src/utils/discover.ts`, `src/utils/request.ts`, `src/utils/pagination.ts`, `src/utils/schema.ts`, `src/channels/registry.ts`, `src/openapi/generator.ts`, `src/core/route-builder.ts`, `src/core/container.ts`
- Masalah: kumpulan temuan prioritas rendah dari audit.

## Checklist

- [ ] `redis.adapter.ts`: `handleMessage` tidak `localClients.delete` + `sub.unsubscribe` saat channel kosong → leak; `send()` yang throw menghentikan publish ke subscriber lain (berlaku juga `memory.adapter.ts` — wrap per-client try/catch)
- [ ] `memory.adapter.ts`: `unsubscribe` by `client.id` hapus match pertama saja — dua koneksi dengan id sama bisa salah hapus
- [ ] `discover.ts`: pakai `pathToFileURL` untuk `import()`; pattern leading `.` silently return 0 — dokumentasikan atau normalisasi
- [ ] `route-builder.ts`: trailing-slash redirect pakai 301 untuk semua method — POST kehilangan method/body; pakai 307/308 atau skip non-GET
- [ ] `request.ts`: `extractIp` trust `X-Forwarded-For`/`CF-Connecting-IP` tanpa validasi — dokumentasikan caveat rate-limit by-IP atau tambah opsi trustProxy
- [ ] `container.shutdown()` tidak clear map → resolve pasca-shutdown return instance destroyed; `runInScope` destroy tapi tidak delete dari `diScope`
- [ ] `generator.ts`: `operationId` bentrok antar-controller (tambah nama class); regex path pecah untuk Hono regex param `:id{[0-9]+}`; Scalar CDN `@latest` tidak di-pin
- [ ] `node:async_hooks` di `request-context.ts`/`transaction.ts` → tidak jalan di edge runtime; sesuaikan keyword `edge` di package.json atau buat opsional
- [ ] Doc rot: JSDoc `pagination.ts`/`schema.ts` masih syntax param decorator lama (`@ValidatedQuery(...)`); `registry.ts` menyebut `hono-decorators` (nama lama)
- [ ] `METADATA_KEYS.VALIDATION`/`CUSTOM`/`INJECTABLE` tidak pernah dibaca — hapus atau pakai
- [ ] `Res` di `param.ts` alias ke `Ctx` (return Context, bukan Response) — nama misleading
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
