import { Hono } from 'hono';
import { HonoRouteBuilder } from '../core/route-builder';
import { OpenAPIGenerator } from '../openapi/generator';
import type { OpenAPIGenerateOptions, OpenAPIMountOptions } from '../openapi/generator';
import { mountHealth } from './health';
import type { HealthOptions } from './health';
import { mountMetrics } from './metrics';
import type { MetricsOptions } from './metrics';
import { gracefulShutdown } from './shutdown';
import type { GracefulShutdownOptions } from './shutdown';

type Constructor = new (...args: unknown[]) => unknown;

export interface CreateAppOptions {
  /**
   * Mount `GET /health` (200 ok / 503 with per-check detail).
   * Pass `true` for a liveness-only endpoint, or `{ path, checks }`.
   */
  health?: boolean | HealthOptions;
  /**
   * Generate the OpenAPI spec from the module's controllers and mount
   * `GET /openapi.json` + Scalar UI at `/docs`. Mount options
   * (`openapiPath`, `docsPath`) may be included.
   */
  openapi?: OpenAPIGenerateOptions & OpenAPIMountOptions;
  /** Print the route table (method/path/handler/guards) at startup. */
  printRoutes?: boolean;
  /**
   * Collect HTTP metrics and mount `GET /metrics` (Prometheus text format).
   * Pass `true` for defaults, or `{ path, buckets, exclude }`.
   */
  metrics?: boolean | MetricsOptions;
  /**
   * Wire SIGINT/SIGTERM → `container.shutdown()` → exit.
   * Pass `true` for defaults, or `{ timeoutMs, onShutdown }`.
   */
  shutdown?: boolean | GracefulShutdownOptions;
}

/**
 * One-call application bootstrap — wires the pieces every app needs without
 * manual plumbing:
 *
 * @example
 * import { createApp } from 'hono-forge';
 *
 * const app = createApp(AppModule, {
 *   health: { checks: { db: () => db.ping() } },
 *   openapi: { info: { title: 'Todo API', version: '1.0.0' } },
 *   printRoutes: true,
 *   shutdown: true,
 * });
 *
 * export default app; // → routes, /health, /docs, graceful shutdown
 */
export function createApp(ModuleClass: Function, options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  if (options.metrics) {
    mountMetrics(app, options.metrics === true ? {} : options.metrics);
  }
  app.route('/', HonoRouteBuilder.buildModule(ModuleClass));

  if (options.health) {
    mountHealth(app, options.health === true ? {} : options.health);
  }

  if (options.openapi) {
    const controllers = HonoRouteBuilder.moduleControllers(ModuleClass) as unknown as Constructor[];
    OpenAPIGenerator.mount(app, controllers, options.openapi);
  }

  if (options.printRoutes) {
    HonoRouteBuilder.printRoutes(ModuleClass);
  }

  if (options.shutdown) {
    gracefulShutdown(options.shutdown === true ? {} : options.shutdown);
  }

  return app;
}
