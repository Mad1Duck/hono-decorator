// decorator/middleware.ts
import 'reflect-metadata';
import type { Context, Next } from 'hono';
import { HonoMiddlewareFn, METADATA_KEYS } from './metadata';

/* ================= TYPES ================= */
// Support class-based middleware
export interface MiddlewareClass {
  use(c: Context, next: Next): Promise<Response | void>;
}

type MiddlewareInput =
  | HonoMiddlewareFn
  | (new () => MiddlewareClass);

/* ================= DECORATOR ================= */

export function Middleware(
  ...middlewares: MiddlewareInput[]
): MethodDecorator & ClassDecorator {
  return (
    target: object,
    propertyKey?: string | symbol,
  ): void => {
    // Normalize: class → fungsi
    const normalizedFns: HonoMiddlewareFn[] = middlewares.map((m) => {
      if (isMiddlewareClass(m)) {
        // Class-based: new AuthMiddleware().use
        const instance = new m();
        return instance.use.bind(instance);
      }
      // Function-based: langsung pakai
      return m as HonoMiddlewareFn;
    });

    if (propertyKey !== undefined) {
      // ===== METHOD DECORATOR =====
      const existing =
        (Reflect.getMetadata(
          METADATA_KEYS.MIDDLEWARES,
          target,
          propertyKey
        ) as HonoMiddlewareFn[] | undefined) ?? [];

      Reflect.defineMetadata(
        METADATA_KEYS.MIDDLEWARES,
        [...existing, ...normalizedFns],
        target,
        propertyKey
      );
    } else {
      // ===== CLASS DECORATOR =====
      // Apply ke semua route di controller ini
      const existing =
        (Reflect.getMetadata(
          METADATA_KEYS.MIDDLEWARES,
          target
        ) as HonoMiddlewareFn[] | undefined) ?? [];

      Reflect.defineMetadata(
        METADATA_KEYS.MIDDLEWARES,
        [...existing, ...normalizedFns],
        target
      );
    }
  };
}

/* ================= HELPER ================= */

function isMiddlewareClass(
  m: MiddlewareInput
): m is new () => MiddlewareClass {
  return (
    typeof m === 'function' &&
    m.prototype &&
    typeof m.prototype.use === 'function'
  );
}