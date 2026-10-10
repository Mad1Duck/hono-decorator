# Task 65 — `hono-forge client` typed-client codegen

**Status:** done

## Goal

`generateClientTypes` existed but required a handwritten codegen script —
the typed client story was invisible. A CLI command makes it a one-liner.

## Implementation

`src/cli.ts` — new `client <entry>` command:

```bash
bunx hono-forge client ./src/app.module.ts --out src/routes.gen.ts \
  --name AppRoutes --import-path ./src/controllers
```

- Resolves the module/controllers like every other command.
- `--import-path` defaults to the entry file relative to the output
  (`relativeImport` helper — strips extension, POSIX slashes, `./`
  prefix), so `bunx hono-forge client ./src/app.module.ts` just works
  when controllers are re-exported from the entry.
- Warns when a discovered controller is NOT exported from the entry
  file — the generated `import type` would otherwise fail to compile.
- `--name` overrides the emitted interface name (default `AppRoutes`).

Example app updated to `export` its controllers (previously class-local)
— required for the generated type import and better example practice.

## Tests

`tests/production.test.ts` — `Bun.spawnSync` against the todo-api
example: file written, `AppRoutes` + route keys present, SSE route
excluded, tmp dir cleaned up.
