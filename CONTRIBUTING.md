# Contributing

Thanks for considering contributing to hono-forge!

## Setup

```bash
bun install
```

Requires Bun ≥ 1.2 (1.3+ recommended) and Node ≥ 18.

## Workflow

1. Fork the repo and create a branch from `master`.
2. Make your change — follow the existing code style (TypeScript, ESM,
   zero runtime dependencies beyond `hono` + `zod` peers).
3. Add or update tests for any behavior change (`tests/*.test.ts`, `bun:test`).
4. Update `README.md` if you add or change public API.
5. Verify everything passes before pushing:

```bash
bun run type-check
bun test
bun run build
bun run test:node   # Node-runtime smoke test against the built bundle
```

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) —
  the changelog is generated from them.
- **Tasks**: non-trivial work is tracked in `docs/task/YYYY-MM-DD/NN_name.md`
  per the repo's task journal convention (see `docs/AGENTS.md`).
- **Breaking changes**: call them out in the commit body with
  `BREAKING CHANGE:` and document the migration path.

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- Describe *why* the change is needed, not just what it does.
- CI must be green (type-check, tests, build, Node smoke).
