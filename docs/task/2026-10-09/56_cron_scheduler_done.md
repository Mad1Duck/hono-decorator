# Task 56 — `@Cron` + dependency-free cron parser

**Status:** done

## Goal

`@Interval` covers fixed delays; cron expressions cover wall-clock schedules
(daily 02:00, weekdays only, etc.) without adding a runtime dependency.

## Implementation

- `src/core/cron.ts` — mini engine, standard 5-field syntax
  (`min hour dom mon dow`): `*`, `*/n`, `a`, `a-b`, `a-b/n`, `a,b,c`.
  Vixie OR semantics: when both dom and dow are restricted, either may
  match. `parseCron` validates eagerly; `nextCronTime` scans forward
  minute-by-minute (bounded at 4 years → throws on impossible exprs).
- `src/decorators/schedule.ts` — `@Cron(expr, { immediate? })` writes
  `{ cron }` to the shared `SCHEDULE` metadata slot.
- `src/decorators/metadata.ts` — `ScheduleMetadata` gains `cron?` next to
  `everyMs?`.
- `src/core/scheduler.ts` — cron entries use a chained `setTimeout` (each
  run computes the next wall-clock fire time → survives drift/DST);
  `setInterval` entries unchanged. Invalid expressions are logged via
  `LOGGER` and skipped. Teardown sets a stop flag so an in-flight tick
  cannot reschedule.
- `parseCron`/`nextCronTime` exported via `core/index.ts`.

## Tests

`tests/production.test.ts` — field parsing (steps/ranges/lists), malformed
expressions throw, `nextCronTime` daily rollover + weekday skip + dom/dow
OR semantics, scheduler teardown, invalid-expression skip path.
