# Scheduled/interval methods — @Interval / startScheduler

**File:** `src/decorators/schedule.ts` (baru), `src/core/scheduler.ts` (baru), metadata key SCHEDULE

## Masalah

Cleanup job / metrics flush / cache warmup butuh setInterval manual yang
terpisah dari DI lifecycle — tidak berhenti saat shutdown.

## Checklist

- [x] `@Interval(ms, options?)` method decorator → metadata; option
      `{ immediate?: boolean, name?: string }`
- [x] `startScheduler(moduleOrClasses)` — scan metadata, resolve via container,
      jalankan `setInterval` per method; overlap guard: skip run baru kalau
      run sebelumnya masih jalan (promise-based)
- [x] Timer di-clear saat `container.shutdown()` — daftarkan cleanup;
      `timer.unref?.()` agar tidak menahan exit di non-server usage
- [x] Error di job → log via getLogger, tidak crash loop
- [x] Test: interval pendek → dipanggil N kali; overlap skip; stop bersih
- [x] README: section Scheduler

## Status

Done — 298 tests passing, type-check and build green.
