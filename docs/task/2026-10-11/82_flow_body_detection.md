# flows: request bodies for routes without @Validate

## Problem
Generated flow YAML showed no request body in api-tester unless the route
used `@Validate({ body })`. `@Body()` is a runtime helper (no metadata),
and `@ApiBody(schema)` — which does carry a Zod schema — was never read,
so mutation routes emitted `bodyMode` unset → api-tester rendered "none".

## Changes
- `src/integrations/api-tester.ts` — body schema now resolves
  `validation?.body ?? openapiMap[handler].body?.schema`, so @ApiBody-only
  routes get a generated JSON example.
- Schema-less POST/PUT/PATCH now emit `bodyMode: 'raw'` +
  `Content-Type: application/json` + `body: ''` — the raw editor is
  visible in api-tester but sends nothing, so no-body endpoints are safe.
- 3 tests: @ApiBody fallback, visible-empty raw for schema-less POST.

## Verify
- `bun test` 389 pass / 0 fail; `tsc --noEmit` clean; `bun run build` OK.
