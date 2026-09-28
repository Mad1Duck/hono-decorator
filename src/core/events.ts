import { container } from './container';
import { getLogger } from './logger';
import { METADATA_KEYS } from '../decorators/metadata';
import type { ModuleMetadata, OnEventMetadata } from '../decorators/metadata';
import type { ConcreteConstructor } from './types';

type ClassMeta = Record<symbol, unknown>;

function classMeta(target: Function): ClassMeta | null {
  return (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata] ?? null;
}

interface EventListener {
  token: Function;
  method: string;
}

const listeners = new Map<string, EventListener[]>();

/* ================= EMIT ================= */

/**
 * In-process event bus. `events.emit(name, payload)` invokes every
 * `@OnEvent(name)` subscriber resolved through the DI container.
 *
 * Each listener is isolated — a throwing listener is logged via `LOGGER` and
 * never interrupts the others. `emit` itself never throws; it resolves after
 * all listeners settle.
 */
export const events = {
  async emit(name: string, payload?: unknown): Promise<void> {
    // Exact matches + `prefix.*` wildcards (e.g. @OnEvent('user.*')).
    const subs: EventListener[] = [];
    for (const [pattern, list] of listeners) {
      const matches =
        pattern === name ||
        (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1)));
      if (matches) subs.push(...list);
    }
    if (subs.length === 0) return;
    await Promise.all(
      subs.map(async ({ token, method }) => {
        try {
          const inst = container.resolve(token as ConcreteConstructor) as Record<string, unknown>;
          const fn = inst[method];
          if (typeof fn === 'function') await fn.call(inst, payload);
        } catch (error) {
          getLogger().error?.(
            { event: name, listener: `${token.name}.${method}`, error },
            'Event listener failed'
          );
        }
      })
    );
  },

  /** Number of listeners subscribed to an event — testing/debugging aid. */
  listenerCount(name: string): number {
    return listeners.get(name)?.length ?? 0;
  },
};

/* ================= REGISTRATION ================= */

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

/**
 * Scan classes (or `@Module` classes — providers/controllers/imports are
 * traversed recursively) for `@OnEvent` methods and subscribe them to the
 * event bus. Returns a teardown that removes the registered listeners.
 *
 * Listeners are resolved lazily per emit — `@Singleton` shares one instance,
 * default scope gets a fresh instance per emit. `@RequestScoped` listeners
 * throw (no request scope exists outside a request); keep listeners
 * singleton/transient.
 */
export function startEventBus(...targets: Function[]): () => void {
  const added: Array<{ event: string; listener: EventListener }> = [];

  for (const cls of collectTargets(targets)) {
    const onEvent = classMeta(cls)?.[METADATA_KEYS.ON_EVENT] as Record<string, OnEventMetadata> | undefined;
    if (!onEvent) continue;
    for (const [method, eventNames] of Object.entries(onEvent)) {
      for (const event of eventNames) {
        const listener: EventListener = { token: cls, method };
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        added.push({ event, listener });
      }
    }
  }

  return () => {
    for (const { event, listener } of added) {
      const list = listeners.get(event);
      if (!list) continue;
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) listeners.delete(event);
    }
  };
}
