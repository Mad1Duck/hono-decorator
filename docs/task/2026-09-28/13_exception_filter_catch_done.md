# Task 13: Exception filter `@Catch()`

- File: `src/decorators/` (decorator baru), `src/core/route-builder.ts` (error pipeline), `src/decorators/metadata.ts`
- Masalah: error handling saat ini hanya `onError` global via `configure()`. Tidak ada cara memetakan exception-type tertentu ke response secara deklaratif (NestJS punya `@Catch` filters).

## Deskripsi fitur

```ts
@Catch(PrismaClientKnownError)
class DbErrorFilter {
  catch(err: unknown, c: Context) { return c.json({ error: 'db' }, 500); }
}

@Controller('/users')
@UseFilters(DbErrorFilter)   // class-level dan/atau method-level
class UserController {}
```

Filter di-resolve via container (bisa inject service). Urutan: method-level → class-level → `onError` global → default HttpException handling.

## Checklist

- [x] `@Catch(...ErrorTypes)` class decorator + `@UseFilters(...)` decorator (`src/decorators/filters.ts`, keys `CATCH`/`EXCEPTION_FILTERS`/`METHOD_EXCEPTION_FILTERS`)
- [x] Integrasi ke error pipeline — filters jalan pertama di `wrapMiddleware` dan `httpHandler` (method → class → `onError` → `HttpException` default)
- [x] Filter resolve via `container.resolve` (support `@Injectable` DI)
- [x] Unit test: 4 test (method match, class catch-all, void fall-through, DI filter)
- [x] README section "Exception filters"
- [x] Verifikasi `bun run type-check` / `bun test` — 253 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
