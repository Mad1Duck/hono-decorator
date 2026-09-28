import type { Context } from 'hono';
import { METADATA_KEYS } from './metadata';

/* ================= FILTER INTERFACE ================= */

/**
 * An exception filter transforms thrown errors into Responses.
 * Return `undefined` (or `void`) to let the next filter / default handling run.
 * Filters are resolved through the container, so constructor injection works
 * like any other class.
 */
export interface ExceptionFilter {
  catch(error: unknown, c: Context): Response | void | Promise<Response | void>;
}

export type ExceptionFilterConstructor = Function & { prototype: ExceptionFilter; };

/* ================= @Catch ================= */

/**
 * Mark a class as an exception filter for the given error types.
 * With no arguments the filter catches every error.
 *
 * @example
 * @Catch(PrismaClientKnownError)
 * class DbErrorFilter implements ExceptionFilter {
 *   catch(err: unknown, c: Context) {
 *     return c.json({ status: 'error', error: { code: 'DB_ERROR' } }, 500);
 *   }
 * }
 */
export function Catch(...errorTypes: Function[]) {
  return (_value: Function, context: ClassDecoratorContext) => {
    context.metadata[METADATA_KEYS.CATCH] = errorTypes;
  };
}

/* ================= @UseFilters ================= */

/**
 * Attach exception filters to a controller (all routes) or a single handler.
 * Method-level filters run before class-level filters; both run before the
 * global `onError` hook and default `HttpException` formatting.
 *
 * @example
 * @Controller('/users')
 * @UseFilters(DbErrorFilter)
 * class UserController {
 *   @Post() @UseFilters(UploadErrorFilter)
 *   create(c: Context) { ... }
 * }
 */
export function UseFilters(...filters: ExceptionFilterConstructor[]) {
  return (_value: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      const existing = (context.metadata[METADATA_KEYS.EXCEPTION_FILTERS] as ExceptionFilterConstructor[] | undefined) ?? [];
      context.metadata[METADATA_KEYS.EXCEPTION_FILTERS] = [...existing, ...filters];
    } else {
      const all = (context.metadata[METADATA_KEYS.METHOD_EXCEPTION_FILTERS] as Record<string, ExceptionFilterConstructor[]> | undefined) ?? {};
      const key = String(context.name);
      all[key] = [...(all[key] ?? []), ...filters];
      context.metadata[METADATA_KEYS.METHOD_EXCEPTION_FILTERS] = all;
    }
  };
}
