# Task 66 — CLI help/UX improvements

**Status:** done

## Goal

The monolithic `--help` text listed every option against every command —
hard to scan, easy to miss what applies where.

## Implementation

`src/cli.ts` — help is now data-driven from a `COMMANDS` map
(`{ desc, opts }` per command), so a new command gets correct help for
free:

- `hono-forge` / `hono-forge help` — compact command table.
- `hono-forge <command> --help` / `hono-forge help <command>` —
  per-command usage + only the flags that command accepts + an
  `Examples:` block with real invocations (incl. what to do with the
  output — e.g. importing a generated `.flow.yaml` in api-tester).
- Unknown command → Levenshtein `suggestCommand` (`≤2` edits): typo
  `clent` prints `did you mean 'client'?` before exiting 1.

## Tests

`tests/production.test.ts` — spawn `flows --help` (exit 0, shows
`--base-url`) and `clent` (exit 1, suggestion present).
