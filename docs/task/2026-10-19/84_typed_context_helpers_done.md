# 84 — Typed context helpers: kill manual generics (`z.infer` boilerplate)

## Problem (from review)

`Body(c)` / `Query(c)` still need a hand-written generic when the route was
validated by `@Validate`:

```ts
@Validate({ body: CreateDto })
async create(c: Context) {
  const body = await Body<z.infer<typeof CreateDto>>(c); // boilerplate
}
```

The schema was already declared once on the decorator — typing
`z.infer<typeof Dto>` again in every handler is duplication NestJS's
`@Body() body: CreateDto` doesn't have. Meanwhile `Body(c, Schema)` already
*infers* `z.infer` from its schema arg — the gap is only in the
validated-cache path (`Body(c)` → `unknown`).

`ValidatedBody` already exists (`src/decorators/param.ts:265`) but is a bare
`Body` alias — no `ValidatedQuery`/`ValidatedParams`, no schema-typed
signature, no runtime guard when `@Validate` wasn't applied.

## Proposal

Make the `Validated*` family the schema-aware, cache-first API:

```ts
export async function ValidatedBody<S extends ZodTypeAny>(
  c: Context, schema: S,
): Promise<z.infer<S>>;
export async function ValidatedBody(c: Context): Promise<unknown>;
```

```ts
@Validate({ body: CreateDto, query: ListDto })
async list(c: Context) {
  const body = await ValidatedBody(c, CreateDto); // typed z.infer, cache hit
  const q    = await ValidatedQuery(c, ListDto);  // same for query
}
```

Semantics per helper:

1. If the `@Validate` cache is populated (`c.get(VALIDATED_*)`), **trust it and
   cast to `z.infer<S>`** — the decorator already ran the same schema, so a
   re-parse is wasted work.
2. If the cache is empty, **fall back to parsing with the given schema**
   (`schema.parseAsync(...)`) so the helper is self-sufficient on routes
   without `@Validate` — matching today's `Body(c, schema)` behaviour.
3. Called **without** a schema → return the cached value as `unknown`
   (never silently `any`); document that the generic form is deprecated in
   favour of the schema arg.

Helpers to add: `ValidatedQuery`, `ValidatedParams` (params →
`VALIDATED_PARAMS` cache; fallback `schema.parseAsync(c.req.param())` —
note params arrive as strings, so the schema should do the coercion it
already does under `@Validate({params})`).

Keep `Body`/`Query`/`Params` untouched for back-compat; mark the explicit
generic call signatures as "prefer `Validated*(c, Schema)`" in docstrings.

## Also worth doing while here

- README: replace `Body<z.infer<typeof Dto>>(c)` examples with
  `ValidatedBody(c, Dto)`; a short "validated vs raw helpers" table.
- `frontend-docs` guide: same example swap in the params/validation pages.
- Flow generator (`api-tester.ts`) is unaffected — it reads `@Validate`
  metadata, not handler calls.

## Files

- `src/decorators/param.ts` — `ValidatedQuery`, `ValidatedParams`, schema-aware
  overloads on `ValidatedBody`
- `tests/` — cache-hit cast, fallback parse, no-schema → unknown
- `README.md` + `../frontend-docs` — example + guide updates

## Acceptance

- `ValidatedBody(c, Dto)` / `ValidatedQuery(c, Dto)` /
  `ValidatedParams(c, Dto)` return `z.infer<typeof Dto>` with no manual
  generic.
- On `@Validate` routes the cached (already-parsed) value is returned without
  re-parsing; without `@Validate` the schema arg still validates.
- No existing `Body`/`Query`/`Params` signature changes — full back-compat.
- README + frontend-docs no longer show `Body<z.infer<…>>` boilerplate.

## Implemented (2026-10-19)

- `src/decorators/param.ts` — `ValidatedBody`/`ValidatedQuery`/`ValidatedParams`
  are schema-aware overloads (`ZodType<T>` → `Promise<T>`/`T`), all
  cache-first on the `VALIDATED_*` context keys, all fall back to
  `schema.parseAsync` on undecorated routes. Schema-less calls degrade to the
  raw helpers (raw JSON / raw query / raw params) instead of returning
  `undefined` — preserving the old alias semantics.
- `tests/validate.test.ts` — `ValidatedController` exercises cache-hit and
  fallback paths for all three helpers plus the raw-degrade path
  (7 new tests, 417 total).
- `README.md` — "Validated shorthands" rewritten (schema-first, cache-first),
  reference table gained the four `Validated*` rows, stale `@ValidatedQuery`
  param-decorator examples in pagination replaced by function calls.
- `frontend-docs/src/data/decorators.ts` — Validated entry updated.
