# Agent Memory — hono-forge

You are working in the current repository root. The absolute path is available in the active workspace / system info.

**At the start of every session, read these files first:**

- `docs/README.md` — task/file conventions and the rule prompts
- `docs/SETUP.md` — AI workflow, commands, and checklist
- `docs/roles/backend.md` — library engineer persona and constraints (default role for this repo)
- `docs/roles/architect.md` — API design / systems architect persona (use for public API, extensibility, and semver discussions)
- `docs/rules/01_architecture.md` — library architecture, public API surface, and quality rules
- `docs/rules/02_source_structure.md` — `src/` layout and module conventions
- `docs/design/00-Index.md` — feature/design map; read for domain context on what the library provides

## Project context

- Product: **hono-forge** — NestJS-style decorators for [Hono](https://hono.dev): controller routing, DI container, guards, interceptors, SSE, WebSocket, channels (pub/sub), OpenAPI 3.1 generation, pagination, and more. Published to npm as `hono-forge` (currently v3.x). User-facing docs: root `README.md` (the single source of truth for the public API).
- This is a **standalone library**, not an app and not a monorepo. There is no `apps/*`, no database, no server entrypoint. Output is `dist/` (ESM + CJS + `.d.ts`) built by `tsup`.
- Stack: TypeScript + Bun. Package manager: **bun** (`bun.lock`). Build: `tsup` (`tsup.config.ts`). Tests: `bun test` (`bun:test` runner).
- Peer dependencies: `hono >=4`, `zod >=4`. **No runtime `dependencies`** — consumers bring hono/zod themselves. Optional integrations (e.g. Redis clients for `RedisChannelAdapter`) are injected by the consumer, never imported directly.
- Decorators are **TC39 Stage 3** (standard decorators, `Symbol.metadata`) — no `experimentalDecorators`, no `emitDecoratorMetadata`, no `reflect-metadata`. Do not reintroduce them.
- Source layout (`src/`): `core/` (DI container, route builder, request context, `HttpException`), `decorators/` (controller/method/param/guard/interceptor/middleware/sse/websocket/openapi/custom + `metadata.ts`), `channels/` (pub/sub registry + memory/redis adapters + SSE/WS clients), `openapi/` (spec generator), `utils/` (discover, pagination, schema, request, trace, transaction). Public surface is re-exported through `src/index.ts` — everything under `src/*` is public API once exported.
- Tests live in `tests/` (top-level, `*.test.ts`, `bun:test`): `container`, `decorators`, `route-builder`, `channels`, `openapi`, `logging`.
- Verification commands: `bun run type-check` (`tsc --noEmit`), `bun test`, `bun run build` (`tsup`). No linter/formatter is configured; match existing code style.
- Releases are automated via `release-it` + conventional-changelog: `bun run release` (or `release:patch|minor|major`) bumps version, updates `CHANGELOG.md` from conventional commits, tags, and runs `bun publish`. Commit messages should follow conventional commits (`feat:`, `fix:`, `perf:`, `refactor:`) — they drive the changelog.
- Default role for tasks: `docs/roles/backend.md`.
- Task journal lives in `docs/task/YYYY-MM-DD/NN_description[_done].md`. Always check existing tasks before creating or implementing a new one.
- Public API, packaging, and quality rules are in `docs/rules/01_architecture.md`.

## Working rules

- Do not ask the user to `Get-Content` a file unless you genuinely need content that is not already described in the docs or this file.
- If `graphify-out/graph.json` exists, prefer querying it for codebase questions; otherwise explore source files directly.
- Remember completed/pending tasks from `docs/task/` and update task files with `[x]` and `_done` suffix when finished.
- Follow the architecture rules and role constraints in every edit.
- The library reads only `process.env.NODE_ENV` (for `exposeStack: 'development'`). Do not add new env-var reads to `src/` — configuration belongs in `HonoRouteBuilder` options/decorator args.
- `README.md` is the published documentation — update it whenever the public API changes.
- If a project detail in this file conflicts with the actual repo (paths, package names, stack), report it and propose an update to this file.
