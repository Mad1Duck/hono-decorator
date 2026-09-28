# Task 01: Handler yang return Response di-wrap ulang jadi JSON rusak

- File: `src/core/route-builder.ts` (baris ~336)
- Masalah: `return result !== undefined ? c.json(result) : c.body(null)` — jika handler mengembalikan `Response` (misal `c.json()`, `c.redirect()`, `c.html()`), objek Response ikut diserialisasi oleh `c.json(result)`.

## Reproduksi (terverifikasi 2026-09-28)

```ts
@Get('/json') j(c: Context) { return c.json({ ok: true }); }   // → 200 "{}" (harusnya {"ok":true})
@Get('/redir') r(c: Context) { return c.redirect('/x'); }      // → 200 + text, bukan 302
```

## Checklist

- [ ] Tambahkan passthrough `result instanceof Response` sebelum `c.json(result)`
- [ ] Putuskan perilaku untuk `undefined` (saat ini `c.body(null)` → 200 kosong; pertimbangkan 204)
- [ ] Tambah unit test: handler return `c.json`, `c.redirect`, `c.text`, `Response` mentah
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`
- [ ] Update README jika ada catatan "handler harus return plain value"

- Referensi: audit session 2026-09-28; `src/core/route-builder.ts` httpHandler
