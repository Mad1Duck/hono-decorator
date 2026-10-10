import { METADATA_KEYS } from './metadata';

/**
 * Mark a method to run once after the module's routes are built — the
 * "application is ready" hook (seed data, warm caches, emit readiness).
 *
 * Fired by `buildModule()`/`createApp()` after all routes are mounted, and
 * once per class per process (re-building the same module does not re-run
 * it). Async return values are awaited internally — errors are logged via
 * `LOGGER` and never fail the build. Runs detached: the hook may still be
 * in-flight when `buildModule` returns; await `runBootstrap(Module)` yourself
 * if ordering matters at startup.
 *
 * For per-instance lifecycle use the `onInit`/`onDestroy` interface methods
 * (`container.boot()`/`container.shutdown()`); `@OnBootstrap` is the
 * app-level counterpart — providers AND controllers can use it.
 *
 * @example
 * @Injectable() @Singleton()
 * class SeedService {
 *   @OnBootstrap()
 *   async seed() { await this.db.seedDemoData(); }
 * }
 */
export function OnBootstrap(): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.ON_BOOTSTRAP] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.ON_BOOTSTRAP] = all;
  };
}
