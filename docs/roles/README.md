# Roles

Folder ini berisi persona yang harus dipakai AI sesuai domain task.

## Cara memilih role

1. Sebelum mengerjakan task, baca `docs/SETUP.md`.
2. Pilih **satu role** yang paling cocok dengan task.
3. AI wajib mengikuti persona, focus, dan constraint di file role tersebut.
4. Jika task melibatkan beberapa domain, pilih role utama lalu sebut cross-domain concern di catatan.

## Daftar role

- `backend.md` — Library Engineer (default untuk task di repo ini; kerja di `src/` dan `tests/`)
- `frontend.md` — Consumer / DX Engineer (public API surface, README, contoh pemakaian, kualitas `.d.ts`)
- `devops.md` — Release & Packaging (tsup build, `package.json` exports, release-it, npm publish)
- `qa.md` — QA / Testing
- `architect.md` — API / Systems Architect (desain public API, extensibility points, trade-off, semver)

## Menambah role baru

Jika muncul domain baru, buat file `docs/roles/<nama_role>.md` dengan format yang sama. Update file ini.
