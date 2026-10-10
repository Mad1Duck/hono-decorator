# Task 63 — `@OnBootstrap` post-build startup hook

**Status:** done

## Goal

`OnInit` runs when a provider is resolved — too early to depend on the
app being fully assembled (seed data wants routes mounted, warm-up wants
singletons booted). A post-build hook was needed.

## Implementation

- `src/decorators/lifecycle.ts` — `@OnBootstrap()` method decorator
  writing `ON_BOOTSTRAP` metadata.
- `src/core/lifecycle.ts` — `runBootstrap(providers)` reads metadata and
  invokes every marked method on the resolved singleton, sequentially
  and awaited.
- `route-builder.ts` — `buildModule` calls `runBootstrap` after routes
  are mounted and `container.boot()` has run. Guarded so it fires once
  per build.
- `cli.ts doctor` — `@OnBootstrap` on a `@RequestScoped` class is
  reported (`bootstrap:` prefix) — no singleton exists at startup to
  run it on.

## Tests

`tests/production.test.ts` — hook fires exactly once during buildModule,
receives the resolved instance, and request-scoped targets are rejected.
