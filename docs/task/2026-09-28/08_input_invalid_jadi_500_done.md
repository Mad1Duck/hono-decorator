# Task 08: Input malformed menghasilkan 500, bukan 400

- File: `src/decorators/param.ts` (baris ~22, ~92-99)
- Masalah:
  1. `Body()` → `c.req.json()` melempar `SyntaxError` pada JSON invalid → 500 (harusnya 400).
  2. `parseCookies()` → `decodeURIComponent` throw `URIError` pada cookie berisi `%` malformed → 500.
  3. `parseCookies`: cookie tanpa `=` (`eq === -1`) → `slice(0, -1)` memotong karakter terakhir nama.

## Solusi yang diimplementasi

- `Body()`: parse error di-map ke `HttpException.badRequest('Invalid JSON body')` → 400.
- `parseCookies`: `decodeURIComponent` dalam try/catch (fallback raw value); `eq === -1` → value `''`.

## Checklist

- [x] Wrap `c.req.json()` — parse error → `HttpException.badRequest`
- [x] `decodeURIComponent` dalam try/catch — fallback raw value
- [x] Handle `eq === -1` (valueless cookie)
- [x] Unit test: body JSON rusak → 400 `BAD_REQUEST`; cookie `%ZZ` tidak crash; cookie tanpa `=` → `''`
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28

## Status

- [x] Completed
