import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import {
  getClassMeta,
  METADATA_KEYS,
  type ResponseStatusMetadata,
  type ValidationMetadata,
} from '../decorators/metadata';
import { HonoRouteBuilder, type RouteDescription } from '../core/route-builder';
import { zodToJsonSchema } from '../openapi/generator';

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
}

export interface FlowExtractor {
  variableName: string;
  path: string;
}

export interface FlowAssertion {
  path: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'exists' | 'greaterThan' | 'lessThan';
  expected?: unknown;
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

function statusAssertion(
  route: RouteDescription,
  statusByHandler: Record<string, ResponseStatusMetadata>,
): FlowAssertion[] {
  const expected = statusByHandler[route.handlerName]?.status
    ?? (route.method === 'delete' ? 204 : 200);
  return [{ path: '$status', operator: 'equals', expected: String(expected) }];
}

/* ================= GENERATOR ================= */

interface BuiltControllerNodes {
  nodes: ApiTesterFlowNode[];
  edges: ApiTesterFlowEdge[];
  usedVars: Set<string>;
}

/** Build the node chain for one controller — CRUD-ordered, linearly edged. */
function buildControllerNodes(
  ControllerClass: Function,
  ctx: { wsBase: string; listenDurationMs: number },
): BuiltControllerNodes {
  const { wsBase, listenDurationMs } = ctx;
  const routes = HonoRouteBuilder.describe(ControllerClass as any)
    .slice()
    .sort((a, b) => routeOrder(a) - routeOrder(b));

  const validationMap =
    getClassMeta<Record<string, ValidationMetadata>>(ControllerClass, METADATA_KEYS.VALIDATION) ?? {};
  const statusMap =
    getClassMeta<Record<string, ResponseStatusMetadata>>(ControllerClass, METADATA_KEYS.RESPONSE_STATUS) ?? {};

  // Item-route params that a sibling collection POST can provide via extractor.
  const itemParams = new Set(
    routes.filter(r => pathParamNames(r.path).length > 0).flatMap(r => pathParamNames(r.path)),
  );

  const usedVars = new Set<string>();
  const nodes: ApiTesterFlowNode[] = [];
  const edges: ApiTesterFlowEdge[] = [];

  for (const route of routes) {
    const validation = validationMap[route.handlerName];
    const paramNames = pathParamNames(route.path);
    const headers: FlowKeyValue[] = [];
    const extractors: FlowExtractor[] = [];
    const assertions: FlowAssertion[] = [];

    if (route.guards.length && !route.isPublic) {
      headers.push(kv('Authorization', 'Bearer {{token}}'));
      usedVars.add('token');
    }

    const pathParams = paramNames.map(p => {
      usedVars.add(p);
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
        url: interpolatePath(route.path),
        pathParams,
        headers,
        listenDurationMs,
        extractors,
        assertions: statusAssertion(route, statusMap),
      } satisfies ApiTesterSseConfig;
    } else if (route.websocket || route.channelRoute) {
      config = {
        type: 'ws',
        url: `${wsBase}${interpolatePath(route.path)}`,
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
      const rest: ApiTesterRestConfig = {
        type: 'rest',
        method,
        url: interpolatePath(route.path),
        headers,
        query,
        pathParams: pathParams.length ? pathParams : undefined,
        extractors,
        assertions: statusAssertion(route, statusMap),
      };
      if (validation?.body && method !== 'GET' && method !== 'DELETE') {
        rest.bodyMode = 'raw';
        headers.push(kv('Content-Type', 'application/json'));
        rest.body = JSON.stringify(jsonSchemaToExample(zodToJsonSchema(validation.body as ZodType)), null, 2);
      }
      rest.assertions.push(...assertions);
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

  return { nodes, edges, usedVars };
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
): ApiTesterFlowFile['settings'] {
  // Any {{var}} used but never produced by an extractor → editable default variable.
  const defaultVariables = [...variables];
  for (const v of usedVars) {
    if (!produced.has(v) && !defaultVariables.some(d => d.key === v)) {
      defaultVariables.push(kv(v, '', false));
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
  const { baseUrl = 'http://localhost:3000', listenDurationMs = 10_000, variables = [] } = options;
  const wsBase = baseUrl.replace(/^http/, 'ws');

  return resolveControllers(target).map(ControllerClass => {
    const { nodes, edges, usedVars } = buildControllerNodes(ControllerClass, { wsBase, listenDurationMs });
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
        settings: flowSettings(baseUrl, variables, usedVars, produced),
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
  const { baseUrl = 'http://localhost:3000', listenDurationMs = 10_000, variables = [] } = options;
  const wsBase = baseUrl.replace(/^http/, 'ws');
  const controllers = resolveControllers(target);

  const nodes: ApiTesterFlowNode[] = [];
  const edges: ApiTesterFlowEdge[] = [];
  const groups: ApiTesterFlowGroup[] = [];
  const usedVars = new Set<string>();
  const produced = new Set<string>();

  controllers.forEach((ControllerClass, i) => {
    const built = buildControllerNodes(ControllerClass, { wsBase, listenDurationMs });
    if (!built.nodes.length) return;

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
      settings: flowSettings(baseUrl, variables, usedVars, produced),
    },
  };
}

/* ================= YAML EMITTER (dependency-free) ================= */

const YAML_PLAIN = /^[A-Za-z0-9 _.\/-]+$/;
const YAML_KEYWORDS = /^(true|false|null|yes|no|on|off|~)$/i;

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s !== '' && YAML_PLAIN.test(s) && !YAML_KEYWORDS.test(s) && !/^\d/.test(s)) return s;
  return JSON.stringify(s);
}

function yamlEntry(key: string, v: unknown, pad: string, indent: number): string[] {
  if (isScalar(v)) return [`${pad}${key}: ${yamlScalar(v)}`];
  if (Array.isArray(v) && !v.length) return [`${pad}${key}: []`];
  if (isObject(v) && !Object.keys(v).length) return [`${pad}${key}: {}`];
  return [`${pad}${key}:`, ...yamlLines(v, indent + 1)];
}

function yamlLines(value: unknown, indent: number): string[] {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (isObject(item)) {
        const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (!entries.length) return [`${pad}- {}`];
        const [k, v] = entries[0]!;
        const head = isScalar(v)
          ? `${pad}- ${k}: ${yamlScalar(v)}`
          : Array.isArray(v) && !v.length
            ? `${pad}- ${k}: []`
            : isObject(v) && !Object.keys(v).length
              ? `${pad}- ${k}: {}`
              : `${pad}- ${k}:`;
        const rest = [
          ...(isScalar(v) || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length)
            ? []
            : yamlLines(v, indent + 2)),
          ...entries.slice(1).flatMap(([k2, v2]) => yamlEntry(k2, v2, `${pad}  `, indent + 1)),
        ];
        return [head, ...rest];
      }
      if (Array.isArray(item)) return [`${pad}-`, ...yamlLines(item, indent + 1)];
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }
  if (isObject(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (!entries.length) return [`${pad}{}`];
    return entries.flatMap(([k, v]) => yamlEntry(k, v, pad, indent));
  }
  return [`${pad}${yamlScalar(value)}`];
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Serialize a FlowFile to YAML understood by api-tester's `yamlToFlow`. */
export function stringifyFlowFile(file: ApiTesterFlowFile): string {
  return yamlLines(file, 0).join('\n') + '\n';
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
