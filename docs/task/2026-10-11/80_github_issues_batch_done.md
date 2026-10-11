# GitHub issues batch — CLI runtime, idempotency, doctor, docs

Status: done

## Context

Three reported issues (Mad1Duck/hono-decorator #1, #2, #3) plus doc
requests surfaced during an external review of v5.5.1.

## Changes

### H1 — CLI re-exec under Bun when Node shim is hit (issue #1)

`bunx hono-forge` on Windows resolves the bin to a Node shim, then the CLI
told users to run the exact command that just failed. `src/cli.ts` now
detects the runtime via `process.versions.bun` (never the invocation
command), and when a TS entry fails to load under Node it transparently
re-execs `bun <cli.js> <args>` via `spawnSync` with inherited stdio.
Fallback message reports the accurate manual command
(`bun node_modules/hono-forge/dist/cli.js routes ...`).

### H2 — `@Idempotent` body-hash + scope (issue #2)

- `IdempotentMetadata` gains `hash` (default true) and
  `scope?: (c) => string`. Compiled in `src/decorators/interceptor.ts`.
- `route-builder.ts` snapshots now store `requestHash`; a replay lookup
  with a different fingerprint returns `409 Conflict` instead of a silent
  replay. Scope resolver output is folded into both the cache key and the
  inflight dedupe key, so tenants no longer share a namespace.
- Body fingerprint uses `c.req.arrayBuffer()` (Hono `bodyCache`) so a
  prior `@Validate` parse doesn't break, and downstream handlers can
  still read the body.
- JSDoc + README now warn that the default in-memory cache is not
  durable across restarts.

### H3 — `doctor`: `@Injectable()` classes count as resolvable (issue #3)

`container.describe()` treated only explicit provider targets and
registered tokens as known, so concrete `@Injectable()` classes — which
self-resolve at runtime — produced false positives. `describe()` now
traverses dependencies transitively and marks any dependency whose
class carries `@Injectable()` metadata as resolvable. Genuine gaps
(undecorated classes, unregistered string/symbol tokens) are still
flagged.

### H4 — execution-order diagram in README

`class middlewares → method middlewares → rate limit → guards →
validation → handler → serialize → interceptors → response`, plus where
`@Throttle`, `@Idempotent`, and `@Serialize` sit in the chain.

### H5 — WS/channel auth recipe + `@ChannelAuth`

New `@ChannelAuth((c, channel) => boolean)` decorator — runs as a
middleware before the SSE/WS upgrade, receives the resolved channel
pattern, returns false → 403. README recipe shows `hono/jwt` `verify()`
at upgrade plus channel-level authorization.

### H6 — small items

- `@Throttle` scope-key already documented (instance-keyed, global on
  singletons).
- `@ApiSecurity` auto-detection from `@JwtAuth` verified in
  `openapi/generator.ts` — no change needed.

## Tests

- `tests/route-builder.test.ts` — idempotent body-mismatch 409, scoped
  namespaces, channel auth allow/deny.
- `tests/container.test.ts` — `@Injectable` classes resolvable in
  `describe()`, undecorated classes still flagged.
- `bun test`: 374 pass / 0 fail; `tsc --noEmit` clean; `tsup` build ok.
- Smoke: `node dist/cli.js routes .ts-entry` re-execs to Bun and prints
  the route table; `doctor` flags only the undecorated dep.
