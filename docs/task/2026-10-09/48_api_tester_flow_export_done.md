# Task 48 — api-tester flow file export (Level 2 integration)

**Status:** done

## Goal

Generate ready-to-run api-tester flow files (FlowFile v1 YAML) straight from
controller route metadata — the second integration level after OpenAPI import
(`x-transport`/`x-channel` extensions).

## Implementation

- `src/integrations/api-tester.ts`
  - `generateFlowFiles(target, opts)` — accepts a `@Module`, a controller, or an
    array; one `FlowFile` per controller via `HonoRouteBuilder.describe()`.
  - CRUD-aware ordering: collection GET → POST → item GET → PUT/PATCH → DELETE →
    other → SSE/WS last.
  - Chaining: collection `POST` nodes get `extractors` (`$.id` etc.) for the
    param names used by sibling item routes; downstream nodes consume `{{id}}`
    via `url` interpolation + `pathParams`.
  - `@Validate` schemas → sample request bodies (`bodyMode: raw`), disabled-by-
    default query params, and typed path params. `@Status` → `$status` assertion.
  - Guarded routes → `Authorization: Bearer {{token}}`; unresolved `{{vars}}`
    surface in `settings.defaultVariables`.
  - SSE nodes keep the http baseUrl; WS nodes get an absolute `ws://` URL.
  - Deterministic ids (hash of controller/handler names) — re-exports keep the
    same flow id so api-tester upserts instead of duplicating.
  - `stringifyFlowFile` — dependency-free YAML emitter (JSON-quoted scalars are
    valid YAML); `writeFlowFiles(dir, target)` writes `*.flow.yaml`.
- Export `zodToJsonSchema` from `openapi/generator.ts` (was private).
- `src/integrations/index.ts` barrel wired into `src/index.ts`.
- `examples/todo-api/export-flows.ts` — runnable demo; `AppModule` exported.
- `tests/api-tester.test.ts` — 11 tests incl. `Bun.YAML.parse` roundtrip.
- README: "api-tester integration" section.

## Verify

- `bun test tests/api-tester.test.ts` — 11 pass.
- Generated YAML round-trips through api-tester's real `yamlToFlow`
  (verified end-to-end with a fixture module).
- `bun examples/todo-api/export-flows.ts` writes `flows/todo.flow.yaml` +
  `flows/feed.flow.yaml`.
