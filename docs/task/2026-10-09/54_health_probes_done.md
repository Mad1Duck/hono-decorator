# Task 54 — Liveness/readiness split in `mountHealth`

**Status:** done

## Goal

Kubernetes needs two probes: liveness ("is the process alive — restart if
not") must NOT depend on downstream services, readiness ("can it serve
traffic") should reflect dependencies.

## Implementation

`src/utils/health.ts` — new `HealthOptions.probes: boolean` and
`liveChecks?: Record<string, HealthCheck>`:

- `GET {path}/live` — runs `liveChecks` only (default: none → always 200).
- `GET {path}/ready` — runs `checks`; 503 when any dependency is down.
- `GET {path}` — unchanged combined behaviour (backward compatible).
- `includeUptime`, `path` options apply to all three endpoints.
- `createApp` forwards `health: { probes: true, ... }` unchanged.

## Tests

`tests/production.test.ts` — dead `db` check → `/live` stays 200, `/ready`
and `/health` go 503; `liveChecks` gate `/live` independently of `checks`.
