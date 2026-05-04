import 'reflect-metadata';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { prettyJSON } from 'hono/pretty-json';
import { Middleware } from './middleware';
import type { HonoMiddlewareFn } from './metadata';

/* ================= CORS ================= */

/**
 * Applies CORS middleware to a controller or route.
 *
 * @example
 * @Controller('/api')
 * @Cors({ origin: 'https://example.com' })
 * class ApiController { ... }
 *
 * @example
 * @Get('/public')
 * @Cors({ origin: '*' })
 * async list() { ... }
 */
export function Cors(
  options?: Parameters<typeof cors>[0]
): MethodDecorator & ClassDecorator {
  return Middleware(cors(options) as unknown as HonoMiddlewareFn);
}

/* ================= COMPRESS ================= */

/**
 * Applies response compression middleware (gzip/deflate) to a controller or route.
 *
 * @example
 * @Controller('/api')
 * @Compress()
 * class ApiController { ... }
 */
export function Compress(
  options?: Parameters<typeof compress>[0]
): MethodDecorator & ClassDecorator {
  return Middleware(compress(options) as unknown as HonoMiddlewareFn);
}

/* ================= SECURE HEADERS ================= */

/**
 * Applies security headers middleware (CSP, HSTS, X-Frame-Options, etc.)
 * to a controller or route.
 *
 * @example
 * @Controller('/api')
 * @SecureHeaders()
 * class ApiController { ... }
 */
export function SecureHeaders(
  options?: Parameters<typeof secureHeaders>[0]
): MethodDecorator & ClassDecorator {
  return Middleware(secureHeaders(options) as unknown as HonoMiddlewareFn);
}

/* ================= PRETTY JSON ================= */

/**
 * Applies pretty-print JSON formatting to responses for a controller or route.
 *
 * @example
 * @Controller('/debug')
 * @PrettyJson()
 * class DebugController { ... }
 */
export function PrettyJson(
  options?: Parameters<typeof prettyJSON>[0]
): MethodDecorator & ClassDecorator {
  return Middleware(prettyJSON(options) as unknown as HonoMiddlewareFn);
}
