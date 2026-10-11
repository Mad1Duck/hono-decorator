# 83 — Generated flows: complete metadata (query, params, responses, multipart)

## Problem

Generated `.flow.yaml` nodes only covered part of the route surface: body
schemas (after #82) and a status assertion. Query params only came from
`@Validate({query})`, path params were bare `{{param}}` blanks, `@ApiQuery`/
`@ApiResponse` metadata was ignored, and file-upload bodies generated a JSON
example where a file field couldn't be represented.

## Changes (`src/integrations/api-tester.ts`)

- **Query params**: `@ApiQuery(name, schema, {required})` entries now merge
  into `config.query` for params not already covered by
  `@Validate({query})` — required → enabled row, optional → disabled
  placeholder, values from `jsonSchemaToExample`.
- **Path params**: `@Validate({params})` schemas (already mirrored into
  `openapi.params`) seed the editable `{{param}}` variable defaults — a uuid
  param gets a real uuid as the flow variable, enabled. New `varSeeds` map
  threaded through `buildControllerNodes` → `flowSettings`.
- **Status assertion**: expected status is now `@Status` → lowest documented
  2xx from `@ApiResponse` → conventional default (was: `@Status` → default).
- **Response body → assertions**: `responseShapeAssertions` falls back to
  `@ApiResponse(<expected>, schema)` when no `@Serialize` contract exists —
  required top-level fields get `exists` assertions scoped `forStatus`.
- **Body type detection**: `bodyParts()` — schemas with a top-level
  `format: 'binary'` property (`z.file()`) become `bodyMode: 'form-data'`
  with `formData` rows: file fields → `{type:'file'}` rows awaiting a path,
  other fields → example values; no manual `Content-Type` (api-tester sets
  the multipart boundary). Plain schemas → raw JSON example as before.
  Schemas zod can't serialise (e.g. `z.instanceof(File)`) → empty raw body.
- `FlowKeyValue` gained `type`/`fileName`; `ApiTesterRestConfig` gained
  `formData` — matching api-tester's `KeyValue`/rest config shape.

## Verify

`bun test` → 393 pass (4 new tests under "metadata completeness": ApiQuery
rows, z.file → form-data, param seeds, ApiResponse status+shape assertions).
`tsc --noEmit` clean; `tsup` build OK.

README flow-files paragraph updated; frontend-docs `decorators.ts` +
`ApiTester.tsx` synced.
