# API versioning — @Controller(..., { version }) 

**File:** `src/decorators/controller.ts`, `src/core/route-builder.ts`, `src/decorators/metadata.ts`

## Masalah

Tidak ada cara deklaratif mem-version controller — harus manual prefix path
(`@Controller('/v2/users')`) yang tersebar di mana-mana.

## Checklist

- [x] `ControllerOptions` tambah `version?: string` → metadata `CONTROLLER`
      menyimpan version; route path efektif = `/{version}{basePath}{route.path}`
      (normalisasi slash: 'v2' atau '/v2' → '/v2')
- [x] `describe()` / `printRoutes()` menampilkan path yang sudah di-version
- [x] OpenAPI generator pakai path final (otomatis kalau describe benar)
- [x] Versi di class-level menang, tidak ada per-method override v1
- [x] Test: dua controller version berbeda koeksis di path berbeda
- [x] README: subsection di `@Controller`

## Status

Done — 298 tests passing, type-check and build green.
