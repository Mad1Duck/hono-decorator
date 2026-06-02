import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { prettyJSON } from 'hono/pretty-json';
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
