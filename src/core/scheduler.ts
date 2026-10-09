import { container } from './container';
import { getLogger } from './logger';
import { nextCronTime, parseCron } from './cron';
import { METADATA_KEYS } from '../decorators/metadata';
import type { ModuleMetadata, ScheduleMetadata } from '../decorators/metadata';
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

/**
 * Scan classes (or `@Module` classes — traversed recursively) for `@Interval`
 * methods and start their timers.
 *
 * - Overlap guard: a tick is skipped while the previous run is still going.
 * - Errors are logged via `LOGGER`; the loop never crashes.
 * - Timers are `unref`'d so they don't hold the process open.
 *
 * Returns a teardown that clears every timer — wire it into
 * `gracefulShutdown({ onShutdown })`.
 *
 * Instances resolve lazily per tick via the DI container. `@RequestScoped`
 * jobs throw on tick (no request scope exists); keep jobs singleton/transient.
 */
export function startScheduler(...targets: Function[]): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let stoppedAll = false;

  for (const cls of collectTargets(targets)) {
    const scheduled = classMeta(cls)?.[METADATA_KEYS.SCHEDULE] as Record<string, ScheduleMetadata> | undefined;
    if (!scheduled) continue;

    for (const [method, meta] of Object.entries(scheduled)) {
      let running = false;
      const tick = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
          const inst = container.resolve(cls as ConcreteConstructor) as Record<string, unknown>;
          const fn = inst[method];
          if (typeof fn === 'function') await fn.call(inst);
        } catch (error) {
          getLogger().error?.({ job: `${cls.name}.${method}`, error }, 'Scheduled job failed');
        } finally {
          running = false;
        }
      };

      if (meta.cron) {
        // Cron entries fire at wall-clock times: compute the delay to the next
        // matching minute after each run, surviving clock drift/DST shifts.
        let parsed;
        try {
          parsed = parseCron(meta.cron);
        } catch (error) {
          getLogger().error?.({ job: `${cls.name}.${method}`, error }, 'Invalid cron expression — job skipped');
          continue;
        }
        const scheduleNext = (): void => {
          if (stoppedAll) return;
          const delay = Math.max(nextCronTime(parsed).getTime() - Date.now(), 0);
          const timer = setTimeout(() => void tick().finally(scheduleNext), delay);
          timer.unref?.();
          timers.push(timer);
        };
        scheduleNext();
      } else {
        const timer = setInterval(() => void tick(), meta.everyMs ?? 0);
        timer.unref?.();
        timers.push(timer);
      }
      if (meta.immediate) void tick();
    }
  }

  return () => {
    stoppedAll = true;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  };
}
