import { container } from './container';
import { getLogger } from './logger';
import { METADATA_KEYS } from '../decorators/metadata';
import type { ModuleMetadata } from '../decorators/metadata';
import type { ConcreteConstructor } from './types';

type ClassMeta = Record<symbol, unknown>;

function classMeta(target: Function): ClassMeta | null {
  return (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata] ?? null;
}

function collectTargets(targets: Function[], seen = new Set<Function>()): Function[] {
  const out: Function[] = [];
  for (const t of targets) {
    if (seen.has(t)) continue;
    seen.add(t);
    const modMeta = classMeta(t)?.[METADATA_KEYS.MODULE] as ModuleMetadata | undefined;
    if (modMeta) {
      out.push(...collectTargets(
        [...(modMeta.providers ?? []), ...(modMeta.controllers ?? []), ...(modMeta.imports ?? [])] as Function[],
        seen
      ));
    } else {
      out.push(t);
    }
  }
  return out;
}

const bootstrapped = new WeakSet<Function>();

/**
 * Run every `@OnBootstrap` method reachable from `targets` (classes or
 * @Module trees — providers, controllers, and imports traversed).
 *
 * Called automatically by `buildModule()`/`createApp()` — call it yourself
 * only when wiring apps manually via `build()`/`buildControllers()`.
 * Idempotent per class per process: re-running skips already-bootstrapped
 * classes. Errors are logged via `LOGGER` and never thrown.
 */
export async function runBootstrap(...targets: Function[]): Promise<void> {
  for (const cls of collectTargets(targets)) {
    if (bootstrapped.has(cls)) continue;
    bootstrapped.add(cls);
    const hooks = classMeta(cls)?.[METADATA_KEYS.ON_BOOTSTRAP] as Record<string, boolean> | undefined;
    if (!hooks) continue;
    for (const method of Object.keys(hooks)) {
      try {
        const inst = container.resolve(cls as ConcreteConstructor) as Record<string, unknown>;
        const fn = inst[method];
        if (typeof fn === 'function') await fn.call(inst);
      } catch (error) {
        getLogger().error?.({ hook: `${cls.name}.${method}`, error }, 'Bootstrap hook failed');
      }
    }
  }
}
