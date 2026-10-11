# Task 68 — `hono-forge init` project scaffolding

**Status:** done

## Goal

Biggest onboarding gap left: a new user `bun add hono-forge` and then has to
guess the project structure (and the right TC39 decorator tsconfig flags).
`bunx hono-forge init my-api` now writes a complete runnable starter.

## Implementation

`src/cli-init.ts` — `scaffold(dir, opts)` writes:

- `package.json` (bun scripts, `hono-forge`/`hono`/`zod` deps) — package name
  sanitized from the directory basename, so `init C:\path\to\my-api` doesn't
  inject raw backslashes into `name`/titles
- `tsconfig.json` — `moduleResolution: "bundler"`, decorators left as TC39
  (no `experimentalDecorators`)
- `src/index.ts` — `createApp` wiring health probes, OpenAPI/Scalar docs,
  route printing, and graceful shutdown (only APIs in the published package —
  an earlier draft used the unreleased `metrics` option and failed a live
  install check)
- `src/app.module.ts`, `src/hello.controller.ts` (GET + POST `/hello`),
  `src/hello.service.ts`
- `README.md`, `.gitignore`

`src/cli.ts` — `init` is registered in the `COMMANDS` map and handled as the
only command that doesn't take an entry file; `--help`/`help init` show
usage + examples like every other command.

## Verified

Temp scaffold → `bun install` → `tsc --noEmit` clean → server on a free port
responds on `/hello` (GET+POST), `/health`, `/docs`, `/openapi.json`.
Production test spawns the real CLI via absolute path (cwd-independent).
