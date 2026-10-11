import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { prettyJSON } from 'hono/pretty-json';
import { jwt } from 'hono/jwt';
import type { Context } from 'hono';
import { Middleware } from './middleware';
import type { HonoMiddlewareFn } from './metadata';

type ClassOrMethodDec = (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void;

export function Cors(options?: Parameters<typeof cors>[0]): ClassOrMethodDec {
  return Middleware(cors(options) as unknown as HonoMiddlewareFn);
}

export function Compress(options?: Parameters<typeof compress>[0]): ClassOrMethodDec {
  return Middleware(compress(options) as unknown as HonoMiddlewareFn);
}

export function SecureHeaders(options?: Parameters<typeof secureHeaders>[0]): ClassOrMethodDec {
  return Middleware(secureHeaders(options) as unknown as HonoMiddlewareFn);
}

export function PrettyJson(options?: Parameters<typeof prettyJSON>[0]): ClassOrMethodDec {
  return Middleware(prettyJSON(options) as unknown as HonoMiddlewareFn);
}

/**
 * Turnkey JWT auth — wraps `hono/jwt`. On a valid token the decoded payload is
 * exposed both as Hono's `jwtPayload` and as `c.get('user')`, so `User(c)`
 * works without any extra wiring. Invalid/missing tokens → 401.
 *
 * @example
 * @Get('/me') @JwtAuth({ secret: env.JWT_SECRET })
 * me(c: Context) { return User(c); }
 */
export type JwtAuthOptions = Omit<Parameters<typeof jwt>[0], 'alg'> & {
  /** Signature algorithm — defaults to 'HS256'. */
  alg?: Parameters<typeof jwt>[0]['alg'];
};

/**
 * Marker stamped on the @JwtAuth middleware fn so the OpenAPI generator can
 * infer `security: [{ bearerAuth: [] }]` — the middleware is anonymous, so
 * metadata alone can't tell it apart from user middleware.
 */
export const JWT_AUTH_MIDDLEWARE = Symbol.for('hono-forge.jwtAuth');

export function JwtAuth(options: JwtAuthOptions): ClassOrMethodDec {
  const jwtMw = jwt({ ...options, alg: options.alg ?? 'HS256' }) as unknown as HonoMiddlewareFn;
  const mw: HonoMiddlewareFn = async (c: Context, next) => {
    const res = await jwtMw(c, async () => {
      c.set('user', c.get('jwtPayload'));
    });
    if (res) return res; // 401 from hono/jwt
    return next();
  };
  Object.assign(mw, { [JWT_AUTH_MIDDLEWARE]: true });
  return Middleware(mw);
}
