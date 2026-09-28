import type { Context, Next } from 'hono';
import { METADATA_KEYS } from './metadata';
import type { HonoMiddlewareFn } from './metadata';

/* ================= TYPES ================= */

export interface MiddlewareClass {
  use(c: Context, next: Next): Promise<Response | void>;
}

type MiddlewareInput = HonoMiddlewareFn | (new () => MiddlewareClass);

function normalize(middlewares: MiddlewareInput[]): HonoMiddlewareFn[] {
  return middlewares.map((m) => {
    if (isMiddlewareClass(m)) {
      const instance = new m();
      return instance.use.bind(instance) as HonoMiddlewareFn;
    }
    return m as HonoMiddlewareFn;
  });
}

function isMiddlewareClass(m: MiddlewareInput): m is new () => MiddlewareClass {
  return typeof m === 'function' && m.prototype && typeof m.prototype.use === 'function';
}

/* ================= DECORATOR ================= */

export function Middleware(
  ...middlewares: MiddlewareInput[]
): (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void {
  const fns = normalize(middlewares);

  return (_value, context) => {
    if (context.kind === 'class') {
      const existing = (context.metadata[METADATA_KEYS.MIDDLEWARES] as HonoMiddlewareFn[] | undefined) ?? [];
      context.metadata[METADATA_KEYS.MIDDLEWARES] = [...existing, ...fns];
    } else {
      const all = (context.metadata[METADATA_KEYS.METHOD_MIDDLEWARES] as Record<string, HonoMiddlewareFn[]> | undefined) ?? {};
      const key = String(context.name);
      all[key] = [...(all[key] ?? []), ...fns];
      context.metadata[METADATA_KEYS.METHOD_MIDDLEWARES] = all;
    }
  };
}

/** Alias for @Middleware — familiar for NestJS/Express users. */
export const Use = Middleware;
