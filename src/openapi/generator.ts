/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { METADATA_KEYS } from '../decorators/metadata';
import type { RouteMetadata, GuardMetadata, OpenAPIMetadata } from '../decorators/metadata';
import { JWT_AUTH_MIDDLEWARE } from '../decorators/common-middleware';
import type { SecuritySchemeSpec } from '../decorators/security';

/* ================= TYPES ================= */

type Constructor = new (...args: unknown[]) => unknown;
type ClassMeta = Record<symbol, unknown>;

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPIGenerateOptions {
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
}

export interface OpenAPIMountOptions {
  /** Path to serve the JSON spec. Default: '/openapi.json' */
  specPath?: string;
  /** Path to serve Scalar UI. Default: '/docs'. Set null to disable. */
  docsPath?: string | null;
}

/* ================= HELPERS ================= */

function getMeta(target: Function): ClassMeta | null {
  return (target as unknown as { [Symbol.metadata]?: ClassMeta })[Symbol.metadata] ?? null;
}

/** Convert Hono path params /:id (or /:id{[0-9]+}) → OpenAPI {id} */
function honoPathToOpenAPI(path: string): string {
  return path.replace(/:([^/{]+)(?:\{[^}]*\})?/g, '{$1}');
}

/** Extract all :param names from a Hono path string (regex suffixes stripped) */
function extractPathParamNames(path: string): string[] {
  return [...path.matchAll(/:([^/{]+)(?:\{[^}]*\})?/g)].map(m => m[1]!);
}

/** Convert a Zod schema to a plain JSON Schema object. */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const full = (z as any).toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = full;
  return rest;
}

/** Strip undefined values from an object. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/* ================= GENERATOR ================= */

export class OpenAPIGenerator {
  /**
   * Generate an OpenAPI 3.1 spec object from an array of decorated controller classes.
   *
   * Use @ApiDoc, @ApiResponse, @ApiTags, @ApiDeprecated on your handlers to enrich the spec.
   * Path parameters are inferred from the route path pattern.
   * Body/query parameters can be documented via @ApiDoc.
   *
   * @example
   * const spec = OpenAPIGenerator.generate([UserController, OrderController], {
   *   info: { title: 'My API', version: '1.0.0' },
   *   servers: [{ url: 'http://localhost:3000' }],
   * });
   */
  static generate(
    controllers: Constructor[],
    options: OpenAPIGenerateOptions
  ): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    let needsBearerAuth = false;
    const allSecuritySchemes: Record<string, SecuritySchemeSpec> = {};
    const usedSecuritySchemes = new Set<string>();

    for (const ControllerClass of controllers) {
      const meta = getMeta(ControllerClass as unknown as Function);
      if (!meta) continue;

      const controllerMeta = meta[METADATA_KEYS.CONTROLLER] as { basePath: string; } | undefined;
      if (!controllerMeta) continue;

      const routes = (meta[METADATA_KEYS.ROUTES] as RouteMetadata[] | undefined) ?? [];

      // Class-level tags from @ApiTags on the class
      const classOpenApi = (meta[METADATA_KEYS.CLASS_OPENAPI] as OpenAPIMetadata | undefined) ?? {};

      // Per-method metadata
      const allMethodOpenApi = (meta[METADATA_KEYS.OPENAPI] as Record<string, OpenAPIMetadata> | undefined) ?? {};
      const allGuards = (meta[METADATA_KEYS.GUARDS] as Record<string, GuardMetadata[]> | undefined) ?? {};
      const isPublicMap = (meta[METADATA_KEYS.IS_PUBLIC] as Record<string, boolean> | undefined) ?? {};
      const allSse = (meta[METADATA_KEYS.SSE_ROUTE] as Record<string, boolean> | undefined) ?? {};
      const allWs = (meta[METADATA_KEYS.WEBSOCKET_ROUTE] as Record<string, boolean> | undefined) ?? {};
      const allChannels = (meta[METADATA_KEYS.CHANNEL_ROUTE] as Record<string, string | ((c: unknown) => string)> | undefined) ?? {};
      const securityRequirements = (meta[METADATA_KEYS.SECURITY] as Record<string, string[]> | undefined) ?? {};
      const securitySchemes = (meta[METADATA_KEYS.SECURITY_SCHEMES] as Record<string, SecuritySchemeSpec> | undefined) ?? {};
      Object.assign(allSecuritySchemes, securitySchemes);
      // @JwtAuth is a (marked) middleware, not a guard — detect it here.
      const classMws = (meta[METADATA_KEYS.MIDDLEWARES] as unknown[] | undefined) ?? [];
      const allMethodMws = (meta[METADATA_KEYS.METHOD_MIDDLEWARES] as Record<string, unknown[]> | undefined) ?? {};
      const isJwtAuth = (m: unknown): boolean =>
        typeof m === 'function' && (m as unknown as Record<symbol, unknown>)[JWT_AUTH_MIDDLEWARE] === true;
      const classJwtAuth = classMws.some(isJwtAuth);

      for (const route of routes) {
        if (route.method === 'all') continue;

        const { method, path, handlerName } = route;
        const honoFullPath = `${controllerMeta.basePath}${path}`;
        const openApiPath = honoPathToOpenAPI(honoFullPath);
        const openApiMethod = method === 'head' ? 'head' : method;

        const methodMeta = allMethodOpenApi[handlerName] ?? {};
        const guards = allGuards[handlerName] ?? [];
        const isPublic = isPublicMap[handlerName] ?? false;
        const isSse = allSse[handlerName] ?? false;
        const isWs = allWs[handlerName] ?? false;
        const channelMeta = allChannels[handlerName];

        /* --- Tags --- */
        const tags = [...(classOpenApi.tags ?? []), ...(methodMeta.tags ?? [])];

        /* --- Security --- */
        const inferredAuth = !isPublic && (
          guards.some(g =>
            g.name === 'AuthGuard' || g.name === 'RoleGuard' || g.name === 'PermissionGuard'
          ) ||
          classJwtAuth ||
          (allMethodMws[handlerName] ?? []).some(isJwtAuth)
        );
        const explicitSecurity = securityRequirements[handlerName];
        if (inferredAuth) needsBearerAuth = true;
        if (explicitSecurity) for (const name of explicitSecurity) usedSecuritySchemes.add(name);
        const security: unknown[] | undefined = isPublic
          ? []
          : inferredAuth && explicitSecurity
            ? [{ bearerAuth: [] }, ...explicitSecurity.map(name => ({ [name]: [] }))]
            : inferredAuth
              ? [{ bearerAuth: [] }]
              : explicitSecurity
                ? explicitSecurity.map(name => ({ [name]: [] }))
                : undefined;

        /* --- Path parameters (inferred from URL; @Validate/@ApiDoc may refine the schema) + @ApiQuery --- */
        const pathParamNames = extractPathParamNames(honoFullPath);
        const parameters: unknown[] = pathParamNames.map(name => {
          const p = methodMeta.params?.[name];
          return compact({
            name,
            in: 'path',
            required: true,
            description: p?.description,
            schema: p ? zodToJsonSchema(p.schema) : { type: 'string' },
          });
        });
        for (const [qname, q] of Object.entries(methodMeta.query ?? {})) {
          parameters.push(compact({
            name: qname,
            in: 'query',
            required: q.required ?? !q.schema.safeParse(undefined).success,
            description: q.description,
            schema: zodToJsonSchema(q.schema),
          }));
        }

        /* --- Responses --- */
        const responses: Record<string, unknown> = {};

        if (methodMeta.responses && Object.keys(methodMeta.responses).length > 0) {
          for (const [code, resp] of Object.entries(methodMeta.responses)) {
            responses[code] = compact({
              description: resp.description ?? 'Response',
              content: resp.schema
                ? { 'application/json': { schema: zodToJsonSchema(resp.schema) } }
                : undefined,
            });
          }
        } else {
          responses['200'] = { description: isSse ? 'SSE stream' : isWs ? 'WebSocket upgrade' : 'Success' };
        }

        if (security !== undefined && security.length > 0) {
          responses['401'] = { description: 'Unauthorized' };
          if (inferredAuth) responses['403'] = { description: 'Forbidden' };
        }
        const timeoutMeta = (meta[METADATA_KEYS.TIMEOUT] as Record<string, number> | undefined)?.[handlerName];
        if (timeoutMeta !== undefined) {
          responses['504'] = { description: `Gateway timeout (${timeoutMeta}ms)` };
        }

        /* --- Build operation --- */
        const descriptionPrefix = isSse ? '(SSE stream) ' : isWs ? '(WebSocket upgrade) ' : '';
        const operation = compact({
          operationId: `${openApiMethod}_${ControllerClass.name}_${handlerName}`,
          summary: methodMeta.summary,
          description: methodMeta.description
            ? `${descriptionPrefix}${methodMeta.description}`
            : (isSse || isWs ? descriptionPrefix.trim() : undefined),
          tags: tags.length > 0 ? tags : undefined,
          deprecated: methodMeta.deprecated,
          security,
          parameters: parameters.length > 0 ? parameters : undefined,
          /* Vendor extensions — ignored by OpenAPI tooling, consumed by smarter
           * clients (e.g. api-tester) to build protocol-aware nodes. */
          'x-transport': isSse ? 'sse' : isWs ? 'websocket' : undefined,
          'x-channel': typeof channelMeta === 'string' ? channelMeta : undefined,
          requestBody: methodMeta.body
            ? compact({
              required: methodMeta.body.required ?? !methodMeta.body.schema.safeParse(undefined).success,
              description: methodMeta.body.description,
              content: { 'application/json': { schema: zodToJsonSchema(methodMeta.body.schema) } },
            })
            : undefined,
          responses,
        });

        if (!paths[openApiPath]) paths[openApiPath] = {};
        paths[openApiPath]![openApiMethod] = operation;
      }
    }

    const securitySchemes: Record<string, unknown> = {};
    if (needsBearerAuth) {
      securitySchemes.bearerAuth = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' };
    }
    for (const name of usedSecuritySchemes) {
      const spec = allSecuritySchemes[name];
      if (spec) securitySchemes[name] = spec;
    }

    return compact({
      openapi: '3.1.0',
      info: options.info,
      servers: options.servers,
      paths,
      components: Object.keys(securitySchemes).length > 0
        ? { securitySchemes }
        : undefined,
    });
  }

  /**
   * Mount `/openapi.json` and Scalar UI (`/docs`) onto an existing Hono app.
   *
   * Pass either a generated spec object, or an array of controller classes
   * plus generate options — the spec is generated for you:
   *
   * @example
   * OpenAPIGenerator.mount(app, [UserController], {
   *   info: { title: 'My API', version: '1.0.0' },
   * });
   */
  static mount(app: Hono, spec: Record<string, unknown>, options?: OpenAPIMountOptions): void;
  static mount(
    app: Hono,
    controllers: Constructor[],
    options: OpenAPIGenerateOptions & OpenAPIMountOptions
  ): void;
  static mount(
    app: Hono,
    specOrControllers: Record<string, unknown> | Constructor[],
    options: (OpenAPIMountOptions & Partial<OpenAPIGenerateOptions>) = {}
  ): void {
    const spec = Array.isArray(specOrControllers)
      ? this.generate(specOrControllers, options as OpenAPIGenerateOptions)
      : specOrControllers;

    const specPath = options.specPath ?? '/openapi.json';
    const docsPath = options.docsPath === undefined ? '/docs' : options.docsPath;
    const specJson = JSON.stringify(spec);

    app.get(specPath, (c) => {
      c.header('Content-Type', 'application/json; charset=utf-8');
      c.header('Access-Control-Allow-Origin', '*');
      return c.body(specJson);
    });

    if (docsPath) {
      const html = this.buildScalarHtml(specPath);
      app.get(docsPath, (c) => c.html(html));
    }
  }

  private static buildScalarHtml(specUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>API Reference</title>
  <style>body { margin: 0; }</style>
</head>
<body>
  <script
    id="api-reference"
    data-url="${specUrl}"
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.1/dist/browser/standalone.min.js"></script>
</body>
</html>`;
  }
}
