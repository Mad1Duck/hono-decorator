import 'reflect-metadata';
import { METADATA_KEYS } from '../decorators/metadata';
import type { ConcreteConstructor } from '../core/types';

type AnyConstructor = ConcreteConstructor<unknown>;

/**
 * Scans a glob pattern and dynamically imports all files, returning every
 * class decorated with @Controller. Requires Bun runtime (uses Bun.Glob).
 *
 * @example
 * const controllers = await discoverControllers('./src/controllers/**\/*.ts');
 * const app = new Hono();
 * for (const ctrl of controllers) {
 *   app.route('/', HonoRouteBuilder.build(ctrl));
 * }
 */
export async function discoverControllers(
  pattern: string,
  options?: { cwd?: string }
): Promise<AnyConstructor[]> {
  if (typeof globalThis.Bun === 'undefined') {
    throw new Error(
      '[hono-forge] discoverControllers() requires Bun. ' +
      'On Node.js use fromModules() with import.meta.glob instead.'
    );
  }

  const cwd = options?.cwd ?? process.cwd();
  const glob = new globalThis.Bun.Glob(pattern);
  const controllers: AnyConstructor[] = [];

  for await (const file of glob.scan({ cwd })) {
    const absolutePath = `${cwd}/${file}`;
    const mod = await import(absolutePath) as Record<string, unknown>;
    extractControllers(mod, controllers);
  }

  return controllers;
}

/**
 * Extracts @Controller-decorated classes from a pre-loaded module map.
 * Works with any bundler that supports import.meta.glob (Vite, Bun bundler).
 *
 * @example
 * // Vite / Bun bundler
 * const modules = import.meta.glob('./controllers/**\/*.ts', { eager: true });
 * const controllers = fromModules(modules);
 *
 * const app = new Hono();
 * for (const ctrl of controllers) {
 *   app.route('/', HonoRouteBuilder.build(ctrl));
 * }
 */
export function fromModules(
  modules: Record<string, Record<string, unknown>>
): AnyConstructor[] {
  const controllers: AnyConstructor[] = [];
  for (const mod of Object.values(modules)) {
    extractControllers(mod, controllers);
  }
  return controllers;
}

function extractControllers(
  mod: Record<string, unknown>,
  out: AnyConstructor[]
): void {
  for (const exported of Object.values(mod)) {
    if (
      typeof exported === 'function' &&
      Reflect.getMetadata(METADATA_KEYS.CONTROLLER, exported) !== undefined
    ) {
      out.push(exported as AnyConstructor);
    }
  }
}
