/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { METADATA_KEYS } from '../decorators/metadata';
import type {
  RouteMetadata,
  ParamMetadata,
  GuardMetadata,
  OpenAPIMetadata,
} from '../decorators/metadata';

/* ================= TYPES ================= */

type Constructor = new (...args: unknown[]) => unknown;

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

/** Convert Hono path params /:id → OpenAPI {id} */
function honoPathToOpenAPI(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}');
}

/** Extract all :param names from a Hono path string */
function extractPathParamNames(path: string): string[] {
  return [...path.matchAll(/:([^/]+)/g)].map(m => m[1]!);
}

/** Convert a Zod schema to a plain JSON Schema object (strips the $schema key). */
function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const full = (z as any).toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = full;
  return rest;
}

/** Strip undefined values from an object (keeps JSON output clean). */
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

    for (const ControllerClass of controllers) {
      const controllerMeta = Reflect.getMetadata(
        METADATA_KEYS.CONTROLLER,
        ControllerClass
      ) as { basePath: string } | undefined;

      if (!controllerMeta) continue;

      const routes = (Reflect.getMetadata(
        METADATA_KEYS.ROUTES,
        ControllerClass
      ) as RouteMetadata[] | undefined) ?? [];

      // Class-level OpenAPI metadata (tags from @ApiTags on the class)
      const classMeta = (Reflect.getMetadata(
        METADATA_KEYS.OPENAPI,
        ControllerClass
      ) as OpenAPIMetadata | undefined) ?? {};

      const proto = ControllerClass.prototype as object;

      for (const route of routes) {
        // Skip methods that don't map cleanly to OpenAPI operations
        if (route.method === 'all') continue;

        const { method, path, handlerName } = route;
        const honoFullPath = `${controllerMeta.basePath}${path}`;
        const openApiPath = honoPathToOpenAPI(honoFullPath);
        const openApiMethod = method === 'head' ? 'head' : method;

        /* --- Read metadata --- */
        const methodMeta = (Reflect.getMetadata(
          METADATA_KEYS.OPENAPI, proto, handlerName
        ) as OpenAPIMetadata | undefined) ?? {};

        const params = (Reflect.getMetadata(
          METADATA_KEYS.PARAMS, proto, handlerName
        ) as ParamMetadata[] | undefined) ?? [];

        const guards = (Reflect.getMetadata(
          METADATA_KEYS.GUARDS, proto, handlerName
        ) as GuardMetadata[] | undefined) ?? [];

        const isPublic = Reflect.getMetadata('isPublic', proto, handlerName) as boolean | undefined;
        const isSse = Reflect.getMetadata(METADATA_KEYS.SSE_ROUTE, proto, handlerName) as boolean | undefined;
        const isWs = Reflect.getMetadata(METADATA_KEYS.WEBSOCKET_ROUTE, proto, handlerName) as boolean | undefined;

        /* --- Tags --- */
        const tags = [...(classMeta.tags ?? []), ...(methodMeta.tags ?? [])];

        /* --- Security --- */
        const needsAuth = !isPublic && guards.some(g =>
          g.name === 'AuthGuard' || g.name === 'RoleGuard' || g.name === 'PermissionGuard'
        );
        if (needsAuth) needsBearerAuth = true;

        /* --- Path parameters --- */
        const pathParamNames = extractPathParamNames(honoFullPath);
        const parameters: unknown[] = pathParamNames.map(name => {
          const meta = params.find(p => p.type === 'param' && p.name === name);
          return compact({
            name,
            in: 'path',
            required: true,
            schema: meta?.schema ? zodToJsonSchema(meta.schema) : { type: 'string' },
          });
        });

        /* --- Query parameters --- */
        const queryParam = params.find(p => p.type === 'query');
        if (queryParam?.schema) {
          const qs = zodToJsonSchema(queryParam.schema);
          if (qs['type'] === 'object' && qs['properties']) {
            const props = qs['properties'] as Record<string, unknown>;
            const required = (qs['required'] as string[] | undefined) ?? [];
            for (const [name, propSchema] of Object.entries(props)) {
              parameters.push(compact({ name, in: 'query', required: required.includes(name), schema: propSchema }));
            }
          }
        } else if (queryParam) {
          // @Query() without schema — free-form object
          parameters.push({ name: 'query', in: 'query', required: false, schema: { type: 'object' } });
        }

        /* --- Request body --- */
        const bodyParam = params.find(p => p.type === 'body');
        const requestBody = bodyParam?.schema
          ? {
            required: true,
            content: { 'application/json': { schema: zodToJsonSchema(bodyParam.schema) } },
          }
          : undefined;

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

        if (bodyParam?.schema || queryParam?.schema) {
          responses['400'] = {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
                  },
                },
              },
            },
          };
        }

        if (needsAuth) {
          responses['401'] = { description: 'Unauthorized' };
          responses['403'] = { description: 'Forbidden' };
        }

        /* --- Build operation --- */
        const descriptionPrefix = isSse ? '(SSE stream) ' : isWs ? '(WebSocket upgrade) ' : '';
        const operation = compact({
          operationId: `${openApiMethod}_${handlerName}`,
          summary: methodMeta.summary,
          description: methodMeta.description ? `${descriptionPrefix}${methodMeta.description}` : (isSse || isWs ? descriptionPrefix.trim() : undefined),
          tags: tags.length > 0 ? tags : undefined,
          deprecated: methodMeta.deprecated,
          security: needsAuth ? [{ bearerAuth: [] }] : isPublic ? [] : undefined,
          parameters: parameters.length > 0 ? parameters : undefined,
          requestBody,
          responses,
        });

        if (!paths[openApiPath]) paths[openApiPath] = {};
        paths[openApiPath]![openApiMethod] = operation;
      }
    }

    return compact({
      openapi: '3.1.0',
      info: options.info,
      servers: options.servers,
      paths,
      components: needsBearerAuth
        ? { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }
        : undefined,
    });
  }

  /**
   * Mount `/openapi.json` and Scalar UI (`/docs`) onto an existing Hono app.
   *
   * @example
   * const spec = OpenAPIGenerator.generate([UserController], { info: { title: 'API', version: '1.0.0' } });
   * OpenAPIGenerator.mount(app, spec);
   */
  static mount(
    app: Hono,
    spec: Record<string, unknown>,
    options: OpenAPIMountOptions = {}
  ): void {
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
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.min.js"></script>
</body>
</html>`;
  }
}
