# 85 — `createApp` hardening: auto-boot + strict DI enforcement

## Problem (from review)

Two gaps around the container boundary:

1. **`createApp()` never calls `container.boot()`** — providers' `onInit()`
   hooks silently don't run under the recommended entrypoint
   (`src/utils/app.ts:64` builds routes and returns; `boot()` is only in
   README snippets like `await container.boot()`). A provider that assumes
   `onInit` ran behaves differently depending on how the app was started.
2. **`container` is exported but not enforced** — nothing stops
   `new QueueService()` bypassing DI entirely. The injected instance gets
   resolved deps + `onInit`; the hand-rolled one doesn't. The framework
   can't tell the difference, so drift is invisible until a lifecycle or
   dependency bug surfaces.

## Proposal

### A. `createApp` auto-boots

```ts
export async function createApp(
  ModuleClass: Function,
  options: CreateAppOptions = {},
): Promise<Hono>
```

- Await `container.boot()` after routes are mounted, before `return app`.
- Signature becomes `Promise<Hono>` — **breaking change** for `export default
  createApp(...)`. Alternative that stays sync: keep `createApp` sync and add
  `createAppAsync`… but a Promise return is cleaner for Bun
  (`export default { fetch }` accepts a lazily-awaited app). Decide at
  implementation time; README + frontend-docs examples must match.
- Options: `boot: false` escape hatch for tests that manage the container.

### B. Strict DI mode — `strictDi` option

```ts
createApp(AppModule, { strictDi: true });
```

Mechanism: a module-scoped construction token.

```ts
// core/container.ts internals
let constructing: symbol | null = null;
```

- `container.resolve`/`registerSingleton` set `constructing` while calling
  `new`/`factory`.
- `@Injectable({ strict: true })` (or a global `strictDi`) wraps the class
  constructor to throw
  `DI bypass: QueueService was constructed outside the container — resolve it via container.resolve() or inject it`
  when `constructing` is null.
- Opt-in per class (`@Injectable({ strict: true })`) AND app-wide
  (`strictDi` flips the default for every injectable) — tests and factory
  cases keep an escape via `container.construct(Class)` helper that sets the
  token explicitly.

### C. Companion affordances

- `container.construct(cls)` — "I need an unmanaged instance on purpose"
  (tests, scripts) — runs the constructor legitimately without DI noise.
- `container.describe()`/`printGraph` unchanged; docs gain a "why not `new`"
  note under the DI section.

## Out of scope

- Runtime detection of *existing* manual `new` sites in consumer code — the
  strict constructor guard only fires when `strictDi` is on.
- Making `container` non-exported — it's legitimately needed for wiring.

## Files

- `src/utils/app.ts` — auto-`boot()`, `strictDi` option, Promise return
- `src/core/container.ts` — `constructing` token, `container.construct()`,
  optional strict check in the `@Injectable` decorator path
- `src/decorators/` (injectable decorator) — `{ strict }` option
- `tests/` — `createApp` boots providers; strict mode throws on manual `new`;
  `container.construct` escapes cleanly; `boot: false` keeps tests quiet
- `README.md` + `../frontend-docs` — createApp signature, `strictDi`,
  `container.construct` guidance

## Acceptance

- `await createApp(AppModule)` runs every singleton's `onInit()` without a
  manual `container.boot()` call.
- With `strictDi: true`, `new InjectableClass()` throws a clear error naming
  the class; `container.resolve` and `container.construct` still work.
- README + frontend-docs examples reflect the async signature and strict
  option.
- Existing tests pass; new tests cover boot-on-create, strict bypass throw,
  and the `container.construct` escape hatch.

## Implemented (2026-10-19)

- **`createApp` is now async** (`Promise<Hono>`) and awaits `container.boot()`
  after wiring — `onInit()` hooks run under the recommended entrypoint.
  `boot: false` escape hatch added. `strictDi: true` option added.
  **Breaking change** — call sites must `await`; README, `cli-init` template
  (`const app = await createApp(...)`), and frontend-docs updated.
- **Strict DI**: module-scoped `constructionDepth` counter in
  `core/container.ts`; `resolve`/`construct`/factories run constructors inside
  `withinConstruction()`. `@Injectable` returns a subclass that throws
  `DI bypass: 'X' was constructed with new() outside the container` when
  strict applies (per-class `{ strict: true }` or global
  `container.strictDi`). Non-strict usage is untouched.
- `container.construct(cls, ...args)` — documented escape hatch for
  tests/scripts.
- `decorators/middleware.ts` — class middleware instantiation routed through
  `container.construct()` so `@Injectable` middleware still works under
  strictDi.
- `tests/strict-di.test.ts` — 9 tests: per-class throw, dependency throw,
  non-strict compat, resolve/construct/factory paths, global strictDi flag,
  auto-boot + `boot: false`.
- Standard-decorator typing: the wrapper preserves the concrete constructor
  signature (`<C extends abstract new (...args: any[]) => any>`), restores
  `name`/`length`/`Symbol.metadata`; statics inherit via `extends`.
