import { METADATA_KEYS } from './metadata';
import type { ControllerMetadata, RouteMetadata } from './metadata';
import type { HonoForgeController } from '../core/types';

/* ================= CONTROLLER ================= */

export function Controller(
  basePath = '',
  options?: { platform?: 'mobile' | 'web'; version?: string; }
): (value: Function, context: ClassDecoratorContext) => void {
  return (_value, context) => {
    const platform = options?.platform;
    // Version prefix: explicit `version` always applies ('v2' or '/v2' → '/v2').
    // Platform routes default to v1 for backwards compatibility; plain
    // controllers only get a version prefix when one is given explicitly.
    const version = options?.version ?? (platform ? 'v1' : undefined);
    const versionPrefix = version ? `/${version.replace(/^\/+|\/+$/g, '')}` : '';
    const fullPath = platform ? `/${platform}${versionPrefix}${basePath}` : `${versionPrefix}${basePath}`;

    const metadata: ControllerMetadata = {
      basePath: fullPath,
      platform,
      routes: [],
    };

    context.metadata[METADATA_KEYS.CONTROLLER] = metadata;
  };
}

/* ================= ROUTE FACTORY ================= */

function createRouteDecorator(method: RouteMetadata['method']) {
  return function (
    path = '',
    options?: { platform?: 'mobile' | 'web' | 'all'; isPrivate?: boolean; }
  ): (value: Function, context: ClassMethodDecoratorContext) => void {
    return (_value, context) => {
      const routes = (context.metadata[METADATA_KEYS.ROUTES] as RouteMetadata[] | undefined) ?? [];

      routes.push({
        method,
        path,
        handlerName: String(context.name),
        platform: options?.platform ?? 'all',
        isPrivate: options?.isPrivate ?? false,
      });

      context.metadata[METADATA_KEYS.ROUTES] = routes;
    };
  };
}

/* ================= HTTP ================= */

export const Get = createRouteDecorator('get');
export const Post = createRouteDecorator('post');
export const Put = createRouteDecorator('put');
export const Patch = createRouteDecorator('patch');
export const Delete = createRouteDecorator('delete');
export const Head = createRouteDecorator('head');
export const Options = createRouteDecorator('options');
export const All = createRouteDecorator('all');

// Re-export branded type helper (used by ControllerConstructor)
export type { HonoForgeController };
