# Task 62 — `hono-forge doctor` static wiring check

**Status:** done

## Goal

A CI guard: validate module wiring WITHOUT booting the server — same
metadata the runtime already knows, surfaced as an exit code.

## Implementation

`src/cli.ts` — new `doctor <entry>` command. Loads the entry (same
module/controller resolution as `flows`/`openapi`), then three checks:

1. **DI** — `container.describe(providers + controllers)`; every
   `missing` dep is reported (`di:` prefix).
2. **Routes** — `describe()` per controller; duplicate `METHOD /path`
   keys across controllers reported (`route:` prefix).
3. **Scheduler** — every `@Cron` expression run through `parseCron`
   (`cron:` prefix), and scheduled jobs on `@RequestScoped` classes
   flagged (`schedule:` prefix — no request scope exists at tick time).

Clean run prints `✔ no issues — N controller(s), M provider(s)` and
exits 0; issues print a bullet list and set `process.exitCode = 1`.

## Tests

`tests/production.test.ts` — `Bun.spawnSync` against
`tests/fixtures/broken.module.ts` (missing dep + route collision +
invalid cron + request-scoped job → exit 1, all four prefixes present)
and the real `examples/todo-api` module (exit 0).
