# In-process event bus — @OnEvent + events.emit()

**File:** `src/core/events.ts` (baru), `src/decorators/metadata.ts` (key ON_EVENT), `src/decorators/events.ts` (baru)

## Masalah

Decoupling aksi sampingan (email, audit, cache invalidation) dari controller
harus manual — tidak ada pub/sub in-process untuk domain events.

## Checklist

- [x] `@OnEvent(eventName)` method decorator → metadata `ON_EVENT`
      (`Record<methodName, eventName>`); repeatable? satu event per method v1
- [x] `events.emit(name, payload)` — dispatch async ke semua subscriber;
      tiap listener di-`try/catch` sendiri (satu gagal tidak memutus lainnya);
      emit tidak throw (error listener → log via getLogger)
- [x] `startEventBus(moduleOrClasses)` — scan metadata method, resolve
      instance via container (DI penuh, termasuk @Singleton/@RequestScoped? —
      request-scoped: skip atau resolve tanpa scope → dokumentasi batasan)
- [x] Unregister/cleanup saat `container.shutdown()` (listener map dikaitkan
      ke lifecycle — atau expose `stopEventBus()`)
- [x] Test: emit → subscriber dipanggil; listener throw → listener lain tetap
      jalan; payload passing
- [x] README: section Events

## Status

Done — 298 tests passing, type-check and build green.
