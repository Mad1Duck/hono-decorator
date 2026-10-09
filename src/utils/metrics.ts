import type { Context, Hono, Next } from 'hono';

/**
 * Prometheus-compatible metrics for hono-forge.
 *
 * `mountMetrics(app)` registers a middleware that records every HTTP request
 * and mounts a `GET /metrics` endpoint in Prometheus exposition format:
 *
 *   http_requests_total{method="GET",route="/todos/:id",status="200"} 42
 *   http_request_duration_seconds_bucket{method="GET",route="/todos/:id",le="0.1"} 40
 *   http_request_duration_seconds_sum{...} 3.21
 *   http_request_duration_seconds_count{...} 42
 *
 * Scrape config:
 *   scrape_configs:
 *     - job_name: my-api
 *       static_configs: [{ targets: ['localhost:3000'] }]
 */

export interface MetricsOptions {
  /** Metrics endpoint path. Default `/metrics`. */
  path?: string;
  /** Duration histogram buckets in seconds. */
  buckets?: number[];
  /** Exclude these paths from collection (metrics path is always excluded). */
  exclude?: string[];
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Labels = Record<string, string>;
type Key = string;

function labelKey(labels: Labels): Key {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${v}"`).join(',');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

interface CounterEntry { value: number }
interface HistogramEntry { buckets: number[]; counts: number[]; sum: number; count: number }

export class MetricsRegistry {
  private readonly counters = new Map<Key, { name: string; labels: Labels; entry: CounterEntry }>();
  private readonly histograms = new Map<Key, { name: string; labels: Labels; entry: HistogramEntry }>();

  /** Increment a named counter. */
  increment(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}|${labelKey(labels)}`;
    let row = this.counters.get(key);
    if (!row) {
      row = { name, labels, entry: { value: 0 } };
      this.counters.set(key, row);
    }
    row.entry.value += by;
  }

  /** Observe a duration (seconds) into a named histogram. */
  observe(name: string, value: number, labels: Labels = {}, buckets: number[] = DEFAULT_BUCKETS): void {
    const key = `${name}|${labelKey(labels)}`;
    let row = this.histograms.get(key);
    if (!row) {
      row = { name, labels, entry: { buckets, counts: buckets.map(() => 0), sum: 0, count: 0 } };
      this.histograms.set(key, row);
    }
    const h = row.entry;
    h.sum += value;
    h.count += 1;
    for (let i = 0; i < h.buckets.length; i++) {
      if (value <= h.buckets[i]!) h.counts[i]! += 1;
    }
  }

  /** Render the registry in Prometheus text exposition format. */
  toPrometheus(): string {
    const lines: string[] = [];
    const seenNames = new Set<string>();

    for (const { name, labels, entry } of this.counters.values()) {
      if (!seenNames.has(name)) {
        seenNames.add(name);
        lines.push(`# TYPE ${name} counter`);
      }
      const l = Object.keys(labels).length ? `{${labelKey(labels)}}` : '';
      lines.push(`${name}${l} ${entry.value}`);
    }

    for (const { name, labels, entry } of this.histograms.values()) {
      if (!seenNames.has(name)) {
        seenNames.add(name);
        lines.push(`# TYPE ${name} histogram`);
      }
      const base = labelKey(labels);
      const open = Object.keys(labels).length ? `{${base},` : '{';
      for (let i = 0; i < entry.buckets.length; i++) {
        lines.push(`${name}_bucket${open}le="${entry.buckets[i]}"} ${entry.counts[i]}`);
      }
      lines.push(`${name}_bucket${open}le="+Inf"} ${entry.count}`);
      const close = Object.keys(labels).length ? `{${base}}` : '';
      lines.push(`${name}_sum${close} ${entry.sum}`);
      lines.push(`${name}_count${close} ${entry.count}`);
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

// Global symbol so multiple hono-forge copies (bundled CLI, monorepo) share
// one registry — same rationale as Symbol.for metadata keys.
const REGISTRY_KEY = Symbol.for('hono-forge.metricsRegistry');
const globalScope = globalThis as Record<symbol, MetricsRegistry | undefined>;

/** Process-wide metrics registry used by `mountMetrics` and `TrackMetrics`. */
export function getMetricsRegistry(): MetricsRegistry {
  return (globalScope[REGISTRY_KEY] ??= new MetricsRegistry());
}

function routeLabel(c: Context): string {
  // Hono exposes the matched route pattern; fall back to raw path.
  const req = c.req as unknown as { routePath?: string; path: string };
  return req.routePath ?? req.path;
}

/**
 * Mount HTTP metrics collection + a Prometheus scrape endpoint.
 *
 * Call BEFORE building routes so the middleware wraps every handler:
 *   const app = new Hono();
 *   mountMetrics(app);
 *   new HonoRouteBuilder(app).buildControllers(controllers);
 */
export function mountMetrics(app: Hono, options: MetricsOptions = {}): MetricsRegistry {
  const registry = getMetricsRegistry();
  const path = options.path ?? '/metrics';
  const buckets = options.buckets ?? DEFAULT_BUCKETS;
  const excluded = new Set([path, ...(options.exclude ?? [])]);

  app.use('*', async (c, next: Next) => {
    if (excluded.has(c.req.path)) return next();
    const start = performance.now();
    await next();
    const duration = (performance.now() - start) / 1000;
    const labels = {
      method: c.req.method,
      route: routeLabel(c),
      status: String(c.res.status),
    };
    registry.increment('http_requests_total', labels);
    registry.observe('http_request_duration_seconds', duration, labels, buckets);
  });

  app.get(path, (c) => {
    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return c.body(registry.toPrometheus());
  });

  return registry;
}
