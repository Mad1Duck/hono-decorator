# Release & Publishing

hono-forge is published to npm from `dist/` via `release-it` + conventional-changelog. There is no server to deploy — "deployment" for this repo means a clean npm publish.

## What a release does

`bun run release` (configured in `.release-it.json`) performs:

1. Version bump in `package.json` (patch/minor/major).
2. `CHANGELOG.md` regenerated from conventional commits (`feat:` → Features, `fix:` → Bug Fixes, `perf:` → Performance, `refactor:` → Refactoring; `docs:`/`chore:`/`test:`/`ci:` hidden).
3. Git commit `chore: release vX.Y.Z` + tag `vX.Y.Z` + push.
4. `bun publish` to npm — `prepublishOnly` runs `type-check && test && build` first.

## Release commands

| Command | When |
|---------|------|
| `bun run release:dry` | Dry run — preview what would happen, nothing pushed/published |
| `bun run release:patch` | Bug fixes only since last release |
| `bun run release:minor` | New backward-compatible features (new decorator, new option) |
| `bun run release:major` | Breaking changes (renamed/removed export, changed signature, changed default behavior) |
| `bun run release` | Interactive — release-it asks for the bump |

`release:*` variants pass `--no-git.requireCleanWorkingDir`; plain `release` requires a clean working dir.

## Pre-release checklist

- [ ] `bun run type-check` clean.
- [ ] `bun test` all green.
- [ ] `bun run build` produces `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts`, sourcemaps.
- [ ] Every user-facing change documented in `README.md`.
- [ ] Commit messages since last tag follow conventional commits — they are what lands in `CHANGELOG.md`.
- [ ] Breaking changes are actually marked breaking (`feat!:` / `BREAKING CHANGE:` footer) and the major bump is intended.
- [ ] `bun.lock` in sync with `package.json`.
- [ ] Sanity-check what ships: `files` is `dist`, `README.md`, `LICENSE` — no `src/`, `tests/`, or `docs/` in the tarball (`npm pack --dry-run` / `bun publish --dry-run`).

## Versioning policy

- Public API = everything exported from `src/index.ts`. Rename/removal/signature change = breaking.
- New decorator, helper, option, or adapter = minor.
- Internal refactor/fix with no API or behavior change = patch.
- Keep `peerDependencies` ranges wide (`hono >=4`, `zod >=4`) so consumers aren't forced to upgrade in lockstep.

## npm auth

Publishing uses `bun publish` — auth comes from the consumer's `~/.npmrc`/`NPM_TOKEN`, never committed. If publish fails on auth, fix credentials locally; do not put tokens in repo files.
