# AI Setup & Workflow

File ini adalah panduan singkat untuk AI. User hanya perlu menyuruh "baca `SETUP.md`" atau "kerjakan task NN", dan AI wajib mengikuti pola di bawah.

## 1. Perintah yang dipahami

| Perintah user | Arti | Yang harus AI lakukan |
|---------------|------|-----------------------|
| `implement task NN` / `kerjakan task NN` / `selesaikan task NN` | Mengerjakan/mengimplementasikan task | Baca task file → analisa kode terkait → edit source → verify → checklist ijo |
| `create task <deskripsi>` / `buat task` | Membuat task baru | Jangan langsung mengerjakan. Buat file task di `docs/task/YYYY-MM-DD/NN_deskripsi_singkat.md`. |
| `verdict` / `review` / `verdict menurutmu` | Review kode | Jangan edit source. Beri analisis + rekomendasi saja. |
| `draft task` / `buat task dari ini` / user kirim summary atau file attachment | Preview task baru | AI baca input, buat ringkasan, judul, nomor, checklist, rekomendasi, pros/cons; TUNGGU `do it` sebelum buat file. |
| `do it` / `buat` / `ok` | Setujui draft task | AI baru membuat file `docs/task/YYYY-MM-DD/NN_deskripsi.md` dan tambahkan ke todo list. |
| `baca docs/AGENTS.md` | Refresh memori project | Baca `docs/AGENTS.md`, `docs/roles/<role>.md`, dan `docs/rules/01_architecture.md`. |
| `baca docs/SETUP.md` | Setup awal | Baca file ini, `docs/README.md`, lalu siap menerima instruksi berikutnya. |

## 2. Role dan konteks

### Memilih role

- Sebelum mengerjakan task, baca `docs/roles/README.md` dan pilih **satu role** yang paling sesuai domain task.
- Default untuk repo ini adalah `docs/roles/backend.md`.
- AI harus memakai persona, focus, dan constraint di file role tersebut sampai task selesai.
- Jika user tidak menyebut role, tanyakan atau pakai `backend.md`.

### Memory / ingatan project

- AI wajib mengingat struktur repo, aturan `docs/rules/`, dan daftar task yang sedang/sudah dikerjakan.
- Setiap kali ada perubahan signifikan pada project (struktur folder, stack baru, convention baru, task selesai), simpan/update ke memory project.
- Jika user menyuruh "ingat ..." atau "simpan ke memory", gunakan `create_memory` dengan tag `project_setup`, `workflow`, atau `roles`.

## 3. Workflow mengerjakan task

### Saat diminta `implement task NN`:

1. **Baca setup dulu** — `docs/AGENTS.md`, `docs/SETUP.md`, `docs/README.md`, dan `docs/roles/<role>.md`.
2. **Baca task file** — `docs/task/YYYY-MM-DD/NN_deskripsi.md`.
3. **Baca rule prompt yang relevan** — pilih Prompt 1/2/3 dari `docs/README.md` **jika diperlukan**.
4. **Analisa source file yang terkait** — jangan asumsi, baca baris yang ditunjuk task.
5. **Implementasikan perubahan** — pakai `edit` / `multi_edit` / `write_to_file`, bukan copy-paste kode ke chat.
6. **Update barrel export jika perlu** — API publik baru wajib diekspor lewat `index.ts` folder-nya dan otomatis ikut `src/index.ts`. Jangan menambah `process.env` read baru di `src/`; konfigurasi masuk lewat options/argumen decorator.
7. **Cek kode mati & duplikasi** — periksa fungsi/file tidak terpakai (dead code) dan duplikasi logika. Jika ditemukan, laporkan ke user dengan nama file/fungsi yang bersangkutan. Hapus atau ekstrak shared utility hanya jika aman dan sesuai scope task.
8. **Update/tambah unit test** — setiap perubahan API harus diikuti unit test yang dapat diaudit di `tests/*.test.ts` (`bun:test`); pastikan test lama masih relevan.
9. **Verifikasi minimal** — jalankan `bun run type-check`, `bun test`, dan `bun run build`; update `bun.lock` (via `bun install`/`bun add`/`bun remove`) jika ada perubahan dependency. Tidak ada linter/formatter terkonfigurasi — ikuti style kode yang ada. Jika gagal, perbaiki dulu; jangan tandai task selesai.
10. **Update task file** — ubah checklist dari `[ ]` menjadi `[x]` (✅ ijo) untuk item yang selesai.
11. **Rename file task yang sudah selesai** — tambahkan suffix `_done` di nama file: `NN_deskripsi_singkat_done.md`.
12. **Update todo list** — tandai task sebagai `completed` via `todo_list`.

### Saat diminta `draft task` dari summary, text, atau file attachment:

1. **Baca input user** — jika berupa file path/attachment, baca file tersebut terlebih dahulu.
2. **Buat ringkasan masalah** — 1–3 bullet yang jelas.
3. **Usulkan task** — judul, nomor urut berikutnya, path file `docs/task/YYYY-MM-DD/NN_deskripsi.md`, file terkait, dan checklist.
4. **Berikan rekomendasi** — approach atau solusi yang disarankan.
5. **Sebutkan pros & cons** — keuntungan, risiko, atau trade-off dari usulan task.
6. **Tanyakan konfirmasi** — tanya user: "Draft task sudah siap. Ketik `do it` untuk saya buat file task-nya."
7. **Jangan buat file task atau edit apapun sebelum user menyetujui**.

### Saat user mengatakan `do it` / `buat` / `ok`:

1. **Buat file task** — pakai draft yang sudah disetujui di `docs/task/YYYY-MM-DD/NN_deskripsi_singkat.md`.
2. **Format wajib** — gunakan template task yang ada di bagian "Template task wajib".
3. **Tambahkan ke todo list** — status `pending`.
4. **Laporkan path file yang dibuat**.

### Saat diminta `create task` (langsung, tanpa preview):

1. **Jangan mengerjakan/implementasi apapun kecuali diminta secara eksplisit**.
2. **Tentukan nomor urut berikutnya** dari `docs/task/YYYY-MM-DD/`.
3. **Buat file** dengan format:
   ```
   docs/task/YYYY-MM-DD/NN_deskripsi_singkat.md
   ```
   Contoh: `docs/task/2026-09-04/11_auth_rate_limit_broken.md`
4. **Isi file dengan template**:
   - `# Task NN: <judul>`
   - `- File: <path file terkait>`
   - `- Deskripsi masalah`
   - `- Checklist:`
     - `[ ] Langkah 1`
     - `[ ] Langkah 2`
   - `- Referensi`
5. **Tambahkan ke todo list** sebagai `pending` jika user ingin dikerjakan nanti.

## 4. Template task wajib

Setiap file task harus ada bagian **Checklist** dengan checkbox Markdown. Contoh:

```markdown
# Task 11: Contoh task

- File: `src/decorators/example.ts`
- Masalah: deskripsi singkat.

## Checklist

- [ ] Analisa kode terkait
- [ ] Implementasi perbaikan
- [ ] Update atau tambah unit test di `tests/` (terutama untuk perubahan API)
- [ ] Ekspor API publik baru lewat `index.ts` folder-nya
- [ ] Cek kode mati, file tidak terpakai, dan duplikasi fungsi
- [ ] Update `bun.lock` jika ada perubahan dependency
- [ ] Verifikasi `bun run type-check` / `bun test` / `bun run build`
- [ ] Update `README.md` jika public API berubah
```

## 5. Aturan checklist warna ijo

- Awal task: semua item pakai `- [ ]` (kotak kosong).
- Setelah selesai: ubah menjadi `- [x]` (GitHub/VS Code akan render centang hijau).
- Jangan tandai item selesai kalau belum diverifikasi.
- Tambahkan `## Status` di atas task file kalau semua checklist sudah `[x]`:
  ```markdown
  ## Status

  - [x] Completed
  ```

## 6. Hal yang dilarang

- Jangan usulkan perubahan arsitektur besar kalau user cuma minta implementasi satu task.
- Jangan langsung edit kode kalau user bilang `create task` saja.
- Jangan keluarkan kode di chat; selalu pakai tool edit.
- Jangan buat file baru kecuali memang dibutuhkan task.
- Jangan commit secret, key, atau credential ke source.
- Jangan push langsung ke `main`; pakai feature branch.
- Jangan biarkan `bun.lock` tidak sinkron dengan `package.json`.
- Jangan tambah runtime `dependencies` — hono dan zod adalah `peerDependencies`; integrasi opsional (misal Redis) di-inject consumer, bukan di-import.
- Jangan gunakan `experimentalDecorators`/`reflect-metadata` — repo ini memakai TC39 Stage 3 decorators.
- Jangan tandai task selesai kalau `bun run type-check`, `bun test`, atau `bun run build` masih gagal.
- Jangan lupakan role yang sedang aktif; tetap konsisten dengan persona role.
