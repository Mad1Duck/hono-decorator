/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { METADATA_KEYS } from '../decorators/metadata';
import type { RouteMetadata, GuardMetadata, OpenAPIMetadata } from '../decorators/metadata';

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

/** Convert Hono path params /:id → OpenAPI {id} */
function honoPathToOpenAPI(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}');
}

/** Extract all :param names from a Hono path string */
function extractPathParamNames(path: string): string[] {
  return [...path.matchAll(/:([^/]+)/g)].map(m => m[1]!);
}

/** Convert a Zod schema to a plain JSON Schema object. */
function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
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

        /* --- Tags --- */
        const tags = [...(classOpenApi.tags ?? []), ...(methodMeta.tags ?? [])];

        /* --- Security --- */
        const needsAuth = !isPublic && guards.some(g =>
          g.name === 'AuthGuard' || g.name === 'RoleGuard' || g.name === 'PermissionGuard'
        );
        if (needsAuth) needsBearerAuth = true;

        /* --- Path parameters (inferred from URL) --- */
        const pathParamNames = extractPathParamNames(honoFullPath);
        const parameters: unknown[] = pathParamNames.map(name =>
          compact({ name, in: 'path', required: true, schema: { type: 'string' } })
        );

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

        if (needsAuth) {
          responses['401'] = { description: 'Unauthorized' };
          responses['403'] = { description: 'Forbidden' };
        }

        /* --- Build operation --- */
        const descriptionPrefix = isSse ? '(SSE stream) ' : isWs ? '(WebSocket upgrade) ' : '';
        const operation = compact({
          operationId: `${openApiMethod}_${handlerName}`,
          summary: methodMeta.summary,
          description: methodMeta.description
            ? `${descriptionPrefix}${methodMeta.description}`
            : (isSse || isWs ? descriptionPrefix.trim() : undefined),
          tags: tags.length > 0 ? tags : undefined,
          deprecated: methodMeta.deprecated,
          security: needsAuth ? [{ bearerAuth: [] }] : isPublic ? [] : undefined,
          parameters: parameters.length > 0 ? parameters : undefined,
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
