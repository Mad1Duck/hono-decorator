# Task 08: Input malformed menghasilkan 500, bukan 400

- File: `src/decorators/param.ts` (baris ~22, ~92-99)
- Masalah:
  1. `Body()` → `c.req.json()` melempar `SyntaxError` pada JSON invalid → 500 (harusnya 400 VALIDATION_ERROR).
  2. `parseCookies()` → `decodeURIComponent` throw `URIError` pada cookie berisi `%` malformed → 500.
  3. `parseCookies`: cookie tanpa `=` (`eq === -1`) → `slice(0, -1)` memotong karakter terakhir nama.

## Checklist

- [ ] Wrap `c.req.json()` — map parse error ke `HttpException.badRequest` (atau ZodError-shaped response konsisten 400)
- [ ] `decodeURIComponent` dalam try/catch — fallback raw value atau skip cookie itu
- [ ] Handle `eq === -1` (valueless cookie) dengan benar
- [ ] Tambah unit test: body JSON rusak → 400; cookie malformed → tidak crash
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`

- Referensi: audit session 2026-09-28
