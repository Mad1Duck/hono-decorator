// decorators/guard.ts
import 'reflect-metadata';
import { METADATA_KEYS } from './metadata';
import type { GuardMetadata, RateLimitMetadata, RouteMetadata } from './metadata';

/* ================= TYPES ================= */

/**
 * Guard class constructor type
 */
type GuardConstructor = new (...args: unknown[]) => unknown;

/* ================= USE GUARDS ================= */

/**
 * Apply guards to route
 * @example @UseGuards(AuthGuard, RoleGuard)
 */
export function UseGuards(...guards: GuardConstructor[]): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const existingGuards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    const guardMetadata: GuardMetadata[] = guards.map((Guard) => ({
      name: Guard.name,
    }));

    Reflect.defineMetadata(
      METADATA_KEYS.GUARDS,
      [...existingGuards, ...guardMetadata],
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= REQUIRE AUTH ================= */

/**
 * Require authentication
 * @example @RequireAuth()
 */
export function RequireAuth(): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const guards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    Reflect.defineMetadata(METADATA_KEYS.GUARDS, [...guards, { name: 'AuthGuard' }], target, propertyKey);

    return descriptor;
  };
}

/* ================= REQUIRE ROLE ================= */

/**
 * Require specific roles (user must have at least ONE of the specified roles)
 * @example @RequireRole('admin', 'moderator')
 */
export function RequireRole(...roles: string[]): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const guards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    Reflect.defineMetadata(METADATA_KEYS.GUARDS, [...guards, { name: 'RoleGuard', options: { roles } }], target, propertyKey);

    return descriptor;
  };
}

/* ================= REQUIRE PERMISSION (ALL) ================= */

/**
 * Require specific permissions (user must have ALL specified permissions)
 * @example @RequirePermission('users:read', 'users:write')
 */
export function RequirePermission(...permissions: string[]): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const guards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    Reflect.defineMetadata(METADATA_KEYS.GUARDS, [...guards, { name: 'PermissionGuard', options: { permissions, requireAll: true } }], target, propertyKey);

    return descriptor;
  };
}

/* ================= REQUIRE ANY PERMISSION ================= */

/**
 * Require at least ONE of the specified permissions
 * @example @RequireAnyPermission('users:read', 'users:write', 'users:admin')
 */
export function RequireAnyPermission(...permissions: string[]): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const guards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    Reflect.defineMetadata(METADATA_KEYS.GUARDS, [...guards, { name: 'PermissionGuard', options: { permissions, requireAll: false } }], target, propertyKey);

    return descriptor;
  };
}

/* ================= RATE LIMIT ================= */

/**
 * Apply rate limiting to specific route
 * @example @RateLimit({ max: 10, windowMs: 60000 })
 */
export function RateLimit(options: RateLimitMetadata): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata(
      METADATA_KEYS.RATE_LIMIT,
      options,
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= PUBLIC ROUTE ================= */

/**
 * Mark route as public (skip authentication)
 * @example @Public()
 */
export function Public(): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata('isPublic', true, target, propertyKey);

    return descriptor;
  };
}


/* ================= PRIVATE ================= */

export function Private(): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata('isPrivate', true, target, propertyKey);
    return descriptor;
  };
}

/* ================= REQUIRE ALL ROLES ================= */

/**
 * Require ALL specified roles (stricter than RequireRole)
 * @example @RequireAllRoles('admin', 'superuser')
 */
export function RequireAllRoles(...roles: string[]): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const guards =
      (Reflect.getMetadata(
        METADATA_KEYS.GUARDS,
        target,
        propertyKey
      ) as GuardMetadata[] | undefined) ?? [];

    Reflect.defineMetadata(METADATA_KEYS.GUARDS, [...guards, { name: 'RoleGuard', options: { roles, requireAll: true } }], target, propertyKey);

    return descriptor;
  };
}