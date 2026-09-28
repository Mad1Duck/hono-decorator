# Typed config + env validation — registerConfig / CONFIG token

**File:** `src/core/config.ts` (baru), `src/index.ts`

## Masalah

Setiap app mem-parsing `process.env` manual dan mengaksesnya longgar
(`process.env.PORT!`). Salah env → error runtime, bukan saat boot.

## Checklist

- [x] `CONFIG` DI token (symbol) + `registerConfig(zodSchema, source?)` —
      parse `source ?? process.env` SEKALI saat boot; throw error jelas
      (list semua field invalid) kalau gagal — fail-fast
- [x] `getConfig<T>()` typed accessor untuk non-DI usage
- [x] Injectable: `@Injectable([CONFIG]) constructor(private cfg: T)`
      — resolve dari container seperti LOGGER
- [x] Default `source` = `process.env`; izinkan override (test/dotenv)
- [x] Test: schema valid → typed value; invalid → throw listing fields;
      inject via constructor
- [x] README: section Config di dependency injection

## Status

Done — 298 tests passing, type-check and build green.
