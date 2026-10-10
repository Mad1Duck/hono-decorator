import type { Context } from 'hono';
import { ZodError } from 'zod';
import { HttpException } from './http-exception';

/* ================= RFC 9457 PROBLEM DETAILS ================= */

const REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Render an error as an RFC 9457 problem-details response
 * (`application/problem+json`). Core members:
 *
 * ```json
 * {
 *   "type": "about:blank",
 *   "title": "Not Found",            // standard reason phrase
 *   "status": 404,
 *   "detail": "User 42 not found",   // the exception message
 *   "instance": "/users/42"          // request path
 * }
 * ```
 *
 * Extension members: `code` (the HttpException code), every `meta` field
 * spread at top level, `errors` (Zod issues for validation failures), and
 * `stack` when `exposeStack` is enabled.
 *
 * Returns `null` for errors the builder doesn't own — callers rethrow so
 * Hono's own error handling applies.
 */
export function problemResponse(
  c: Context,
  error: unknown,
  exposeStack: boolean,
): Response | null {
  let body: Record<string, unknown> | null = null;

  if (error instanceof ZodError) {
    body = {
      title: 'Bad Request',
      status: 400,
      detail: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: error.issues,
    };
  } else if (error instanceof HttpException) {
    body = {
      title: REASON[error.status] ?? 'Error',
      status: error.status,
      detail: error.message,
      code: error.code,
      ...(error.meta ?? {}),
      ...(exposeStack && error.stack ? { stack: error.stack } : {}),
    };
  }
  if (!body) return null;

  body['type'] = 'about:blank';
  body['instance'] = c.req.path;

  // c.body merges headers already set on the context (e.g. Retry-After
  // set by a limiter before throwing) — a raw new Response() would drop them.
  c.header('content-type', 'application/problem+json');
  return c.body(JSON.stringify(body), body['status'] as never);
}
