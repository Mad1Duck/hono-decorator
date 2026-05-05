import { getRequestContext, createRequestContext, runInRequestContext } from '../core/request-context';

/* ================= PUBLIC API ================= */

/**
 * Returns the trace / correlation ID for the current request.
 *
 * Inside a route handler this is the value of the incoming `X-Request-ID` header
 * (or a freshly generated UUID if the header is absent).
 * Returns `undefined` when called outside a request context.
 *
 * @example
 * import { getTraceId } from 'hono-forge';
 *
 * @Injectable()
 * class AuditService {
 *   log(action: string) {
 *     console.log({ traceId: getTraceId(), action });
 *   }
 * }
 */
export function getTraceId(): string | undefined {
  return getRequestContext()?.traceId;
}

/**
 * Runs `fn` within a trace context identified by `traceId`.
 * Called automatically by HonoRouteBuilder for every request.
 * Only needed manually when running handlers outside the route builder.
 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  if (getRequestContext()) return fn();
  return runInRequestContext(createRequestContext(traceId), fn);
}
