# Task 50 — CLI `openapi` + `routes` commands

**Status:** done

## Goal

Extend the CLI beyond `flows` — generate the OpenAPI spec and print the route
table without starting a server.

## Implementation

- `src/cli.ts` — two new commands sharing the same module-loading machinery:
  - `hono-forge openapi <entry> [--out openapi.json] [--title] [--version]`
    → resolves controllers (module or class), `OpenAPIGenerator.generate`,
    writes JSON.
  - `hono-forge routes <entry>` → `HonoRouteBuilder.printRoutes` per target.
- Refactored `main()` to dispatch on command after shared entry-file loading;
  `--out` semantics differ per command (dir for flows, file for openapi).

## Verify

- `bun dist/cli.js openapi examples/todo-api/index.ts --out spec.json` →
  valid spec with `/todos`, `/todos/{id}`, `/feed/` + `x-transport: sse`.
- `bun dist/cli.js routes examples/todo-api/index.ts` → route table.
