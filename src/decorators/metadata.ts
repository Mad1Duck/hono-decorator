import type { Context, Next } from 'hono';
import 'reflect-metadata';

import type { ZodType } from 'zod';

/* ================= KEYS ================= */

export const METADATA_KEYS = {
  CONTROLLER: Symbol('controller'),
  ROUTES: Symbol('routes'),
  PARAMS: Symbol('params'),
  GUARDS: Symbol('guards'),
  INTERCEPTORS: Symbol('interceptors'),
  MIDDLEWARES: Symbol('middlewares'),
  VALIDATION: Symbol('validation'),
  CACHE: Symbol('cache'),
  RATE_LIMIT: Symbol('rateLimit'),
  OPENAPI: Symbol('openapi'),
  CUSTOM: Symbol('custom'),
  SSE_ROUTE: Symbol('sseRoute'),
  WEBSOCKET_ROUTE: Symbol('websocketRoute'),
} as const;

/* ================= ROUTE ================= */

export interface RouteMetadata {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'all';
  path: string;
  handlerName: string;
  platform?: 'mobile' | 'web' | 'all';
  isPrivate?: boolean;
}

/* ================= CONTROLLER ================= */

export interface ControllerMetadata {
  basePath: string;
  platform?: 'mobile' | 'web';
  routes: RouteMetadata[];
}

/* ================= PARAM ================= */

export interface ParamMetadata {
  type:
  | 'body'
  | 'param'
  | 'query'
  | 'headers'
  | 'user'
  | 'req'
  | 'res'
  | 'next'
  | 'sse';

  index: number;
  name?: string;

  schema?: ZodType;
}

/* ================= GUARD ================= */

export interface GuardMetadata {
  name: string;
  options?: {
    roles?: string[];
    [key: string]: unknown;
    requireAll?: boolean;
    permissions?: string[];
  };
}

export type HonoMiddlewareFn = (c: Context, next: Next) => Promise<Response | void>;

/* ================= VALIDATION ================= */

export interface ValidationMetadata {
  type: 'body' | 'query' | 'params';

  schema: ZodType;
}

/* ================= OPENAPI ================= */

export interface OpenAPIMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;

  responses?: Record<
    number,
    {
      description?: string;
      schema?: ZodType;
    }
  >;
}

/* ================= CACHE ================= */

export interface CacheMetadata {
  ttl: number;
  key?: string;
}

/* ================= RATE LIMIT ================= */

export interface RateLimitMetadata {
  max: number;
  windowMs: number;
  keyPrefix?: string;
  message?: string;
  keyGenerator?: (c: Context) => string;
}