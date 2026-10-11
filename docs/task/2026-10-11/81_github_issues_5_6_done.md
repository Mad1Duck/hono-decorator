# 81 — GitHub issues #5 & #6: durable cache adapters + flows auth preamble

## Issue #5 — durable store for @Idempotent/@Cache

- `RedisCacheAdapter` — `CacheAdapter` over an ioredis-shaped client
  (`get`/`set 'PX'`/`del`/`keys`), JSON CacheEntry blobs, `hono-forge:cache:`
  key prefix. Survives restarts, shared across replicas.
- `PostgresCacheAdapter` — driver-free via `SqlQueryFn`; atomic
  `INSERT ... ON CONFLICT` upsert, lazy expiry on read + `prune()`,
  `createTableSql()` ships the DDL. Table name validated against injection.
- Named adapters — `configure().cacheAdapters: Record<string, CacheAdapter>`
  + `adapter?: string` on `@Cache`/`@Idempotent`. Unknown names throw at
  route-build time (fail fast, not first request). Use case from the issue:
  idempotency on Postgres (durable, atomic claim), response cache on Redis
  (fast, volatile).
- README — durability matrix + examples.

## Issue #6 — `flows` for authenticated APIs

Generated flows already got `Authorization: Bearer {{token}}` on guarded
routes — but nothing produced `token`, so every request 401'd.

- `GenerateFlowOptions.auth: FlowAuthSpec` — `{ method, path, body?, extract }`.
  Per-controller files: login node prepended to the chain (edges auto-wire).
  `--single` file: one ungrouped login node edged into every controller group.
- Extract paths normalized to `$.…` (jsonpath-plus). `{{vars}}` in the body
  become editable defaultVariables; extracted vars count as *produced* so
  `token` no longer appears as a blank variable.
- CLI: `--auth '<METHOD> <path>'`, `--auth-body <json>`,
  `--auth-extract <var=path,...>` (default `token=data.accessToken`).

## Verify

- `bunx tsc --noEmit` clean; `bun test` 386 pass (+12); `bun run build` OK
- CLI smoke: fixture module → `flows --auth 'POST /auth/login' …` produces
  login node + `$.accessToken` extractor + `user`/`pass` editable vars
- frontend-docs decorators catalog updated (`@Cache`, cacheAdapter config,
  `@Idempotent`, `hono-forge flows`)
