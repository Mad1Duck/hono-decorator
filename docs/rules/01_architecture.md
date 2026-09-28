# Library Architecture & Public API Rules

## Design Principles

- Modular — each feature lives in its own file under `src/<area>/`.
- Ergonomic — NestJS-familiar API, minimal boilerplate for consumers.
- Zero runtime dependencies — `hono` and `zod` are `peerDependencies` only.
- Pluggable — anything infra-flavored (auth, rate limit, WS upgrade, channel backend, logging, error handling) is an injectable option, not a hardcoded import.
- Runtime-portable — works on Bun, Node, and edge runtimes; Bun-only features (filesystem auto-discovery) are optional paths, not requirements.

## Module Responsibilities

| Path | Responsibility |
|------|----------------|
| `src/core/` | DI container, `HonoRouteBuilder` (request pipeline), request context, `HttpException`, shared types |
| `src/decorators/` | All decorators: controller, HTTP methods, context helpers (param), guard, interceptor, middleware, SSE, WebSocket, OpenAPI, custom + `metadata.ts` key registry |
| `src/channels/` | Pub/sub: `ChannelRegistry`, `InMemoryChannelAdapter`, `RedisChannelAdapter`, SSE/WS channel clients |
| `src/openapi/` | `OpenAPIGenerator` — builds OpenAPI 3.1 spec from route metadata |
| `src/utils/` | `discoverControllers`/`fromModules`, `paginate`/`paginatedSchema`, `defineSchemas`, request helpers, trace ID, `useTransaction` |
| `src/index.ts` | Barrel — re-exports everything; defines the public API surface |
| `tests/` | `bun:test` unit tests, one file per area |

## Constraints

- One file = one responsibility; a new decorator gets its own file in `src/decorators/`.
- Decorator metadata flows one way: decorator writes `Symbol.metadata` → `HonoRouteBuilder` reads it → registers on the Hono app. Business logic never reads metadata directly.
- Codecs/validators (Zod schemas) are supplied by the consumer; the library never hardcodes a schema.
- Transport concerns (SSE streaming, WS upgrade) are adapter points — consumers inject the upgrader/client.
- Every public decorator, helper, or utility must have an auditable unit test covering success, error, and edge paths.
- Any API change must include an impact check on existing tests; update or add tests before the task is marked complete.
- Tests must be deterministic and isolated — reset `container`/`channels` state between tests; no network, filesystem, or timing-dependent assertions unless deliberately testing that behavior.
- No dead code: unused functions, exports, or files should be removed or reported. The codebase must not accumulate leftover scratch files or commented-out code.
- Avoid duplicate functions and logic (DRY). If the same logic appears in more than one place, extract it to a shared utility or report it.
- Every change must be scanned for newly introduced or exposed dead code and duplicates; findings must be reported to the user.

## Decorator Model (hard rule)

- **TC39 Stage 3 decorators only.** Metadata attaches via `Symbol.metadata`. Never introduce `experimentalDecorators`, `emitDecoratorMetadata`, or `reflect-metadata`.
- Constructor injection is explicit: `@Injectable([DepA, DepB])` declares deps — never reflect on constructor param types.
- Context helpers (`Body`, `Param`, `Query`, `User`, …) are **functions called inside the handler** with `c` as first arg — not parameter decorators.

## Dependencies & Packaging

- Use `bun` for package management. Do not hand-edit `bun.lock`; only `bun install` / `bun add` / `bun remove` should change it.
- `hono` and `zod` stay in `peerDependencies` (`>=4`); they are also in `devDependencies` for local dev/test and listed as `external` in `tsup.config.ts`.
- Never add a runtime `dependencies` entry. Optional integrations (e.g. `ioredis` for `RedisChannelAdapter`) accept consumer-injected clients — add only a `types.ts` interface, never an import.
- New dev dependencies: prefer versions published ≥7 days ago; avoid floating ranges.
- Published package contents are controlled by `files` in `package.json` (`dist`, `README.md`, `LICENSE`) — do not add `src`, `tests`, or `docs`.

## Public API & Semver

- Everything exported from `src/index.ts` is public API — treat any rename, removal, or signature change as **breaking** (major bump + CHANGELOG entry + README update).
- New decorators/helpers/options are minor; bug fixes are patch. When unsure, ask before shipping a breaking change.
- Keep naming consistent: decorators are PascalCase (`@Controller`, `@RateLimit`), context helpers are PascalCase functions (`Body`, `Param`), utilities are camelCase (`paginate`, `discoverControllers`).
- `README.md` is the published documentation — every user-facing change must be reflected there with a working example.

## Error Handling

- Route handlers' unhandled errors flow to the `onError` hook; `HttpException` carries explicit status/message.
- Never leak internal stack traces by default — `exposeStack` is opt-in (`true`, `'development'`, or predicate).
- Zod validation failures produce a consistent 400 response shape through the context helpers.

## State, Concurrency & Lifecycle

- `@Singleton` (default) instances are shared — keep them stateless or document mutable state.
- `@RequestScoped` instances are created per request inside `runInRequestContext` — no leakage across concurrent requests.
- `@Stateless` handlers bypass DI instantiation.
- `container.boot()` / `container.shutdown()` must run `OnInit`/`OnDestroy` hooks and clear registrations predictably.
- Channel subscribers must be removed on disconnect; `channels` registry must not grow unboundedly.

## Repository & Task Management

- Do not push directly to `main`; use feature branches.
- Branch names should follow convention: `feature/`, `fix/`, `hotfix/`, `refactor/`, or `task/<number>-<short-desc>`.
- Commit messages follow **conventional commits** (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`, `ci:`) — release-it generates `CHANGELOG.md` sections from them (`docs:`, `chore:`, `test:`, `ci:` are hidden).
- Keep tasks scoped; split into sub-tasks if a change crosses multiple areas.
- Completed task files stay in `docs/task/YYYY-MM-DD/`; do not delete them.
- Mark completed tasks with `## Status` and green checkboxes, then rename the file with a `_done` suffix: `NN_deskripsi_singkat_done.md`.

## Documentation

- Every new public decorator/helper/option must appear in `README.md` with a typed, compilable example.
- Update `CHANGELOG.md` through release-it — do not hand-edit release entries; write good commit messages instead.
- `docs/` is maintainer-facing workflow documentation; keep it accurate when repo conventions change.

## Testing Strategy

- Tests live in `tests/*.test.ts` using `bun:test` (`describe`/`it`/`expect`); run all with `bun test`, one file with `bun test tests/<name>.test.ts`.
- Prefer unit tests for pure logic (metadata, container resolution, pagination); exercise routes through a real `Hono` app + `HonoRouteBuilder` in tests rather than mocking Hono internals.
- Each bug fix must include a regression test.
- Factories/fixtures must be deterministic and safe to rerun.

## Verification

- Before marking any task done: `bun run type-check`, `bun test`, `bun run build` must all pass.
- After `bun run build`, `dist/` should contain `index.js` (ESM), `index.cjs` (CJS), `index.d.ts`, and sourcemaps.
- There is no configured linter/formatter — match the existing code style (single quotes, section banner comments, `import type` for types).
