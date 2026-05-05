/* ================= HTTP EXCEPTION ================= */

export interface HttpExceptionOptions {
  /**
   * Short machine-readable error code (e.g. `'USER_NOT_FOUND'`).
   * Defaults to a standard code derived from the HTTP status (e.g. `'NOT_FOUND'` for 404).
   */
  code?: string;

  /**
   * Arbitrary key-value metadata attached to the error.
   * Included in the JSON response body and passed to `onError` for persistence.
   *
   * @example { userId: '123', field: 'email' }
   */
  meta?: Record<string, unknown>;

  /** Underlying cause — forwarded to `Error` options for native cause chain support. */
  cause?: Error;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  411: 'LENGTH_REQUIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

/**
 * Structured HTTP error that the route builder handles automatically:
 * - Returns the correct HTTP status code
 * - Returns a consistent JSON body: `{ status, error: { code, message, meta?, stack? } }`
 * - Calls `onError` (if configured) before sending the response, so you can persist it to a DB
 *
 * @example
 * throw new HttpException(404, 'User not found', { code: 'USER_NOT_FOUND', meta: { userId } });
 *
 * @example Using static factories
 * throw HttpException.notFound('User not found', { meta: { userId } });
 * throw HttpException.badRequest('Email already in use', { code: 'EMAIL_CONFLICT' });
 */
export class HttpException extends Error {
  readonly status: number;
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(status: number, message: string, options?: HttpExceptionOptions) {
    super(message, { cause: options?.cause });
    this.name = 'HttpException';
    this.status = status;
    this.code = options?.code ?? STATUS_CODES[status] ?? 'HTTP_ERROR';
    this.meta = options?.meta;
  }

  static badRequest(message: string, options?: HttpExceptionOptions): HttpException {
    return new HttpException(400, message, { code: 'BAD_REQUEST', ...options });
  }

  static unauthorized(message = 'Unauthorized', options?: HttpExceptionOptions): HttpException {
    return new HttpException(401, message, { code: 'UNAUTHORIZED', ...options });
  }

  static forbidden(message = 'Forbidden', options?: HttpExceptionOptions): HttpException {
    return new HttpException(403, message, { code: 'FORBIDDEN', ...options });
  }

  static notFound(message = 'Not found', options?: HttpExceptionOptions): HttpException {
    return new HttpException(404, message, { code: 'NOT_FOUND', ...options });
  }

  static conflict(message: string, options?: HttpExceptionOptions): HttpException {
    return new HttpException(409, message, { code: 'CONFLICT', ...options });
  }

  static unprocessable(message: string, options?: HttpExceptionOptions): HttpException {
    return new HttpException(422, message, { code: 'UNPROCESSABLE_ENTITY', ...options });
  }

  static tooManyRequests(message = 'Too many requests', options?: HttpExceptionOptions): HttpException {
    return new HttpException(429, message, { code: 'TOO_MANY_REQUESTS', ...options });
  }

  static internal(message = 'Internal server error', options?: HttpExceptionOptions): HttpException {
    return new HttpException(500, message, { code: 'INTERNAL_SERVER_ERROR', ...options });
  }

  static serviceUnavailable(message = 'Service unavailable', options?: HttpExceptionOptions): HttpException {
    return new HttpException(503, message, { code: 'SERVICE_UNAVAILABLE', ...options });
  }
}
