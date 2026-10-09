# Task 49 — CLI `hono-forge flows` + single-file flow export

**Status:** done

## Goal

Two DX additions on top of Task 48's api-tester flow export:

1. `hono-forge flows` CLI — generate `.flow.yaml` without writing a script.
2. Single-file mode — one flow file per module with a visual FlowGroup per
   controller, instead of one file per controller.

## Implementation

- `src/cli.ts` — bin entry (`#!/usr/bin/env node`):
  `hono-forge flows <entry-file> [--out dir] [--base-url url] [--single] [--export Name]`.
  Resolves the `@Module`/`@Controller` export dynamically; friendly errors for
  missing entry, TS-under-Node (`bunx` hint), and ambiguous exports.
  `tsup` second entry → `dist/cli.js`; `package.json` `bin` wired.
- `src/integrations/api-tester.ts` — refactored per-controller node building
  into `buildControllerNodes`; added `generateFlowFile`/`writeFlowFile`
  (single file, `FlowGroup` per controller, node positions relative to group,
  groups laid out in columns) + `resolveControllers`/`flowSettings` helpers.
- **`Symbol.for` global metadata keys** — `METADATA_KEYS`, `CONFIG`, and
  `LOGGER` switched from unique `Symbol()` to `Symbol.for('hono-forge.*')` so
  two copies of the library (e.g. the bundled CLI + the app's installed copy,
  or duplicate installs in a monorepo) read the same metadata. This is what
  makes the CLI work against an app that imports a different copy.
- Tests: +3 single-file mode cases (groups, relative positions, YAML
  roundtrip). README: CLI + single-file docs.

## Verify

- `bun dist/cli.js flows examples/todo-api/index.ts --out .tmp-flows --single`
  → `app.flow.yaml` with 2 groups; parses cleanly through api-tester's
  `yamlToFlow` (4 nodes, 2 edges, 2 groups).
- `bun test` — 329 pass; `tsc --noEmit` clean; `tsup` build ok.
