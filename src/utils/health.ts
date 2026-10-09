import type { Context, Hono } from 'hono';

export interface HealthCheckResult {
  status: 'up' | 'down';
  details?: Record<string, unknown>;
}

/** A health check: return `true`/`'up'` when healthy. Throwing = down. */
export type HealthCheck = () =>
  | boolean
  | HealthCheckResult
  | Promise<boolean | HealthCheckResult>;

export interface HealthOptions {
  /** Endpoint path. Defaults to `/health`. */
  path?: string;
  /** Named checks (db, redis, ...). Endpoint is 200 only when all are up. */
  checks?: Record<string, HealthCheck>;
  /** Include process uptime in seconds. Default true. */
  includeUptime?: boolean;
  /**
   * Kubernetes-style probe split. When true, also mounts:
   * - `{path}/live` — is the process alive? 200 unless `liveChecks` fail.
   *   Liveness failure means "restart the pod", so it must NOT depend on
   *   downstream services.
   * - `{path}/ready` — can the process serve traffic? Runs `checks`.
   * The base `{path}` endpoint keeps the combined behaviour either way.
   */
  probes?: boolean;
  /** Optional checks for `{path}/live` (requires `probes: true`). */
  liveChecks?: Record<string, HealthCheck>;
}

const startedAt = Date.now();

async function runChecks(
  checks: Record<string, HealthCheck>,
): Promise<{ results: Record<string, HealthCheckResult>; healthy: boolean }> {
  const results: Record<string, HealthCheckResult> = {};
  let healthy = true;

  for (const [name, check] of Object.entries(checks)) {
    try {
      const result = await check();
      results[name] =
        typeof result === 'boolean'
          ? { status: result ? 'up' : 'down' }
          : result;
      if (results[name]!.status !== 'up') healthy = false;
    } catch {
      results[name] = { status: 'down' };
      healthy = false;
    }
  }
  return { results, healthy };
}

/**
 * Mount a health-check endpoint onto a Hono app.
 *
 * `GET /health` → `200 { status: 'ok', uptime, checks }` when all checks pass,
 * `503 { status: 'error', ... }` when any fails. Check failures (throws) are
 * reported as `down` — they never produce a 500.
 *
 * With `probes: true`, also mounts `/health/live` (process alive — for k8s
 * livenessProbe) and `/health/ready` (dependencies up — for readinessProbe).
 */
export function mountHealth(app: Hono, options: HealthOptions = {}): Hono {
  const path = options.path ?? '/health';
  const includeUptime = options.includeUptime ?? true;

  const healthHandler = (checks: Record<string, HealthCheck>) => async (c: Context) => {
    const { results, healthy } = await runChecks(checks);
    return c.json(
      {
        status: healthy ? 'ok' : 'error',
        ...(includeUptime ? { uptime: Math.floor((Date.now() - startedAt) / 1000) } : {}),
        ...(Object.keys(results).length ? { checks: results } : {}),
      },
      healthy ? 200 : 503
    );
  };

  app.get(path, healthHandler(options.checks ?? {}));

  if (options.probes) {
    app.get(`${path}/live`, healthHandler(options.liveChecks ?? {}));
    app.get(`${path}/ready`, healthHandler(options.checks ?? {}));
  }

  return app;
}
