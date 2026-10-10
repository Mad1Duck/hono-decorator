import { METADATA_KEYS } from './metadata';
import type { GuardMetadata, RateLimitMetadata } from './metadata';

type GuardConstructor = new (...args: unknown[]) => unknown;

type MethodDec = (value: Function, context: ClassMethodDecoratorContext) => void;

function addGuard(context: ClassMethodDecoratorContext, guard: GuardMetadata): void {
  const all = (context.metadata[METADATA_KEYS.GUARDS] as Record<string, GuardMetadata[]> | undefined) ?? {};
  const key = String(context.name);
  all[key] = [...(all[key] ?? []), guard];
  context.metadata[METADATA_KEYS.GUARDS] = all;
}

/* ================= USE GUARDS ================= */

export function UseGuards(...guards: GuardConstructor[]): MethodDec {
  return (_value, context) => {
    for (const Guard of guards) {
      addGuard(context, { name: Guard.name });
    }
  };
}

/* ================= REQUIRE AUTH ================= */

export function RequireAuth(): MethodDec {
  return (_value, context) => addGuard(context, { name: 'AuthGuard' });
}

/* ================= REQUIRE ROLE ================= */

export function RequireRole(...roles: string[]): MethodDec {
  return (_value, context) => addGuard(context, { name: 'RoleGuard', options: { roles } });
}

/* ================= REQUIRE ALL ROLES ================= */

export function RequireAllRoles(...roles: string[]): MethodDec {
  return (_value, context) => addGuard(context, { name: 'RoleGuard', options: { roles, requireAll: true } });
}

/* ================= REQUIRE PERMISSION ================= */

export function RequirePermission(...permissions: string[]): MethodDec {
  return (_value, context) =>
    addGuard(context, { name: 'PermissionGuard', options: { permissions, requireAll: true } });
}

/* ================= REQUIRE ANY PERMISSION ================= */

export function RequireAnyPermission(...permissions: string[]): MethodDec {
  return (_value, context) =>
    addGuard(context, { name: 'PermissionGuard', options: { permissions, requireAll: false } });
}

/* ================= RATE LIMIT ================= */

export function RateLimit(options: RateLimitMetadata): MethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.RATE_LIMIT] as Record<string, RateLimitMetadata> | undefined) ?? {};
    all[String(context.name)] = options;
    context.metadata[METADATA_KEYS.RATE_LIMIT] = all;
  };
}

/**
 * Bulkhead — cap concurrent executions of this route to `n`. Requests beyond
 * the limit get a fast `503 CONCURRENCY_LIMIT` instead of queueing, protecting
 * expensive endpoints from load pile-up. Complements `@SingleFlight` (which
 * dedupes identical in-flight calls) and `@RateLimit` (which is per-window).
 *
 * @example
 * @Get('/report')
 * @Concurrency(2)
 * async report(c: Context) { return generateExpensiveReport(); }
 */
export function Concurrency(max: number): MethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.CONCURRENCY] as Record<string, number> | undefined) ?? {};
    all[String(context.name)] = max;
    context.metadata[METADATA_KEYS.CONCURRENCY] = all;
  };
}

/* ================= PUBLIC ================= */

export function Public(): MethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.IS_PUBLIC] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.IS_PUBLIC] = all;
  };
}

/* ================= PRIVATE ================= */

export function Private(): MethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.IS_PRIVATE] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.IS_PRIVATE] = all;
  };
}
