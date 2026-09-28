# Panduan Pengerjaan Task

## Konvensi Nama File

Setiap task disimpan di folder `docs/task/YYYY-MM-DD/` dengan format:

```
NN_deskripsi_singkat[_done].md
```

- `NN` — nomor urut (contoh: `01`, `02`, …)
- `deskripsi_singkat` — deskripsi singkat isu atau fitur, pakai snake_case
- `_done` — **suffix opsional** yang ditambahkan saat task sudah selesai semua checklist-nya
- `.md` — ekstensi wajib
- Tanggal dalam path menunjukkan kapan task dibuat atau teridentifikasi.

Contoh aktif: `docs/task/2026-09-28/01_guard_dieksekusi_sebelum_middleware.md`  
Contoh selesai: `docs/task/2026-09-28/02_ws_channel_tidak_broadcast_done.md`

## Isi Tiap Task

Tiap file task berisi:

1. Judul task atau ringkasan masalah.
2. Detail isu yang ditemukan *(jangan langsung memperbaiki kode kecuali diminta)*.
3. File dan baris yang terkait.
4. Petunjuk perbaikan atau pertanyaan yang harus dijawab.

## Cara Menggunakan Rule Prompt

Rule prompt di bawah ini bersifat **opsional** dan hanya dipakai saat task memerlukan analisis mendalam. Jangan pakai sebagai konteks default untuk setiap task.

| Kapan dipakai | Prompt |
|---------------|--------|
| Perubahan build/release/tooling atau mengecek konvensi repo | Prompt 1 |
| Memahami alur request, metadata decorator, atau life-cycle DI container | Prompt 2 |
| Menganalisis race condition, idempotensi, atau konsistensi di satu file | Prompt 3 |

Jika task bersifat implementasi langsung (bug fix, fitur, refactor), cukup baca task file, role, dan file terkait — tidak perlu memasukkan prompt 1/2/3.

---

### Prompt 1: Memahami konfigurasi repo, CI, dan tooling

```text
Ini konfigurasi repo: package.json, tsup.config.ts, tsconfig.json,
dan .release-it.json. Jangan usulkan perubahan apa pun. Jawab ringkas
dan sebut nama file.

1. Script apa saja yang didefinisikan di package.json, dan apa yang
   masing-masing jalankan? Mana yang wajib hijau sebelum release?
2. Unit test: runner apa, pola file mana yang diambil, bagaimana
   menjalankan SATU file saja?
3. Build: apa yang dihasilkan tsup (format, dts, external)?
   Artefak mana yang masuk ke package npm (`files` di package.json)?
4. Apa yang dilakukan release-it saat `bun run release` — version bump,
   changelog, tag, publish? Apa syaratnya (clean working dir, dsb)?
5. Konvensi apa yang terlihat dipaksakan oleh tooling — target esbuild,
   tsconfig strict flags, peerDependencies vs devDependencies?
6. File apa yang JANGAN disentuh karena hasil generate atau
   dikelola tooling (dist/, bun.lock, CHANGELOG.md)?
```

### Prompt 2: Memahami public API dan kodebase

```text
Kamu membantuku memahami kodebase library ini, bukan memperbaikinya.
Jangan sarankan perubahan apa pun.

Jawab ringkas:
1. Titik masuk public API: decorator, class, dan fungsi apa saja yang
   diekspor lewat src/index.ts?
2. Bagaimana metadata decorator mengalir: dari @Controller/@Get sampai
   route terdaftar di Hono? File mana yang membaca Symbol.metadata?
3. Bagaimana DI container me-resolve controller: scope, deps, lifecycle?
4. Bagian mana yang pluggable (guard executor, rate limiter, WS upgrader,
   channel adapter, logger, onError) dan lewat opsi apa?
5. Bagian mana yang berjalan konkuren atau asinkron (SSE stream, WS,
   request-scoped container)?
6. Apa 3 asumsi implisit yang kalau dilanggar consumer akan merusak
   library ini?

Sebut nama file untuk tiap jawaban.
```

### Prompt 3: Analisis konkurensi, idempotensi, dan konsistensi

```text
Ini kode dari <file>. Jangan tulis perbaikan.

Untuk tiap jalur tulis di kode ini, jawab:

1. Kalau dua request/worker menjalankan ini BERSAMAAN untuk entitas yang sama,
   urutan interleaving mana yang menghasilkan keadaan salah?
   Tulis urutannya langkah per langkah.

2. Kalau proses mati TEPAT DI ANTARA dua statement, keadaan mana yang
   tertinggal setengah jadi? State mana (container, registry, metadata)
   yang jadi tidak konsisten?

3. Kalau operasi ini dijalankan DUA KALI dengan input identik,
   hasilnya sama atau berbeda? Apa yang menjamin itu?

4. Jaminan urutan apa yang diasumsikan kode ini, dan apa yang
   sebenarnya dijamin oleh transport/DB-nya?

Kalau jawabannya "aman", sebutkan mekanisme spesifik yang mengamankannya
(immutability, scoping, idempotensi, cleanup) — jangan bilang aman tanpa
menunjuk mekanismenya.
```

> Ganti `<file>` pada Prompt 3 dengan path file yang sedang dianalisis.
