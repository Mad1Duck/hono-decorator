import 'reflect-metadata';

import { METADATA_KEYS } from './metadata';
import type { ControllerMetadata, RouteMetadata } from './metadata';
import type { HonoForgeController } from '../core/types';

/* ================= TYPES ================= */

type ClassConstructor = new (...args: unknown[]) => unknown;

/* ================= CONTROLLER ================= */

export function Controller(
  basePath = '',
  options?: {
    platform?: 'mobile' | 'web';
    version?: string;
  }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): <T extends abstract new (...args: any[]) => unknown>(target: T) => T & HonoForgeController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends abstract new (...args: any[]) => unknown>(target: T): T & HonoForgeController => {
    const platform = options?.platform;
    const version = options?.version ?? 'v1';

    const fullPath = platform
      ? `/${platform}/${version}${basePath}`
      : basePath;

    const metadata: ControllerMetadata = {
      basePath: fullPath,
      platform,
      routes: [],
    };

    Reflect.defineMetadata(
      METADATA_KEYS.CONTROLLER,
      metadata,
      target
    );

    return target as T & HonoForgeController;
  };
}

/* ================= ROUTE FACTORY ================= */

function createRouteDecorator(
  method: RouteMetadata['method']
) {
  return function (
    path = '',
    options?: {
      platform?: 'mobile' | 'web' | 'all';
      isPrivate?: boolean;
    }
  ): MethodDecorator {
    return <T>(
      target: object,
      propertyKey: string | symbol,
      descriptor: TypedPropertyDescriptor<T>
    ) => {
      const ctor = target.constructor as ClassConstructor;

      const routes =
        (Reflect.getMetadata(
          METADATA_KEYS.ROUTES,
          ctor
        ) as RouteMetadata[] | undefined) ?? [];

      const route: RouteMetadata = {
        method,
        path,
        handlerName: propertyKey.toString(),
        platform: options?.platform ?? 'all',
        isPrivate: options?.isPrivate ?? false,
      };

      routes.push(route);

      Reflect.defineMetadata(
        METADATA_KEYS.ROUTES,
        routes,
        ctor
      );

      return descriptor;
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
