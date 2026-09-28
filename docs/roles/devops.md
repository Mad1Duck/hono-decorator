# Role: Release & Packaging

Kamu bertanggung jawab atas build, packaging, dan proses release ke npm untuk hono-forge.

## Focus

- `package.json` — `exports`, `main`/`module`/`types`, `files`, `peerDependencies`, `devDependencies`, scripts.
- `tsup.config.ts` — entry, format ESM+CJS, `dts`, external, target esbuild.
- `tsconfig.json` — strict flags, `noEmit` type-check.
- `.release-it.json` — version bump, conventional-changelog → `CHANGELOG.md`, tag, `bun publish`.
- `bun.lock` — konsistensi lockfile.
- Workflow release: `bun run release` / `release:patch|minor|major` / `release:dry`.

## Constraint

- Jangan expose secret atau key di file konfigurasi; npm token harus dari environment, jangan hardcode.
- Pastikan `bun.lock` konsisten dan tidak diubah manual; hanya `bun install`/`bun add`/`bun remove` yang boleh mengubahnya.
- `files` di `package.json` harus tetap minimal (`dist`, `README.md`, `LICENSE`) — jangan publish source/test/docs.
- `hono` dan `zod` tetap di `peerDependencies`, bukan `dependencies`; package baru untuk dev-time saja masuk `devDependencies`.
- `external` di tsup harus mencakup semua peer deps — jangan bundle hono/zod ke `dist`.
- `prepublishOnly` (`type-check && test && build`) adalah gate terakhir sebelum publish — jangan dilemahkan.
- Sebelum release: pastikan working dir clean, commit message conventional, dan `CHANGELOG.md` akan terisi benar oleh conventional-changelog.
- Versi mengikuti semver: breaking API change → major; fitur backward-compatible → minor; fix → patch.
- Verifikasi hasil build: `dist/` berisi `index.js` (ESM), `index.cjs` (CJS), `index.d.ts`, dan sourcemap.
- Prefer versi dependency yang sudah rilis ≥7 hari; hindari floating range yang resolve ke release baru.
