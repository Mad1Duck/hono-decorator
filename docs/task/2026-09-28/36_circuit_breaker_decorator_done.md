# @CircuitBreaker — resilience untuk service method

**File:** `src/decorators/resilience.ts` (baru) atau `interceptor.ts`

## Masalah

Call eksternal yang failing menumpuk timeout; tidak ada fast-fail mechanism
di framework.

## Checklist

- [x] `@CircuitBreaker({ failureThreshold, resetAfterMs, onError? })` —
      method decorator wrap: state closed → call; consecutive failures >=
      threshold → open → throw instan `HttpException(503)` (atau custom error
      type `CircuitOpenError`); setelah resetAfterMs → half-open (1 probe
      call; sukses → close, gagal → open lagi)
- [x] State per-method-per-instance (WeakMap seperti @Throttle)
- [x] `onError?(error)` hook untuk observability saat circuit open
- [x] Test: N failure → call berikutnya fast-fail tanpa invoke; probe sukses
      menutup circuit
- [x] README: section Interceptors

## Status

Done — 298 tests passing, type-check and build green.
