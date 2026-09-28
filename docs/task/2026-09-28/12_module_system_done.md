# Task 12: `@Module` system untuk grouping controller + provider

- File: `src/core/` (module registry baru), `src/decorators/` (`@Module`), `src/index.ts`
- Masalah: semua registrasi & config global via `HonoRouteBuilder.configure()` — tidak ada grouping, tidak ada isolation antar fitur, dan static global config mencegah dua app dengan config berbeda (temuan audit).

## Deskripsi fitur

```ts
@Module({
  controllers: [UserController],
  providers: [UserService],
  imports: [SharedModule],
})
class UserModule {}
```

`HonoRouteBuilder.buildModule(UserModule)` resolve providers + controllers dalam scope module. Pertimbangan: apakah module punya config sendiri (guardExecutor, rateLimiter per-module) atau tetap global — putuskan dan dokumentasikan.

## Checklist

- [x] `@Module({ controllers, providers, imports })` decorator (`src/decorators/module.ts`, key `MODULE`)
- [x] `HonoRouteBuilder.buildModule()` — traverse `imports` rekursif + dedupe via Set; controllers lewat `build()` biasa
- [x] `providers` di-resolve eager untuk fail-fast DI (`@RequestScoped` di-skip); entry non-`@Controller` → error jelas; non-`@Module` class → error jelas
- [x] Keputusan: config tetap global (`configure()`) — didokumentasikan di JSDoc + README
- [x] Unit test: module + imported controllers serve routes; provider DI error saat build; error non-module/non-controller — 3 test baru
- [x] README section "Modules"
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 267 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
