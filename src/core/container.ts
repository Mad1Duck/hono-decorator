import 'reflect-metadata';
import type {
  ConcreteConstructor,
  Factory,
  InjectionToken,
} from './types';

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
   * Register a singleton instance
   * @param token - Injection token (class or string/symbol)
   * @param instance - Pre-created instance
   * 
   * @example
   * ```typescript
   * const db = new Database();
   * container.registerSingleton(Database, db);
   * ```
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

    // Check factory
    const factory = this.factories.get(target);
    if (factory !== undefined) {
      const instance = factory() as T;

      // Cache if marked as singleton
      if (this.isSingleton(target)) {
        this.singletons.set(target, instance);
      }

      return instance;
    }

    // Resolve via constructor injection
    this.resolutionStack.push(targetName);

    try {
      const instance = this.resolveViaConstructor(target);

      // Cache if singleton
      if (this.isSingleton(target)) {
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

      // Resolve each dependency
      const dependencies = paramTypes.map((paramType, index) => {
        try {
          return this.resolve(paramType);
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