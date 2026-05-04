/* ================= CORE TYPES ================= */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any[];

/**
 * Abstract constructor — used for DI resolution.
 * Uses `any[]` args intentionally: DI frameworks must accept classes with
 * specific constructor signatures (e.g. `new (svc: UserService) => T`).
 * `unknown[]` would reject those, breaking constructor injection.
 */
export type AbstractConstructor<T = unknown> = abstract new (...args: AnyArgs) => T;

/**
 * Concrete constructor — used for DI resolution and container registration.
 */
export type ConcreteConstructor<T = unknown> = new (...args: AnyArgs) => T;

/**
 * Constructor with dependencies (for DI)
 */
export type InjectableConstructor<T = unknown> = ConcreteConstructor<T> & {
  prototype: T;
};

/**
 * Factory function type
 */
export type Factory<T = unknown> = () => T;

/**
 * Phantom brand added to a class by @Controller().
 * Ensures HonoRouteBuilder.build() only accepts properly decorated controllers.
 */
declare const CONTROLLER_BRAND: unique symbol;
export type HonoForgeController = { readonly [CONTROLLER_BRAND]?: true };

/**
 * A constructor (abstract or concrete) that has been decorated with @Controller.
 * Pass this to HonoRouteBuilder.build().
 */
export type ControllerConstructor<T = unknown> =
  | ((new (...args: AnyArgs) => T) & HonoForgeController)
  | ((abstract new (...args: AnyArgs) => T) & HonoForgeController);

/**
 * Controller instance with typed methods
 */
export interface ControllerInstance {
  [key: string]: ControllerMethod;
}

/**
 * Controller method signature
 */
export type ControllerMethod = (
  ...args: unknown[]
) => unknown | Promise<unknown>;

/**
 * Type-safe controller resolver
 */
export interface TypedControllerResolver {
  resolve<T extends object>(
    constructor: ConcreteConstructor<T>
  ): T & ControllerInstance;
}

/**
 * Dependency injection token
 */
export type InjectionToken<T = unknown> =
  | ConcreteConstructor<T>
  | string
  | symbol;
