import { Hono } from 'hono';
import { container } from './container';
import { HonoRouteBuilder } from './route-builder';
import type { ConcreteConstructor, ControllerConstructor, Factory, InjectionToken } from './types';

/* ================= TESTING MODULE ================= */

interface OverrideEntry {
  token: InjectionToken;
  kind: 'value' | 'class' | 'factory';
  value?: unknown;
  cls?: ConcreteConstructor;
  factory?: Factory;
}

export interface OverrideBuilder {
  /** Replace the provider with a fixed instance/value (e.g. a mock). */
  useValue<T>(value: T): TestingModuleBuilder;
  /** Replace the provider with another injectable class. */
  useClass(cls: ConcreteConstructor): TestingModuleBuilder;
  /** Replace the provider with a factory function. */
  useFactory(factory: Factory): TestingModuleBuilder;
}

/**
 * Compiled test module: an isolated view of the DI container with all
 * overrides applied. Always call cleanup() after the test to restore the
 * real container.
 */
export class TestingModule {
  constructor(
    private readonly snap: { singletons: Map<InjectionToken, unknown>; factories: Map<InjectionToken, Factory>; },
    private readonly controllers: ControllerConstructor[],
  ) { }

  /** Resolve a provider/controller from the overridden container. */
  get<T>(token: ConcreteConstructor<T>): T {
    return container.resolve(token);
  }

  /** Build all declared controllers into a single Hono app. */
  createApp(): Hono {
    const app = new Hono();
    for (const ctrl of this.controllers) {
      app.route('/', HonoRouteBuilder.build(ctrl));
    }
    return app;
  }

  /**
   * Restore the container to its pre-compile() state. Overrides and any
   * singletons created during the test are dropped — onDestroy is NOT called
   * on them (mocks generally don't need teardown; call it yourself if yours do).
   */
  cleanup(): void {
    container.restore(this.snap);
  }
}

export class TestingModuleBuilder {
  private overrides: OverrideEntry[] = [];

  constructor(private readonly controllers: ControllerConstructor[]) { }

  /** Start an override for a provider token (class, string, or symbol). */
  overrideProvider<T>(token: InjectionToken<T>): OverrideBuilder {
    const self = this;
    return {
      useValue(value: unknown) {
        self.overrides.push({ token, kind: 'value', value });
        return self;
      },
      useClass(cls: ConcreteConstructor) {
        self.overrides.push({ token, kind: 'class', cls });
        return self;
      },
      useFactory(factory: Factory) {
        self.overrides.push({ token, kind: 'factory', factory });
        return self;
      },
    };
  }

  /** Apply overrides on a container snapshot and return the test module. */
  compile(): TestingModule {
    const snap = container.snapshot();
    try {
      for (const o of this.overrides) {
        container.remove(o.token); // clear any cached singleton so the override wins
        if (o.kind === 'value') container.registerInstance(o.token, o.value);
        else if (o.kind === 'class') container.registerFactory(o.token, () => container.resolve(o.cls!));
        else container.registerFactory(o.token, o.factory!);
      }
      return new TestingModule(snap, this.controllers);
    } catch (error) {
      container.restore(snap);
      throw error;
    }
  }
}

/**
 * Create an isolated DI environment for unit/integration tests.
 * Framework-agnostic — works with bun:test, vitest, node:test, etc.
 *
 * @example
 * const mod = createTestingModule({ controllers: [UserController] })
 *   .overrideProvider(UserService).useValue(mockService)
 *   .compile();
 *
 * const res = await mod.createApp().fetch(new Request('http://t/users'));
 * mod.cleanup();
 */
export function createTestingModule(
  options: { controllers?: ControllerConstructor[]; } = {}
): TestingModuleBuilder {
  return new TestingModuleBuilder(options.controllers ?? []);
}
