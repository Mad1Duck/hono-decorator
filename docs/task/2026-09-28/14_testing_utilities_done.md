# Task 14: Testing utilities — `createTestingModule()` / override provider

- File: `src/core/testing.ts` (baru), `src/core/container.ts`, `src/index.ts`
- Masalah: framework DI tanpa helper testing — consumer harus utak-atik `container` global manual untuk mock dependencies; tidak ada cara resolve controller terisolasi untuk unit test.

## Deskripsi fitur

```ts
const module = await createTestingModule({ controllers: [UserController] })
  .overrideProvider(UserService).useValue(mockService)
  .compile();

const ctrl = module.get(UserController);           // unit test langsung
const app = module.createApp();                     // atau app Hono penuh (e2e)
await module.cleanup();                             // destroy + restore container
```

Syarat: snapshot/restore state container global agar test tidak saling bocor; tidak import `bun:test` (harus framework-agnostic — jalan juga di vitest/node:test).

## Checklist

- [ ] API `createTestingModule` + `overrideProvider`/`useValue`/`useClass`
- [ ] Snapshot & restore container state di `cleanup()`
- [ ] `module.createApp()` shortcut ke `HonoRouteBuilder.build`
- [ ] Unit test: override bekerja, restore tidak bocor, request-scoped tetap jalan
- [ ] README section "Testing"
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: fitur proposal session 2026-09-28

## Status

- [ ] Pending
