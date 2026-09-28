import type { Hono } from 'hono';

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
}

const startedAt = Date.now();

/**
 * Mount a health-check endpoint onto a Hono app.
 *
 * `GET /health` → `200 { status: 'ok', uptime, checks }` when all checks pass,
 * `503 { status: 'error', ... }` when any fails. Check failures (throws) are
 * reported as `down` — they never produce a 500.
 */
export function mountHealth(app: Hono, options: HealthOptions = {}): Hono {
  const path = options.path ?? '/health';
  const includeUptime = options.includeUptime ?? true;

  app.get(path, async (c) => {
    const checks: Record<string, HealthCheckResult> = {};
    let healthy = true;

    for (const [name, check] of Object.entries(options.checks ?? {})) {
      try {
        const result = await check();
        checks[name] =
          typeof result === 'boolean'
            ? { status: result ? 'up' : 'down' }
            : result;
        if (checks[name].status !== 'up') healthy = false;
      } catch {
        checks[name] = { status: 'down' };
        healthy = false;
      }
    }

    return c.json(
      {
        status: healthy ? 'ok' : 'error',
        ...(includeUptime ? { uptime: Math.floor((Date.now() - startedAt) / 1000) } : {}),
        ...(Object.keys(checks).length ? { checks } : {}),
      },
      healthy ? 200 : 503
    );
  });

  return app;
}
