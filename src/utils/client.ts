import { HonoRouteBuilder } from '../core/route-builder';
import type { ControllerConstructor } from '../core/types';

/* ================= TYPED CLIENT ================= */

/**
 * A route map produced by generateClientTypes():
 * keys are 'METHOD /path/:param', values carry the handler's return type.
 */
export type RouteMap = Record<string, { output: unknown; }>;

type RouteOutput<Routes, K> = K extends keyof Routes
  ? Routes[K] extends { output: infer O } ? O : unknown
  : unknown;

export interface ClientRequestInit {
  /** Path params — substituted into `:param` segments. */
  params?: Record<string, string | number>;
  /** Query params appended to the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Body — serialized as JSON. */
  body?: unknown;
  /** Extra RequestInit overrides. */
  init?: RequestInit;
}

export interface ForgeClient<Routes = RouteMap> {
  /**
   * Call a route by its key: 'GET /users/:id'. The return type is the
   * controller method's `Awaited<ReturnType>` when generated via
   * generateClientTypes — `unknown` otherwise.
   */
  request<K extends keyof Routes & string>(
    key: K,
    options?: ClientRequestInit
  ): Promise<RouteOutput<Routes, K>>;
  /** Raw fetch with the same URL building, for non-JSON responses. */
  url<K extends keyof Routes & string>(key: K, options?: ClientRequestInit): string;
}

function buildUrl(baseUrl: string, path: string, options?: ClientRequestInit): string {
  let p = path;
  for (const [k, v] of Object.entries(options?.params ?? {})) {
    p = p.replace(`:${k}`, encodeURIComponent(String(v)));
  }
  const qs = Object.entries(options?.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${baseUrl.replace(/\/$/, '')}${p}${qs ? `?${qs}` : ''}`;
}

/**
 * Create a typed fetch client from a generated route map.
 *
 * @example
 * // generated.ts (emitted by generateClientTypes)
 * export interface AppRoutes { 'GET /users': { output: ... }; }
 *
 * const api = createClient<AppRoutes>('http://localhost:3000');
 * const users = await api.request('GET /users');       // typed
 * const one = await api.request('GET /users/:id', { params: { id: '1' } });
 */
export function createClient<Routes = RouteMap>(baseUrl: string): ForgeClient<Routes> {
  const url = <K extends keyof Routes & string>(key: K, options?: ClientRequestInit): string => {
    const sp = key.indexOf(' ');
    const path = key.slice(sp + 1);
    return buildUrl(baseUrl, path, options);
  };

  return {
    url,
    async request<K extends keyof Routes & string>(key: K, options?: ClientRequestInit) {
      const method = key.slice(0, key.indexOf(' '));
      const res = await fetch(url(key, options), {
        method,
        headers: {
          ...(options?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options?.headers,
        },
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
        ...options?.init,
      });
      if (!res.ok) {
        throw new ClientRequestError(res.status, await res.text());
      }
      return (await res.json()) as RouteOutput<Routes, K>;
    },
  };
}

export class ClientRequestError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Client request failed: ${status}`);
    this.name = 'ClientRequestError';
  }
}

/* ================= CODEGEN ================= */

export interface GenerateClientTypesOptions {
  /** Controllers whose routes should appear in the map. */
  controllers: ControllerConstructor[];
  /** Module specifier the generated file imports controller types from. */
  importPath: string;
  /** Exported interface name — defaults to 'AppRoutes'. */
  exportName?: string;
}

/**
 * Emit a TypeScript module declaring a route map where each entry's `output`
 * is the controller method's `Awaited<ReturnType>` — full type inference
 * without re-deriving types at runtime.
 *
 * @example
 * const src = generateClientTypes({ controllers: [UserController], importPath: './controllers' });
 * await Bun.write('./generated/routes.ts', src);
 * // consumer: createClient<AppRoutes>(...)
 */
export function generateClientTypes(options: GenerateClientTypesOptions): string {
  const { controllers, importPath, exportName = 'AppRoutes' } = options;

  const imports: string[] = [];
  const entries: string[] = [];

  for (const ControllerClass of controllers) {
    const clsName = (ControllerClass as unknown as Function).name;
    imports.push(clsName);
    for (const route of HonoRouteBuilder.describe(ControllerClass)) {
      if (route.sse || route.websocket || route.method === 'all' || route.method === 'head') continue;
      const key = `${route.method.toUpperCase()} ${route.path}`;
      entries.push(
        `  '${key}': { output: Awaited<ReturnType<${clsName}['${route.handlerName}']>> };`
      );
    }
  }

  return [
    `// Generated by hono-forge generateClientTypes — do not edit.`,
    `import type { ${[...new Set(imports)].join(', ')} } from '${importPath}';`,
    ``,
    `export interface ${exportName} {`,
    ...entries,
    `}`,
    ``,
  ].join('\n');
}
