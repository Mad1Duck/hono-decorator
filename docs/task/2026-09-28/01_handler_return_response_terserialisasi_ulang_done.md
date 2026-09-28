# Task 01: Handler yang return Response di-wrap ulang jadi JSON rusak

- File: `src/core/route-builder.ts` (baris ~336)
- Masalah: `return result !== undefined ? c.json(result) : c.body(null)` — jika handler mengembalikan `Response` (misal `c.json()`, `c.redirect()`, `c.html()`), objek Response ikut diserialisasi oleh `c.json(result)`.

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Get('/json') j(c: Context) { return c.json({ ok: true }); }   // → 200 "{}" (harusnya {"ok":true})
@Get('/redir') r(c: Context) { return c.redirect('/x'); }      // → 200 + text, bukan 302
```

## Checklist

- [x] Tambahkan passthrough `result instanceof Response` sebelum `c.json(result)`
- [x] Putuskan perilaku untuk `undefined` — dipertahankan `c.body(null)` → 200 kosong (non-breaking)
- [x] Tambah unit test: handler return `c.json`, `c.redirect`, `c.text`, `Response` mentah — 3 test baru di `tests/route-builder.test.ts` (describe `response`)
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — semua hijau (224 tests)
- [x] Update README — catatan "Return values" ditambahkan di section "Building routes"

- Referensi: audit session 2026-09-28; `src/core/route-builder.ts` httpHandler

## Status

- [x] Completed
