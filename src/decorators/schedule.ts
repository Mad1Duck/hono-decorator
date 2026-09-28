import { METADATA_KEYS } from './metadata';
import type { ScheduleMetadata } from './metadata';

export interface IntervalOptions {
  /** Run once immediately when the scheduler starts (default: wait first interval). */
  immediate?: boolean;
}

/**
 * Schedule a service method to run every `ms` milliseconds. Activated by
 * `startScheduler([...])`; timers stop via the returned teardown (call it from
 * `gracefulShutdown`'s `onShutdown`).
 *
 * Overlap guard: if a run is still in progress when the next tick fires, the
 * tick is skipped. Errors are logged via the registered `LOGGER` and never
 * crash the loop.
 *
 * @example
 * @Injectable()
 * @Singleton()
 * class Janitor {
 *   @Interval(60_000)
 *   sweep() { ... }
 * }
 */
export function Interval(
  ms: number,
  options: IntervalOptions = {}
): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.SCHEDULE] as Record<string, ScheduleMetadata> | undefined) ?? {};
    all[String(context.name)] = { everyMs: ms, immediate: options.immediate };
    context.metadata[METADATA_KEYS.SCHEDULE] = all;
  };
}
