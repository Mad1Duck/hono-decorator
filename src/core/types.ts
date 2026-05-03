/* ================= CORE TYPES ================= */

import { Context } from "hono";

/**
 * Abstract constructor type for classes that can't be instantiated directly
 */
export type AbstractConstructor<T = unknown> = abstract new (
  ...args: any[]
) => T;

/**
 * Concrete constructor type for classes that can be instantiated
 * @template T - The type of instance this constructor creates
 */
export type ConcreteConstructor<T = unknown> = new (
  ...args: any[]
) => T;

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
 * Controller class with context
 */
export interface ControllerWithContext {
  __ctx?: Context;
  [key: string]: unknown;
}

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