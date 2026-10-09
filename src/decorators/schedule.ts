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

/**
 * Schedule a service method on a standard 5-field cron expression
 * (`min hour day-of-month month day-of-week`), evaluated in local time.
 * Activated by `startScheduler([...])` alongside @Interval.
 *
 * Fields support `*`, `*\/n`, `a`, `a-b`, `a-b/n`, and `a,b,c` lists.
 * When both day-of-month and day-of-week are restricted, EITHER may match
 * (Vixie cron semantics).
 *
 * @example
 * @Cron('0 2 * * *')        // daily at 02:00
 * nightlyBackup() { ... }
 *
 * @Cron('*\/15 9-17 * * 1-5') // every 15 min, 09:00–17:00, Mon–Fri
 * pollFeed() { ... }
 */
export function Cron(
  expression: string,
  options: IntervalOptions = {}
): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.SCHEDULE] as Record<string, ScheduleMetadata> | undefined) ?? {};
    all[String(context.name)] = { cron: expression, immediate: options.immediate };
    context.metadata[METADATA_KEYS.SCHEDULE] = all;
  };
}
