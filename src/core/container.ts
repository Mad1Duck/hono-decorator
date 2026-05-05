import 'reflect-metadata';
import type {
  ConcreteConstructor,
  Factory,
  InjectionToken,
} from './types';
import { getRequestContext, createRequestContext, runInRequestContext } from './request-context';

/* ================= LIFECYCLE TYPE GUARDS ================= */

function hasOnInit(v: unknown): v is { onInit(): Promise<void> | void; } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['onInit'] === 'function';
}

function hasOnDestroy(v: unknown): v is { onDestroy(): Promise<void> | void; } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['onDestroy'] === 'function';
}

/* ================= CUSTOM ERRORS ================= */

/**
 * Thrown when a dependency cannot be resolved
 */
export class DependencyResolutionError extends Error {
  constructor(
    public readonly token: InjectionToken,
    message: string
  ) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

/**
 * Thrown when a circular dependency is detected
 */
export class CircularDependencyError extends Error {
  constructor(
    public readonly chain: string[]
  ) {
    super(`Circular dependency detected: ${chain.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

/* ================= CONTAINER ================= */

/**
 * Dependency injection container
 * 
 * Supports singleton and transient lifetimes, constructor injection,
 * and factory registration.
 * 
 * @example Basic usage
 * ```typescript
 * @Injectable()
 * class UserService {
 *   constructor(private db: Database) {}
 * }
 * 
 * const service = container.resolve(UserService);
 * ```
 * 
 * @example Factory registration
 * ```typescript
 * container.registerFactory(Database, () => new Database(config));
 * ```
 */
export class Container {
  private singletons = new Map<InjectionToken, unknown>();
  private factories = new Map<InjectionToken, Factory>();
  private resolutionStack: string[] = []; // For circular dependency detection

  /**
   * Register a pre-created instance under a token.
   * Use this for external objects (database connections, config, SDK clients)
   * that you build yourself before the container starts.
   *
   * @example
   * ```typescript
   * const DB = Symbol('db');
   * container.registerInstance(DB, drizzle(connectionString));
   *
   * @Injectable()
   * class UserRepo {
   *   constructor(@Inject(DB) private db: DrizzleDb) {}
   * }
   * ```
   */
  registerInstance<T>(
    token: InjectionToken<T>,
    instance: T
  ): void {
    this.singletons.set(token, instance);
  }

  /**
   * Alias for registerInstance — kept for backwards compatibility.
   * Prefer registerInstance when registering a pre-built object.
   */
  registerSingleton<T>(
    token: InjectionToken<T>,
    instance: T
  ): void {
    this.singletons.set(token, instance);
  }

  /**
   * Register a factory function
   * @param token - Injection token
   * @param factory - Factory function that creates the instance
   * 
   * @example
   * ```typescript
   * container.registerFactory(Database, () => {
   *   return new Database(process.env.DB_URL);
   * });
   * ```
   */
  registerFactory<T>(
    token: InjectionToken<T>,
    factory: Factory<T>
  ): void {
    this.factories.set(token, factory);
  }

  /**
   * Resolve a dependency
   * @param target - Constructor or token to resolve
   * @returns Resolved instance
   * @throws {DependencyResolutionError} If dependency cannot be resolved
   * @throws {CircularDependencyError} If circular dependency detected
   * 
   * @example
   * ```typescript
   * const service = container.resolve(UserService);
   * ```
   */
  resolve<T>(target: ConcreteConstructor<T>): T {
    const targetName = this.getTokenName(target);

    // Check for circular dependencies
    if (this.resolutionStack.includes(targetName)) {
      throw new CircularDependencyError([
        ...this.resolutionStack,
        targetName,
      ]);
    }

    // Check singleton cache
    const singleton = this.singletons.get(target);
    if (singleton !== undefined) {
      return singleton as T;
    }

    // Check request-scoped
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

    // Check factory
    const factory = this.factories.get(target);
    if (factory !== undefined) {
      this.resolutionStack.push(targetName);
      try {
        const instance = factory() as T;
        this.resolutionStack.pop();

        if (this.isSingleton(target)) {
          this.singletons.set(target, instance);
        }

        return instance;
      } catch (error) {
        this.resolutionStack.pop();
        throw error;
      }
    }

    // Resolve via constructor injection
    this.resolutionStack.push(targetName);

    try {
      let instance = this.resolveViaConstructor(target);

      // Cache if singleton
      if (this.isSingleton(target)) {
        // @Stateless enforcement: wrap in a Proxy that throws on any property write
        // after the constructor has finished. This prevents accidental per-request
        // mutable state on a singleton. Reading is always allowed.
        if (Reflect.getMetadata('stateless', target)) {
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

  /**
   * Resolve dependency via constructor injection
   * @private
   */
  private resolveViaConstructor<T>(
    target: ConcreteConstructor<T>
  ): T {
    try {
      // Get constructor parameter types from metadata
      const paramTypes = this.getParamTypes(target);

      // Check for @Inject overrides (string/symbol tokens)
      const injectTokens: InjectionToken[] =
        (Reflect.getMetadata('inject:tokens', target) as InjectionToken[] | undefined) ?? [];

      // Resolve each dependency
      const dependencies = paramTypes.map((paramType, index) => {
        const token = injectTokens[index] ?? paramType;
        try {
          return this.resolve(token as ConcreteConstructor);
        } catch (error) {
          throw new DependencyResolutionError(
            paramType,
            `Failed to resolve dependency at index ${index} for ${target.name}: ${error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      });

      // Create instance with resolved dependencies
      // Type assertion is safe here because we control the injection
      return new target(...(dependencies as any[]));
    } catch (error) {
      if (
        error instanceof DependencyResolutionError ||
        error instanceof CircularDependencyError
      ) {
        throw error;
      }

      throw new DependencyResolutionError(
        target,
        `Failed to instantiate ${target.name}: ${error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /* ---------- HELPERS ---------- */

  /**
   * Get constructor parameter types from metadata
   * @private
   */
  private getParamTypes(
    target: ConcreteConstructor
  ): ConcreteConstructor[] {
    const meta = Reflect.getMetadata(
      'design:paramtypes',
      target
    ) as unknown;

    if (!Array.isArray(meta)) {
      return [];
    }

    // Filter out undefined (can happen with circular imports)
    return (meta as Array<ConcreteConstructor | undefined>)
      .filter((type): type is ConcreteConstructor => type !== undefined);
  }

  /**
   * Check if target is marked as singleton
   * @private
   */
  private isSingleton(target: ConcreteConstructor): boolean {
    return Boolean(Reflect.getMetadata('singleton', target));
  }

  /**
   * Check if target is marked as request-scoped
   * @private
   */
  private isRequestScoped(target: InjectionToken): boolean {
    if (typeof target !== 'function') return false;
    return Boolean(Reflect.getMetadata('requestScoped', target));
  }

  /**
   * Get readable name from token
   * @private
   */
  private getTokenName(token: InjectionToken): string {
    if (typeof token === 'function') {
      return token.name || 'AnonymousClass';
    }
    return String(token);
  }

  /* ---------- UTILITY ---------- */

  /**
   * Check if a token is registered
   * @param token - Token to check
   * @returns True if registered
   */
  has(token: InjectionToken): boolean {
    return (
      this.singletons.has(token) ||
      this.factories.has(token)
    );
  }

  /**
   * Remove a registration
   * @param token - Token to remove
   */
  remove(token: InjectionToken): void {
    this.singletons.delete(token);
    this.factories.delete(token);
  }

  /**
   * Clear all registrations
   * 
   * @example
   * ```typescript
   * // Useful in tests
   * afterEach(() => {
   *   container.clear();
   * });
   * ```
   */
  clear(): void {
    this.singletons.clear();
    this.factories.clear();
    this.resolutionStack = [];
  }

  /**
   * Get all registered tokens
   * @returns Array of registered tokens
   */
  getRegisteredTokens(): InjectionToken[] {
    return [
      ...new Set([
        ...this.singletons.keys(),
        ...this.factories.keys(),
      ]),
    ];
  }

  /**
   * Run a function inside a request scope.
   *
   * Request-scoped dependencies resolved within `fn` will get a fresh instance
   * per call. At the end of the scope (success or error), `onDestroy` is called
   * on all request-scoped instances created during the call.
   *
   * This is called automatically by HonoRouteBuilder for every HTTP handler.
   * You only need this manually when resolving request-scoped deps outside a route.
   *
   * @example
   * ```ts
   * const result = await container.runInScope(async () => {
   *   const svc = container.resolve(RequestScopedService);
   *   return svc.doWork();
   * });
   * ```
   */
  async runInScope<T>(fn: () => Promise<T>): Promise<T> {
    const ctx = getRequestContext();
    if (ctx) {
      // Already inside a request context (set by HonoRouteBuilder).
      // Use the existing diScope; track pre-existing keys so we only destroy
      // instances that were created during this runInScope call.
      const prevKeys = new Set(ctx.diScope.keys());
      try {
        return await fn();
      } finally {
        for (const [token, instance] of ctx.diScope) {
          if (!prevKeys.has(token) && hasOnDestroy(instance)) {
            await instance.onDestroy();
          }
        }
      }
    }
    // No context — called standalone outside the route builder.
    const newCtx = createRequestContext('');
    return runInRequestContext(newCtx, async () => {
      try {
        return await fn();
      } finally {
        for (const instance of newCtx.diScope.values()) {
          if (hasOnDestroy(instance)) {
            await instance.onDestroy();
          }
        }
      }
    });
  }

  /**
   * Initialize all registered singleton instances that implement `OnInit`.
   *
   * Call this once at app startup — after all dependencies are registered
   * but before starting the HTTP server.
   *
   * @example
   * ```ts
   * container.registerInstance(DB, drizzle(connectionString));
   * await container.boot();
   * app.listen(3000);
   * ```
   */
  async boot(): Promise<void> {
    for (const instance of this.singletons.values()) {
      if (hasOnInit(instance)) {
        await instance.onInit();
      }
    }
  }

  /**
   * Destroy all registered singleton instances that implement `OnDestroy`.
   *
   * Call this on process shutdown (SIGTERM, SIGINT) to clean up connections.
   * Singletons are destroyed in reverse registration order.
   *
   * @example
   * ```ts
   * process.on('SIGTERM', async () => {
   *   await container.shutdown();
   *   process.exit(0);
   * });
   * ```
   */
  async shutdown(): Promise<void> {
    const instances = [...this.singletons.values()].reverse();
    for (const instance of instances) {
      if (hasOnDestroy(instance)) {
        await instance.onDestroy();
      }
    }
  }
}

/* ================= INSTANCE ================= */

/**
 * Global container instance
 * 
 * @example
 * ```typescript
 * import { container } from '@/core/container';
 * 
 * const service = container.resolve(MyService);
 * ```
 */
export const container = new Container();

/* ================= DECORATORS ================= */

/**
 * Mark a class as injectable
 * 
 * Required for constructor injection to work. Classes without this
 * decorator can still be registered manually via registerSingleton
 * or registerFactory.
 * 
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(
 *     private database: Database,
 *     private logger: Logger
 *   ) {}
 * }
 * ```
 */
export function Injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('injectable', true, target);
  };
}

/**
 * Mark a class as singleton
 * 
 * Singleton classes are instantiated only once and the same instance
 * is returned on subsequent resolve calls.
 * 
 * @example
 * ```typescript
 * @Injectable()
 * @Singleton()
 * export class Database {
 *   private connection: Connection;
 *   
 *   constructor() {
 *     this.connection = createConnection();
 *   }
 * }
 * ```
 */
export function Singleton(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('singleton', true, target);
  };
}

/**
 * Mark a class as request-scoped.
 *
 * A new instance is created for each request and destroyed (via `onDestroy`)
 * automatically at the end of the request. Instances are shared within a single
 * request — the same instance is returned if resolved multiple times in the same scope.
 *
 * @example
 * ```ts
 * @Injectable()
 * @RequestScoped()
 * class RequestContext implements OnDestroy {
 *   requestId = crypto.randomUUID();
 *   onDestroy() { console.log('request done', this.requestId); }
 * }
 * ```
 */
export function RequestScoped(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('requestScoped', true, target);
  };
}

/**
 * Documents that a singleton service holds no mutable per-request state.
 *
 * This is a no-op marker — it does not change runtime behavior.
 * Use it on `@Singleton()` classes to signal that the class is safe to share
 * across concurrent requests (no `currentUser`, no request-specific caches, etc.).
 *
 * Future tooling (linters, build checks) can use this marker to flag
 * singleton services that lack it.
 *
 * @example
 * @Injectable()
 * @Singleton()
 * @Stateless()
 * class UserRepo {
 *   // Only reads from DB, never stores per-request state
 *   findById(id: string) { return db.query(...); }
 * }
 */
export function Stateless(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('stateless', true, target);
  };
}

/**
 * Inject a specific token (for interfaces or string tokens)
 * 
 * @param token - Token to inject
 * 
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(
 *     @Inject('CONFIG') private config: Config,
 *     @Inject(ILogger) private logger: ILogger
 *   ) {}
 * }
 * ```
 */
export function Inject(token: InjectionToken): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existingTokens: InjectionToken[] =
      Reflect.getMetadata('inject:tokens', target) || [];
    existingTokens[parameterIndex] = token;
    Reflect.defineMetadata('inject:tokens', existingTokens, target);
  };
}