import type { ConcreteConstructor, Factory, InjectionToken } from './types';
import { METADATA_KEYS } from '../decorators/metadata';
import { getRequestContext, createRequestContext, runInRequestContext } from './request-context';

/* ================= LIFECYCLE TYPE GUARDS ================= */

function hasOnInit(v: unknown): v is { onInit(): Promise<void> | void; } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['onInit'] === 'function';
}

function hasOnDestroy(v: unknown): v is { onDestroy(): Promise<void> | void; } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['onDestroy'] === 'function';
}

type ClassMeta = Record<symbol, unknown>;

function classMeta(target: Function): ClassMeta | null {
  return (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata] ?? null;
}

/* ================= CUSTOM ERRORS ================= */

export class DependencyResolutionError extends Error {
  constructor(public readonly token: InjectionToken, message: string) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

export class CircularDependencyError extends Error {
  constructor(public readonly chain: string[]) {
    super(`Circular dependency detected: ${chain.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

/* ================= CONTAINER ================= */

export class Container {
  private singletons = new Map<InjectionToken, unknown>();
  private factories = new Map<InjectionToken, Factory>();
  private resolutionStack: string[] = [];

  registerInstance<T>(token: InjectionToken<T>, instance: T): void {
    this.singletons.set(token, instance);
  }

  registerSingleton<T>(token: InjectionToken<T>, instance: T): void {
    this.singletons.set(token, instance);
  }

  registerFactory<T>(token: InjectionToken<T>, factory: Factory<T>): void {
    this.factories.set(token, factory);
  }

  resolve<T>(target: ConcreteConstructor<T>): T {
    const targetName = this.getTokenName(target);

    if (this.resolutionStack.includes(targetName)) {
      throw new CircularDependencyError([...this.resolutionStack, targetName]);
    }

    const singleton = this.singletons.get(target);
    if (singleton !== undefined) return singleton as T;

    if (this.isRequestScoped(target)) {
      const ctx = getRequestContext();
      if (!ctx) {
        throw new DependencyResolutionError(
          target,
          `'${targetName}' is @RequestScoped but no active request scope was found. ` +
          `Ensure it is only resolved within a route handler managed by HonoRouteBuilder.`
        );
      }
      const cached = ctx.diScope.get(target);
      if (cached !== undefined) return cached as T;

      this.resolutionStack.push(targetName);
      let instance: T;
      try {
        instance = this.resolveViaConstructor(target);
        this.resolutionStack.pop();
      } catch (error) {
        this.resolutionStack.pop();
        throw error;
      }
      ctx.diScope.set(target, instance);
      return instance;
    }

    const factory = this.factories.get(target);
    if (factory !== undefined) {
      this.resolutionStack.push(targetName);
      try {
        const instance = factory() as T;
        this.resolutionStack.pop();
        if (this.isSingleton(target)) this.singletons.set(target, instance);
        return instance;
      } catch (error) {
        this.resolutionStack.pop();
        throw error;
      }
    }

    this.resolutionStack.push(targetName);
    try {
      let instance = this.resolveViaConstructor(target);

      if (this.isSingleton(target)) {
        if (classMeta(target)?.[METADATA_KEYS.STATELESS]) {
          instance = new Proxy(instance as object, {
            set(_obj, prop) {
              throw new Error(
                `[hono-forge] @Stateless singleton '${targetName}' attempted to mutate ` +
                `property '${String(prop)}'. @Stateless singletons must not hold mutable ` +
                `per-request state — use @RequestScoped() instead.`
              );
            },
          }) as T;
        }
        this.singletons.set(target, instance);
      }

      this.resolutionStack.pop();
      return instance;
    } catch (error) {
      this.resolutionStack.pop();
      throw error;
    }
  }

  private resolveViaConstructor<T>(target: ConcreteConstructor<T>): T {
    try {
      const tokens = this.getInjectTokens(target);
      if (tokens.length === 0 && target.length > 0) {
        throw new DependencyResolutionError(
          target,
          `'${target.name}' declares ${target.length} constructor parameter(s) but no injection tokens. ` +
          `Did you forget @Injectable([...]) with the dependency classes?`
        );
      }
      const dependencies = tokens.map((token, index) => {
        try {
          if (typeof token === 'function' && this.isRequestScoped(token)) {
            return this.createRequestScopedProxy(token);
          }
          return this.resolve(token as ConcreteConstructor);
        } catch (error) {
          throw new DependencyResolutionError(
            token,
            `Failed to resolve dependency at index ${index} for ${target.name}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      });

      return new target(...(dependencies as unknown[]));
    } catch (error) {
      if (error instanceof DependencyResolutionError || error instanceof CircularDependencyError) throw error;
      throw new DependencyResolutionError(
        target,
        `Failed to instantiate ${target.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Lazy proxy injected in place of a @RequestScoped dependency.
   * The real instance is resolved per property access inside the active request
   * scope, so a singleton constructor-injecting it never captures a stale
   * per-request instance. Access outside a request throws DependencyResolutionError.
   */
  private createRequestScopedProxy<T>(token: InjectionToken<T>): T {
    const name = this.getTokenName(token);
    const proto = typeof token === 'function' ? (token as ConcreteConstructor<T>).prototype : null;
    const real = (): object => {
      if (!getRequestContext()) {
        throw new DependencyResolutionError(
          token,
          `'${name}' is @RequestScoped and was accessed outside a request scope. ` +
          `Only touch this dependency inside a route handler.`
        );
      }
      return this.resolve(token as ConcreteConstructor<T>) as object;
    };
    return new Proxy(Object.create(proto ?? null) as object, {
      get: (_t, prop) => {
        const inst = real();
        const value = Reflect.get(inst, prop);
        return typeof value === 'function' ? value.bind(inst) : value;
      },
      set: (_t, prop, value) => Reflect.set(real(), prop, value),
      has: (_t, prop) => prop in real(),
      ownKeys: () => Reflect.ownKeys(real()),
      getOwnPropertyDescriptor: (_t, prop) => {
        const desc = Reflect.getOwnPropertyDescriptor(real(), prop);
        if (desc) desc.configurable = true;
        return desc;
      },
    }) as T;
  }

  /** Read explicit injection tokens declared via @Injectable([Token1, Token2, ...]). */
  private getInjectTokens(target: ConcreteConstructor): InjectionToken[] {
    const meta = classMeta(target);
    const tokens = meta?.[METADATA_KEYS.INJECT_PARAMS];
    if (!Array.isArray(tokens)) return [];
    return tokens as InjectionToken[];
  }

  private isSingleton(target: ConcreteConstructor): boolean {
    return Boolean(classMeta(target)?.[METADATA_KEYS.SINGLETON]);
  }

  private isRequestScoped(target: InjectionToken): boolean {
    if (typeof target !== 'function') return false;
    return Boolean(classMeta(target as Function)?.[METADATA_KEYS.REQUEST_SCOPED]);
  }

  private getTokenName(token: InjectionToken): string {
    if (typeof token === 'function') return token.name || 'AnonymousClass';
    return String(token);
  }

  has(token: InjectionToken): boolean {
    return this.singletons.has(token) || this.factories.has(token);
  }

  remove(token: InjectionToken): void {
    this.singletons.delete(token);
    this.factories.delete(token);
  }

  clear(): void {
    this.singletons.clear();
    this.factories.clear();
    this.resolutionStack = [];
  }

  /**
   * @internal Snapshot the registration maps for later restore().
   * Used by createTestingModule — not intended for application code.
   */
  snapshot(): { singletons: Map<InjectionToken, unknown>; factories: Map<InjectionToken, Factory>; } {
    return { singletons: new Map(this.singletons), factories: new Map(this.factories) };
  }

  /**
   * @internal Restore a snapshot() — drops every registration made after it.
   * Does not call onDestroy on dropped instances.
   */
  restore(snap: { singletons: Map<InjectionToken, unknown>; factories: Map<InjectionToken, Factory>; }): void {
    this.singletons = new Map(snap.singletons);
    this.factories = new Map(snap.factories);
  }

  getRegisteredTokens(): InjectionToken[] {
    return [...new Set([...this.singletons.keys(), ...this.factories.keys()])];
  }

  async runInScope<T>(fn: () => Promise<T>): Promise<T> {
    const ctx = getRequestContext();
    if (ctx) {
      const prevKeys = new Set(ctx.diScope.keys());
      try {
        return await fn();
      } finally {
        for (const [token, instance] of ctx.diScope) {
          if (!prevKeys.has(token)) {
            if (hasOnDestroy(instance)) await instance.onDestroy();
            ctx.diScope.delete(token); // a late resolve must not reuse a destroyed instance
          }
        }
      }
    }
    const newCtx = createRequestContext('');
    return runInRequestContext(newCtx, async () => {
      try {
        return await fn();
      } finally {
        for (const instance of newCtx.diScope.values()) {
          if (hasOnDestroy(instance)) await instance.onDestroy();
        }
      }
    });
  }

  async boot(): Promise<void> {
    for (const instance of this.singletons.values()) {
      if (hasOnInit(instance)) await instance.onInit();
    }
  }

  async shutdown(): Promise<void> {
    const instances = [...this.singletons.values()].reverse();
    for (const instance of instances) {
      if (hasOnDestroy(instance)) await instance.onDestroy();
    }
    this.singletons.clear();
    this.factories.clear();
  }
}

/* ================= INSTANCE ================= */

export const container = new Container();

/* ================= DI DECORATORS ================= */

/**
 * Mark a class as injectable.
 *
 * Pass an explicit token array for constructor injection:
 * @Injectable([Database, Logger])
 * class UserService {
 *   constructor(private db: Database, private logger: Logger) {}
 * }
 */
export function Injectable(tokens: InjectionToken[] = []): (value: Function, context: ClassDecoratorContext) => void {
  return (_value, context) => {
    context.metadata[METADATA_KEYS.INJECTABLE] = true;
    context.metadata[METADATA_KEYS.INJECT_PARAMS] = tokens;
  };
}

/**
 * Mark a class as singleton — same instance returned on every resolve.
 */
export function Singleton(): (value: Function, context: ClassDecoratorContext) => void {
  return (_value, context) => {
    context.metadata[METADATA_KEYS.SINGLETON] = true;
  };
}

/**
 * Mark a class as request-scoped — fresh instance per request, destroyed after.
 */
export function RequestScoped(): (value: Function, context: ClassDecoratorContext) => void {
  return (_value, context) => {
    context.metadata[METADATA_KEYS.REQUEST_SCOPED] = true;
  };
}

/**
 * Mark a @Singleton() class as holding no mutable per-request state.
 * The container wraps the instance in a Proxy that throws on any property write.
 */
export function Stateless(): (value: Function, context: ClassDecoratorContext) => void {
  return (_value, context) => {
    context.metadata[METADATA_KEYS.STATELESS] = true;
  };
}
