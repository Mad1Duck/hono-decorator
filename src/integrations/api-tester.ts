import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import {
  getClassMeta,
  METADATA_KEYS,
  type OpenAPIMetadata,
  type ResponseStatusMetadata,
  type ValidationMetadata,
} from '../decorators/metadata';
import { JWT_AUTH_MIDDLEWARE } from '../decorators/common-middleware';
import { HonoRouteBuilder, type RouteDescription } from '../core/route-builder';
import { zodToJsonSchema } from '../openapi/generator';
import { yamlStringify } from '../utils/yaml';

/**
 * api-tester integration — generate ready-to-run flow files (FlowFile v1)
 * from controller route metadata.
 *
 * The generated `.flow.yaml` files can be imported straight into api-tester
 * (Import → flow file): routes become REST/SSE/WebSocket nodes, @Validate
 * schemas become sample request bodies and typed path params, guarded routes
 * get `Authorization: Bearer {{token}}` headers, and conventional CRUD routes
 * are chained — `POST /todos` extracts `id` and `GET /todos/:id` consumes it
 * as `{{id}}`.
 *
 * The format mirrors api-tester's `FlowFile` (version 1). It is intentionally
 * self-contained here so hono-forge stays dependency-free.
 *
 * @example
 * // scripts/export-flows.ts — bun scripts/export-flows.ts
 * import { writeFlowFiles } from 'hono-forge';
 * import { AppModule } from './src/app.module';
 *
 * await writeFlowFiles('./flows', AppModule, { baseUrl: 'http://localhost:3000' });
 * // → flows/todos.flow.yaml, flows/users.flow.yaml, ...
 */

/* ================= FLOW FILE TYPES (api-tester v1 mirror) ================= */

export interface FlowKeyValue {
  key: string;
  value: string;
  enabled: boolean;
  /** 'file' rows treat `value` as a file path (api-tester multipart upload). */
  type?: 'text' | 'file';
  fileName?: string;
}

export interface FlowExtractor {
  variableName: string;
  path: string;
}

export interface FlowAssertion {
  path: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'exists' | 'greaterThan' | 'lessThan';
  expected?: unknown;
  /** Mirrors api-tester: only evaluate when the response status matches —
   *  keeps shape assertions from failing on error responses. */
  forStatus?: number;
}

export interface ApiTesterRestConfig {
  type: 'rest';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers: FlowKeyValue[];
  query: FlowKeyValue[];
  pathParams?: FlowKeyValue[];
  bodyMode?: 'none' | 'raw' | 'form-data' | 'x-www-form-urlencoded';
  body?: string;
  /** used when bodyMode is 'form-data' or 'x-www-form-urlencoded' */
  formData?: FlowKeyValue[];
  extractors: FlowExtractor[];
  assertions: FlowAssertion[];
}

export interface ApiTesterSseConfig {
  type: 'sse';
  url: string;
  pathParams?: FlowKeyValue[];
  headers: FlowKeyValue[];
  listenDurationMs: number;
  extractors: FlowExtractor[];
  assertions: FlowAssertion[];
}

export interface ApiTesterWsConfig {
  type: 'ws';
  url: string;
  messagesToSend: string[];
  listenDurationMs: number;
  extractors: FlowExtractor[];
  assertions: FlowAssertion[];
}

export type ApiTesterNodeConfig = ApiTesterRestConfig | ApiTesterSseConfig | ApiTesterWsConfig;

export interface ApiTesterFlowNode {
  id: string;
  label: string;
  position: { x: number; y: number };
  config: ApiTesterNodeConfig;
  /** membership in a FlowGroup — position is relative to the group when set */
  groupId?: string;
  enabled?: boolean;
}

export interface ApiTesterFlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface ApiTesterFlowGroup {
  id: string;
  label: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ApiTesterFlowFile {
  version: 1;
  id: string;
  name: string;
  description?: string;
  nodes: ApiTesterFlowNode[];
  edges: ApiTesterFlowEdge[];
  groups?: ApiTesterFlowGroup[];
  tags?: string[];
  settings?: {
    baseUrl?: string;
    defaultHeaders?: FlowKeyValue[];
    defaultVariables?: FlowKeyValue[];
  };
}

export interface FlowFileResult {
  /** api-tester FlowFile v1 — pass to stringifyFlowFile() or writeFlowFiles(). */
  file: ApiTesterFlowFile;
  /** Suggested file name, e.g. 'todos.flow.yaml'. */
  fileName: string;
}

export interface GenerateFlowOptions {
  /** Base URL used for the flow's settings.baseUrl. Default 'http://localhost:3000'. */
  baseUrl?: string;
  /** Listen duration for SSE/WebSocket nodes. Default 10000. */
  listenDurationMs?: number;
  /** Extra variables added to settings.defaultVariables (e.g. env tokens). */
  variables?: FlowKeyValue[];
  /** Prepend a login/auth step to every generated flow — its extractors
   *  produce the variables guarded routes reference (e.g. `{{token}}`), so
   *  generated flows actually run against authenticated APIs instead of
   *  401-ing everywhere. Body may itself contain `{{vars}}` (username/
   *  password), which become editable flow variables. */
  auth?: FlowAuthSpec;
  /** Extra query params appended verbatim to WebSocket node URLs —
   *  `?k=v&k2=v2`. Values may contain {{vars}} (e.g. `token={{token}}` for
   *  channels that authenticate via the connection URL). */
  wsQuery?: Record<string, string>;
}

/** A login step prepended to generated flows — see GenerateFlowOptions.auth. */
export interface FlowAuthSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path relative to the flow's baseUrl, e.g. '/v1/auth/login'. */
  path: string;
  /** Raw request body (usually JSON) — may contain {{vars}}. */
  body?: string;
  /** Extractors: flow variable → JSONPath into the login response,
   *  e.g. `{ token: 'data.accessToken' }` (`$.` is prefixed if missing). */
  extract: Record<string, string>;
}

/* ================= HELPERS ================= */

/** Deterministic id derived from a name — re-exporting the same controller keeps the same flow id. */
function stableId(seed: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).repeat(2).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function kv(key: string, value: string, enabled = true): FlowKeyValue {
  return { key, value, enabled };
}

/** `{{var}}` references inside a string — same charset api-tester interpolates. */
function templateVars(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]!);
}

/** A login node whose extractors feed `{{token}}` (et al) to guarded routes.
 *  `idSeed` keeps the node id stable per file so re-exports don't churn. */
function buildAuthNode(
  auth: FlowAuthSpec,
  idSeed: string,
): { node: ApiTesterFlowNode; usedVars: Set<string> } {
  const usedVars = new Set<string>();
  for (const v of templateVars(`${auth.path} ${auth.body ?? ''}`)) usedVars.add(v);
  const node: ApiTesterFlowNode = {
    id: stableId(`auth:${idSeed}`),
    label: `${auth.method} ${auth.path} — auth`,
    position: { x: 0, y: 0 },
    config: {
      type: 'rest',
      method: auth.method,
      url: auth.path,
      headers: auth.body ? [kv('Content-Type', 'application/json')] : [],
      query: [],
      ...(auth.body ? { bodyMode: 'raw' as const, body: auth.body } : {}),
      extractors: Object.entries(auth.extract).map(([variableName, p]) => ({
        variableName,
        path: p.startsWith('$') ? p : `$.${p}`,
      })),
      assertions: [],
    },
    enabled: true,
  };
  return { node, usedVars };
}

/** ':id' / ':id{regex}' route segments → api-tester '{{id}}' interpolation. */
function interpolatePath(path: string): string {
  return path.replace(/:([^/{]+)(?:\{[^}]*\})?/g, '{{$1}}');
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([^/{]+)(?:\{[^}]*\})?/g)].map(m => m[1]!);
}

/** Deterministic example value from a JSON Schema — no faker dependency. */
function jsonSchemaToExample(schema: Record<string, unknown>, key?: string): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.const) || schema.const !== undefined) return schema.const;
  const combo = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  if (combo?.length) return jsonSchemaToExample(combo[0]!, key);
  const allOf = schema.allOf as Record<string, unknown>[] | undefined;
  if (allOf?.length) {
    return Object.assign({}, ...allOf.map(s => jsonSchemaToExample(s, key)));
  }
  const type = schema.type as string | string[] | undefined;
  const t = Array.isArray(type) ? type.find(x => x !== 'null') : type;

  if (t === 'object' || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((schema.properties as Record<string, Record<string, unknown>>) ?? {})) {
      out[k] = jsonSchemaToExample(v, k);
    }
    return out;
  }
  if (t === 'array') return [jsonSchemaToExample((schema.items as Record<string, unknown>) ?? {}, key)];
  if (t === 'integer' || t === 'number') return 42;
  if (t === 'boolean') return true;
  if (t === 'null') return null;

  // string (or unknown) — use format and the property name for plausible values
  const format = schema.format as string | undefined;
  const name = (key ?? '').toLowerCase();
  if (format === 'uuid' || name === 'id' || name.endsWith('id')) return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  if (format === 'email' || name.includes('email')) return 'user@example.com';
  if (format === 'date-time' || name.endsWith('at')) return '2026-01-01T00:00:00.000Z';
  if (format === 'date') return '2026-01-01';
  if (format === 'uri' || format === 'url' || name.includes('url')) return 'https://example.com';
  if (name.includes('password')) return 'S3cure!Passw0rd';
  if (name.includes('phone')) return '+12025550123';
  if (name.includes('name') || name.includes('title')) return 'Example';
  return 'string';
}

/**
 * CRUD-aware ordering: collection GET first, then create, item reads,
 * updates, delete last; unrecognised routes in between; SSE/WS listeners last.
 */
function routeOrder(d: RouteDescription): number {
  const hasParams = pathParamNames(d.path).length > 0;
  if (d.sse || d.websocket) return 70;
  switch (d.method) {
    case 'get':    return hasParams ? 20 : 10;
    case 'post':   return hasParams ? 30 : 15;
    case 'put':    return 40;
    case 'patch':  return 45;
    case 'delete': return 50;
    default:       return 60;
  }
}

/** Expected success status: explicit @Status, else the lowest documented 2xx
 *  from @ApiResponse, else the conventional default for the method. */
function expectedStatus(
  route: RouteDescription,
  statusByHandler: Record<string, ResponseStatusMetadata>,
  openApi?: OpenAPIMetadata,
): number {
  const declared = statusByHandler[route.handlerName]?.status;
  if (declared) return declared;
  const documented = Object.keys(openApi?.responses ?? {})
    .map(Number)
    .filter((n) => n >= 200 && n < 300)
    .sort((a, b) => a - b)[0];
  return documented ?? (route.method === 'delete' ? 204 : 200);
}

function statusAssertion(
  route: RouteDescription,
  statusByHandler: Record<string, ResponseStatusMetadata>,
  openApi?: OpenAPIMetadata,
): FlowAssertion[] {
  return [{ path: '$status', operator: 'equals', expected: String(expectedStatus(route, statusByHandler, openApi)) }];
}

const MAX_SHAPE_ASSERTIONS = 8;

/** Required property paths of an object JSON Schema — `$.a`, `$.b` (or `$[0].a` for arrays). */
function shapePaths(js: Record<string, unknown>, prefix: string): string[] {
  const props = js.properties as Record<string, unknown> | undefined;
  const required = Array.isArray(js.required) ? (js.required as string[]) : [];
  if (!props || !required.length) return [];
  return required
    .filter((p) => props[p] !== undefined)
    .slice(0, MAX_SHAPE_ASSERTIONS)
    .map((p) => `${prefix}${p}`);
}

/**
 * `@Serialize`/`@ValidateResult`-style response contracts → seeded `exists`
 * assertions for the response's required top-level fields, scoped to the
 * success status. Cheap contract coverage without a schema-eval assertion type.
 */
function responseShapeAssertions(
  route: RouteDescription,
  statusByHandler: Record<string, ResponseStatusMetadata>,
  serializeMap: Record<string, ZodType>,
  openApi?: OpenAPIMetadata,
): FlowAssertion[] {
  const forStatus = expectedStatus(route, statusByHandler, openApi);
  // @Serialize/@ValidateResult first; @ApiResponse(2xx, schema) as fallback.
  const zod = serializeMap[route.handlerName] ?? serializeMap['*']
    ?? openApi?.responses?.[forStatus]?.schema;
  if (!zod) return [];
  try {
    const js = zodToJsonSchema(zod) as Record<string, unknown>;
    const paths =
      js.type === 'array'
        ? shapePaths((js.items ?? {}) as Record<string, unknown>, '$[0].')
        : shapePaths(js, '$.');
    return paths.map((path) => ({ path, operator: 'exists' as const, forStatus }));
  } catch {
    return [];
  }
}

/** JSON-schema file field — `z.file()` serialises to format/contentEncoding 'binary'. */
function isBinarySchema(js: Record<string, unknown>): boolean {
  return js.format === 'binary' || js.contentEncoding === 'binary';
}

/**
 * Request body → api-tester body config. Schemas with a top-level file field
 * (`z.file()`) become `form-data` rows — file fields get `type: 'file'` rows,
 * the rest get example values. Plain schemas become a raw JSON example;
 * schemas zod can't serialise (e.g. z.instanceof(File)) fall back to an
 * empty raw body the user can fill in.
 */
function bodyParts(
  bodySchema: ZodType,
): Pick<ApiTesterRestConfig, 'bodyMode' | 'body' | 'formData'> & { headers: FlowKeyValue[] } {
  try {
    const js = zodToJsonSchema(bodySchema) as Record<string, unknown>;
    const props = (js.properties ?? {}) as Record<string, Record<string, unknown>>;
    const entries = Object.entries(props);
    if (entries.length && entries.some(([, v]) => isBinarySchema(v))) {
      // multipart — api-tester sets the boundary Content-Type itself
      return {
        bodyMode: 'form-data',
        headers: [],
        formData: entries.map(([k, v]) =>
          isBinarySchema(v)
            ? { key: k, value: '', enabled: true, type: 'file' as const }
            : kv(k, String(jsonSchemaToExample(v, k)))),
      };
    }
    return {
      bodyMode: 'raw',
      headers: [kv('Content-Type', 'application/json')],
      body: JSON.stringify(jsonSchemaToExample(js)),
    };
  } catch {
    return {
      bodyMode: 'raw',
      headers: [kv('Content-Type', 'application/json')],
      body: '',
    };
  }
}

/* ================= GENERATOR ================= */

/** `@JwtAuth` produces an anonymous middleware, not a guard — detect it via
 *  the same JWT_AUTH_MIDDLEWARE marker the OpenAPI generator uses. */
const isJwtAuthMw = (m: unknown): boolean =>
  typeof m === 'function' &&
  (m as unknown as Record<symbol, unknown>)[JWT_AUTH_MIDDLEWARE] === true;

/**
 * Query params for a realtime node URL. WebSocket nodes can't carry headers
 * in api-tester (and browsers can't set them either), so auth rides on the
 * connection URL: `?token={{token}}` for auth-protected/@ChannelAuth routes,
 * `?name={{name}}` for @ApiQuery-declared params, plus user `wsQuery` pairs.
 */
function realtimeQueryPairs(input: {
  needsAuth: boolean;
  channelAuth: boolean;
  openapi?: OpenAPIMetadata;
  wsQuery?: Record<string, string>;
  usedVars: Set<string>;
  varSeeds: Record<string, string>;
}): [string, string][] {
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  const push = (k: string, v: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push([k, v]);
  };
  if (input.needsAuth || input.channelAuth) {
    push('token', '{{token}}');
    input.usedVars.add('token');
  }
  for (const [name, meta] of Object.entries(input.openapi?.query ?? {})) {
    push(name, `{{${name}}}`);
    input.usedVars.add(name);
    if (input.varSeeds[name] === undefined) {
      try {
        input.varSeeds[name] = String(
          jsonSchemaToExample(zodToJsonSchema(meta.schema), name),
        );
      } catch { /* leave unseeded */ }
    }
  }
  for (const [k, v] of Object.entries(input.wsQuery ?? {})) {
    push(k, v);
    for (const tv of templateVars(v)) input.usedVars.add(tv);
  }
  return pairs;
}

/** Append `?k=v&…` verbatim — values are templates, so no URL-encoding. */
function appendQuery(url: string, pairs: [string, string][]): string {
  if (!pairs.length) return url;
  const qs = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

interface BuiltControllerNodes {
  nodes: ApiTesterFlowNode[];
  edges: ApiTesterFlowEdge[];
  usedVars: Set<string>;
  /** Seed values for `{{var}}` references — e.g. path params with a
   *  @Validate({params}) schema get a schema-derived example as the editable
   *  variable default instead of a blank. */
  varSeeds: Record<string, string>;
}

/** Build the node chain for one controller — CRUD-ordered, linearly edged. */
function buildControllerNodes(
  ControllerClass: Function,
  ctx: {
    wsBase: string;
    listenDurationMs: number;
    auth?: FlowAuthSpec;
    wsQuery?: Record<string, string>;
  },
): BuiltControllerNodes {
  const { wsBase, listenDurationMs, auth, wsQuery } = ctx;
  const routes = HonoRouteBuilder.describe(ControllerClass as any)
    .slice()
    .sort((a, b) => routeOrder(a) - routeOrder(b));

  const validationMap =
    getClassMeta<Record<string, ValidationMetadata>>(ControllerClass, METADATA_KEYS.VALIDATION) ?? {};
  const openapiMap =
    getClassMeta<Record<string, OpenAPIMetadata>>(ControllerClass, METADATA_KEYS.OPENAPI) ?? {};
  const statusMap =
    getClassMeta<Record<string, ResponseStatusMetadata>>(ControllerClass, METADATA_KEYS.RESPONSE_STATUS) ?? {};
  const serializeMap =
    getClassMeta<Record<string, ZodType>>(ControllerClass, METADATA_KEYS.SERIALIZE) ?? {};
  const classMws =
    getClassMeta<unknown[]>(ControllerClass, METADATA_KEYS.MIDDLEWARES) ?? [];
  const methodMwsMap =
    getClassMeta<Record<string, unknown[]>>(ControllerClass, METADATA_KEYS.METHOD_MIDDLEWARES) ?? {};
  const channelAuthMap =
    getClassMeta<Record<string, unknown>>(ControllerClass, METADATA_KEYS.CHANNEL_AUTH) ?? {};
  const classJwtAuth = classMws.some(isJwtAuthMw);

  // Item-route params that a sibling collection POST can provide via extractor.
  const itemParams = new Set(
    routes.filter(r => pathParamNames(r.path).length > 0).flatMap(r => pathParamNames(r.path)),
  );

  const usedVars = new Set<string>();
  const varSeeds: Record<string, string> = {};
  const nodes: ApiTesterFlowNode[] = [];
  const edges: ApiTesterFlowEdge[] = [];

  // Auth preamble — a login node first, so every guarded route downstream
  // gets its {{token}} from a real response instead of a blank variable.
  if (auth) {
    const { node, usedVars: authVars } = buildAuthNode(auth, ControllerClass.name);
    nodes.push(node);
    for (const v of authVars) usedVars.add(v);
  }

  for (const route of routes) {
    const validation = validationMap[route.handlerName];
    const openapi = openapiMap[route.handlerName];
    const paramNames = pathParamNames(route.path);
    const headers: FlowKeyValue[] = [];
    const extractors: FlowExtractor[] = [];
    const assertions: FlowAssertion[] = [];

    // Auth detection covers guards AND @JwtAuth — a middleware decorator,
    // not a guard, so route.guards alone missed it (#7). Same inference as
    // the OpenAPI generator's bearerAuth security.
    const needsAuth =
      !route.isPublic &&
      (route.guards.length > 0 ||
        classJwtAuth ||
        (methodMwsMap[route.handlerName] ?? []).some(isJwtAuthMw));
    if (needsAuth) {
      headers.push(kv('Authorization', 'Bearer {{token}}'));
      usedVars.add('token');
    }

    const pathParams = paramNames.map(p => {
      usedVars.add(p);
      // @Validate({params}) documents each param's schema — seed the editable
      // variable with a schema-derived example so the flow runs out of the box.
      const paramSchema = openapi?.params?.[p]?.schema;
      if (paramSchema && varSeeds[p] === undefined) {
        try {
          varSeeds[p] = String(jsonSchemaToExample(zodToJsonSchema(paramSchema), p));
        } catch { /* leave unseeded */ }
      }
      return kv(p, `{{${p}}}`);
    });

    // A collection POST that precedes item routes extracts their params from the response.
    const providesParams = route.method === 'post' && paramNames.length === 0 && itemParams.size > 0;
    if (providesParams) {
      for (const p of itemParams) extractors.push({ variableName: p, path: `$.${p}` });
      if (itemParams.has('id')) assertions.push({ path: '$.id', operator: 'exists' });
    }

    let config: ApiTesterNodeConfig;
    const method = route.method.toUpperCase();

    if (route.sse) {
      config = {
        type: 'sse',
        // SSE has no query field — declared @ApiQuery params ride on the URL
        // (auth rides on the Authorization header instead).
        url: appendQuery(
          interpolatePath(route.path),
          realtimeQueryPairs({
            needsAuth: false,
            channelAuth: false,
            openapi,
            usedVars,
            varSeeds,
          }),
        ),
        pathParams,
        headers,
        listenDurationMs,
        extractors,
        assertions: statusAssertion(route, statusMap, openapi),
      } satisfies ApiTesterSseConfig;
    } else if (route.websocket || route.channelRoute) {
      config = {
        type: 'ws',
        // WS can't carry headers — auth-protected routes get ?token={{token}},
        // declared @ApiQuery params and user --ws-query pairs join them (#8).
        url: appendQuery(
          `${wsBase}${interpolatePath(route.path)}`,
          realtimeQueryPairs({
            needsAuth,
            channelAuth: channelAuthMap[route.handlerName] !== undefined,
            openapi,
            wsQuery,
            usedVars,
            varSeeds,
          }),
        ),
        messagesToSend: [],
        listenDurationMs,
        extractors,
        assertions: [],
      } satisfies ApiTesterWsConfig;
    } else {
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
        continue; // HEAD/OPTIONS/ALL have no api-tester rest method — skip
      }
      const query: FlowKeyValue[] = [];
      if (validation?.query) {
        const qs = zodToJsonSchema(validation.query as ZodType);
        for (const [k, v] of Object.entries((qs.properties as Record<string, Record<string, unknown>>) ?? {})) {
          query.push(kv(k, String(jsonSchemaToExample(v, k)), false));
        }
      }
      // @ApiQuery fallback for params the validation schema doesn't cover —
      // required ones enabled, optional ones as disabled placeholders.
      for (const [name, meta] of Object.entries(openapi?.query ?? {})) {
        if (query.some((q) => q.key === name)) continue;
        try {
          const js = zodToJsonSchema(meta.schema);
          query.push(kv(name, String(jsonSchemaToExample(js, name)), meta.required === true));
        } catch {
          query.push(kv(name, '', false));
        }
      }
      const rest: ApiTesterRestConfig = {
        type: 'rest',
        method,
        url: interpolatePath(route.path),
        headers,
        query,
        pathParams: pathParams.length ? pathParams : undefined,
        extractors,
        assertions: statusAssertion(route, statusMap, openapi),
      };
      if (method !== 'GET' && method !== 'DELETE') {
        // @Validate({body}) is the primary source; @ApiBody(schema) documents
        // the same shape for routes that validate inside the handler instead.
        const bodySchema = validation?.body ?? openapi?.body?.schema;
        if (bodySchema) {
          const parts = bodyParts(bodySchema);
          rest.bodyMode = parts.bodyMode;
          rest.body = parts.body;
          rest.formData = parts.formData;
          headers.push(...parts.headers);
        } else {
          // Schema-less mutation — leave the raw editor empty-but-visible so
          // the user sees a body field exists (an empty string sends no body).
          rest.bodyMode = 'raw';
          rest.body = '';
          headers.push(kv('Content-Type', 'application/json'));
        }
      }
      rest.assertions.push(...assertions);
      rest.assertions.push(...responseShapeAssertions(route, statusMap, serializeMap, openapi));
      config = rest;
    }

    const id = stableId(`${ControllerClass.name}.${route.handlerName}`);
    nodes.push({
      id,
      label: `${method} ${route.path} — ${route.handlerName}`,
      position: { x: 0, y: nodes.length * 110 },
      config,
      enabled: true,
    });
    if (nodes.length > 1) {
      edges.push({ id: stableId(`edge:${nodes[nodes.length - 2]!.id}>${id}`), source: nodes[nodes.length - 2]!.id, target: id });
    }
  }

  return { nodes, edges, usedVars, varSeeds };
}

function resolveControllers(target: Function | Function[]): Function[] {
  const targets = Array.isArray(target) ? target : [target];
  return targets.flatMap(t =>
    getClassMeta(t, METADATA_KEYS.MODULE) !== undefined
      ? (HonoRouteBuilder.moduleControllers(t) as Function[])
      : [t],
  );
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function flowSettings(
  baseUrl: string,
  variables: FlowKeyValue[],
  usedVars: Set<string>,
  produced: Set<string>,
  varSeeds: Record<string, string>,
): ApiTesterFlowFile['settings'] {
  // Any {{var}} used but never produced by an extractor → editable default variable.
  // Schema-seeded vars (e.g. typed path params) come pre-filled and enabled.
  const defaultVariables = [...variables];
  for (const v of usedVars) {
    if (!produced.has(v) && !defaultVariables.some(d => d.key === v)) {
      defaultVariables.push(kv(v, varSeeds[v] ?? '', varSeeds[v] !== undefined));
    }
  }
  return { baseUrl, ...(defaultVariables.length ? { defaultVariables } : {}) };
}

/**
 * Generate one api-tester flow file per controller. `target` may be a
 * @Controller class, an array of controllers, or a @Module class (controllers
 * are collected transitively).
 */
export function generateFlowFiles(
  target: Function | Function[],
  options: GenerateFlowOptions = {},
): FlowFileResult[] {
  const { baseUrl = 'http://localhost:3000', listenDurationMs = 10_000, variables = [], auth, wsQuery } = options;
  const wsBase = baseUrl.replace(/^http/, 'ws');

  return resolveControllers(target).map(ControllerClass => {
    const { nodes, edges, usedVars, varSeeds } = buildControllerNodes(ControllerClass, { wsBase, listenDurationMs, auth, wsQuery });
    const produced = new Set(nodes.flatMap(n => n.config.extractors.map(e => e.variableName)));
    const name = ControllerClass.name.replace(/Controller$/, '') || ControllerClass.name;
    return {
      fileName: `${kebab(name)}.flow.yaml`,
      file: {
        version: 1,
        id: stableId(`flow:${ControllerClass.name}`),
        name: `${name} flow`,
        description: `Generated from ${ControllerClass.name} by hono-forge`,
        nodes,
        edges,
        tags: ['generated', 'hono-forge'],
        settings: flowSettings(baseUrl, variables, usedVars, produced, varSeeds),
      },
    };
  });
}

/**
 * Generate a single api-tester flow file for the whole module — each
 * controller becomes a visual FlowGroup of linearly-chained nodes.
 */
export function generateFlowFile(
  target: Function | Function[],
  options: GenerateFlowOptions = {},
): FlowFileResult {
  const { baseUrl = 'http://localhost:3000', listenDurationMs = 10_000, variables = [], auth, wsQuery } = options;
  const wsBase = baseUrl.replace(/^http/, 'ws');
  const controllers = resolveControllers(target);

  const nodes: ApiTesterFlowNode[] = [];
  const edges: ApiTesterFlowEdge[] = [];
  const groups: ApiTesterFlowGroup[] = [];
  const usedVars = new Set<string>();
  const varSeeds: Record<string, string> = {};
  const produced = new Set<string>();

  // Single-file auth preamble — one ungrouped login node that every
  // controller group depends on, so the token exists before any group runs.
  let authEntry: { node: ApiTesterFlowNode; usedVars: Set<string> } | undefined;
  if (auth) {
    authEntry = buildAuthNode(auth, 'app');
    authEntry.node.position = { x: 0, y: -160 };
    nodes.push(authEntry.node);
    for (const v of authEntry.usedVars) usedVars.add(v);
    for (const e of authEntry.node.config.extractors) produced.add(e.variableName);
  }

  controllers.forEach((ControllerClass, i) => {
    const built = buildControllerNodes(ControllerClass, { wsBase, listenDurationMs, wsQuery });
    if (!built.nodes.length) return;
    if (authEntry) {
      edges.push({
        id: stableId(`edge:${authEntry.node.id}>${built.nodes[0]!.id}`),
        source: authEntry.node.id,
        target: built.nodes[0]!.id,
      });
    }

    const groupId = stableId(`group:${ControllerClass.name}`);
    const name = ControllerClass.name.replace(/Controller$/, '') || ControllerClass.name;
    const width = 280;
    const height = built.nodes.length * 110 + 60;
    groups.push({
      id: groupId,
      label: name,
      position: { x: i * (width + 60), y: 0 },
      size: { width, height },
    });
    for (const node of built.nodes) {
      nodes.push({ ...node, groupId, position: { x: 20, y: node.position.y + 40 } });
      for (const v of node.config.extractors.map(e => e.variableName)) produced.add(v);
    }
    edges.push(...built.edges);
    for (const v of built.usedVars) usedVars.add(v);
    Object.assign(varSeeds, built.varSeeds);
  });

  const targetName = Array.isArray(target)
    ? 'app'
    : (target.name.replace(/Module$|Controller$/, '') || target.name);
  return {
    fileName: `${kebab(targetName)}.flow.yaml`,
    file: {
      version: 1,
      id: stableId(`flow:${Array.isArray(target) ? 'app' : target.name}`),
      name: `${targetName} flow`,
      description: `Generated by hono-forge — ${groups.length} controller group(s)`,
      nodes,
      edges,
      groups: groups.length ? groups : undefined,
      tags: ['generated', 'hono-forge'],
      settings: flowSettings(baseUrl, variables, usedVars, produced, varSeeds),
    },
  };
}

/** Serialize a FlowFile to YAML understood by api-tester's `yamlToFlow`. */
export function stringifyFlowFile(file: ApiTesterFlowFile): string {
  return yamlStringify(file);
}

/**
 * Generate + write `.flow.yaml` files into `dir` (created if missing).
 * Returns the written file paths.
 */
export async function writeFlowFiles(
  dir: string,
  target: Function | Function[],
  options: GenerateFlowOptions = {},
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const results = generateFlowFiles(target, options);
  const paths: string[] = [];
  for (const { file, fileName } of results) {
    const p = join(dir, fileName);
    await writeFile(p, stringifyFlowFile(file), 'utf8');
    paths.push(p);
  }
  return paths;
}

/**
 * Single-file variant — one `.flow.yaml` with a FlowGroup per controller.
 * Returns the written file path.
 */
export async function writeFlowFile(
  dir: string,
  target: Function | Function[],
  options: GenerateFlowOptions = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const { file, fileName } = generateFlowFile(target, options);
  const p = join(dir, fileName);
  await writeFile(p, stringifyFlowFile(file), 'utf8');
  return p;
}
