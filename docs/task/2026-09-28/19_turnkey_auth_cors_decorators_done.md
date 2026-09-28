# Task 19: Turnkey decorators `@JwtAuth()` dan `@Cors()`

- File: `src/decorators/` (file baru), `src/core/route-builder.ts`, `package.json` (peer dep check), `src/index.ts`
- Masalah: auth & CORS adalah kebutuhan paling umum tapi sekarang harus rakit sendiri via `guardExecutor` / `@Middleware` manual.

## Deskripsi fitur

```ts
@Controller('/api')
@Cors({ origin: ['https://app.example.com'] })
class ApiController {
  @Get('/me')
  @JwtAuth({ secret: env.JWT_SECRET })   // wrap hono/jwt
  me(c: Context) { return User(c); }
}
```

`@JwtAuth` = built-in guard berbasis `hono/jwt` (peer dep `hono` sudah ada → zero deps baru); auto-set `c.set('user', payload)` supaya `User(c)` langsung jalan. `@Cors` = wrapper `hono/cors` sebagai middleware. Pertimbangan: `@JwtAuth` harus tetap bisa coexist dengan `guardExecutor` custom — putuskan precedence.

## Checklist

- [x] `@JwtAuth({ secret, alg? })` — wrap `hono/jwt`, `alg` default `HS256` (hono mewajibkan alg eksplisit → pakai tipe `JwtAuthOptions` dengan alg optional), set `jwtPayload` → `c.set('user', payload)` supaya `User(c)` langsung jalan, 401 on fail
- [x] `@Cors` — **sudah ada** di `common-middleware.ts` (bersama `@Compress`, `@SecureHeaders`, `@PrettyJson`); tidak perlu diimplementasi ulang
- [x] Integrasi via `Middleware()` — masuk `METHOD_MIDDLEWARES`/`MIDDLEWARES` seperti middleware lain (bukan bypass guard pipeline)
- [x] Unit test: token valid (payload via `User(c)`), token hilang/invalid → 401
- [x] README section `@JwtAuth` di Built-in middleware decorators
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 262 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
