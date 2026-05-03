import 'reflect-metadata';

import {
  METADATA_KEYS,
  ControllerMetadata,
  RouteMetadata,
} from './metadata';

/* ================= TYPES ================= */

type ClassConstructor = new (...args: unknown[]) => unknown;

/* ================= CONTROLLER ================= */

export function Controller(
  basePath = '',
  options?: {
    platform?: 'mobile' | 'web';
    version?: string;
  }
): ClassDecorator {
  return (target): void => {
    const platform = options?.platform;
    const version = options?.version ?? 'v1';

    const fullPath = platform
      ? `${platform}/${version}${basePath}`
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
