# Task 57 — `mountMetrics` Prometheus endpoint

**Status:** done

## Goal

Expose the metrics the pipeline already knows about (request count,
duration, status per route) in Prometheus text exposition format — zero
dependencies.

## Implementation

- `src/utils/metrics.ts`
  - `MetricsRegistry` — named counters + histograms →
    `toPrometheus()` exposition text (`# TYPE`, `_bucket{le}`, `_sum`,
    `_count`).
  - Process-wide registry behind `Symbol.for('hono-forge.metricsRegistry')`
    — shared across bundled/duplicate package copies.
  - `mountMetrics(app, { path = '/metrics', buckets, exclude })` — Hono
    middleware records `http_requests_total{method,route,status}` and
    `http_request_duration_seconds`; `GET /metrics` renders the registry.
    Route label uses `c.req.routePath` (pattern, not raw URL → no label
    cardinality explosion). Metrics path never self-counts.
- `src/decorators/interceptor.ts` — `@TrackMetrics` now also feeds the
  registry (`hono_forge_method_duration_seconds{method,status}`) alongside
  any injected `metrics` service.
- `src/utils/app.ts` — `createApp(module, { metrics: true | options })`
  mounts collection before routes.

## Tests

`tests/production.test.ts` — counters/histogram output with labels and
`le="+Inf"`, exclude + self-exclusion.
