# Request context public API — getRequestContext() / getContext()

**File:** `src/core/request-context.ts`, `src/index.ts` (export)

## Masalah

AsyncLocalStorage request context sudah dipakai internal (traceId, memoCache,
diScope) tapi tidak di-expose ke user. Pertanyaan umum: "gimana akses
traceId / request info di service tanpa prop-drilling?" — sekarang harus lewat
parameter eksplisit.

## Checklist

- [x] Export `getRequestContext()` — mengembalikan `RequestContext | undefined`
      (undefined di luar request — jangan throw; kembalikan undefined + dokumentasi)
- [x] Tambahkan `traceId` accessor publik sudah ada (`getTraceId`) — pastikan
      konsisten; pertimbangkan `getContext()` helper untuk Hono Context aktif
      jika context menyimpan `c` (cek: request-context saat ini menyimpan
      traceId + memoCache + diScope — tambahkan `c: Context` opsional di
      createRequestContext/route-builder agar getContext() bisa jalan)
- [x] Test: dipanggil di dalam handler (route) dan dari service via DI
- [x] README: section kecil di Observability / Context helpers

## Status

Done — 298 tests passing, type-check and build green.
