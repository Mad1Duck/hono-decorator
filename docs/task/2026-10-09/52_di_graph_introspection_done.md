# Task 52 — DI graph introspection (`container.describe` + `hono-forge graph`)

**Status:** done

## Goal

Debuggable dependency injection — print the provider graph (scope,
dependencies, registration kind, missing deps) without resolving anything.

## Implementation

- `src/core/container.ts`
  - `ProviderDescription` — name, scope (`singleton`/`request`/`stateless`/
    `transient`), dependencies (constructor-order names), `missing`
    (deps absent from the described set), `registered`
    (instance/factory/class), `resolved`.
  - `container.describe(targets?)` — static metadata read over the given
    classes + already-registered tokens.
  - `container.printGraph(targets?)` — formatted output with a `⚠ missing`
    warning per unresolved dep (the classic "forgot to list it in providers"
    bug).
- `src/core/route-builder.ts` — public `moduleProviders(ModuleClass)`
  companion to `moduleControllers()` (transitive @Module provider collection).
- `src/cli.ts` — `hono-forge graph <entry>` command: module → providers +
  controllers → `container.printGraph`.
- Tests: +3 in `container.test.ts` (scopes/deps/registration, satisfied deps,
  missing-dep warning). README section added.

## Verify

- `bun dist/cli.js graph examples/todo-api/index.ts` — prints 5-provider graph
  with `TodoController → TodoService`.
- `bun test tests/container.test.ts` — 43 pass.
