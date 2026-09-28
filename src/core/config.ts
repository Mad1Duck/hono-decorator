import type { z } from 'zod';
import { container } from './container';

/**
 * DI token for the application config object — the parsed output of the Zod
 * schema passed to {@link registerConfig}. Inject like any token:
 *
 * @example
 * @Injectable([CONFIG])
 * class DbService { constructor(private cfg: AppConfig) {} }
 */
export const CONFIG: unique symbol = Symbol('hono-forge:config');

/**
 * Parse `source` (default `process.env`) against a Zod schema **once** and
 * bind the result to the {@link CONFIG} token. Throws a descriptive error at
 * boot listing every invalid field — fail-fast instead of runtime `undefined`.
 *
 * @example
 * const EnvSchema = z.object({ PORT: z.coerce.number(), DATABASE_URL: z.string() });
 * export const env = registerConfig(EnvSchema);
 */
export function registerConfig<T>(
  schema: z.ZodType<T>,
  source: Record<string, unknown> = process.env as Record<string, unknown>
): T {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`[hono-forge] Invalid config:\n${fields}`);
  }
  container.registerInstance(CONFIG, parsed.data);
  return parsed.data;
}

/**
 * Get the registered config object. Throws when `registerConfig` has not been
 * called — prefer injection via `CONFIG` inside providers.
 */
export function getConfig<T = unknown>(): T {
  if (!container.has(CONFIG)) {
    throw new Error('[hono-forge] getConfig: no config registered — call registerConfig(schema) at boot.');
  }
  return container.resolve(CONFIG as never) as T;
}
