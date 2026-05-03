import 'reflect-metadata';
import type { ZodType, ZodTypeDef } from 'zod';

import {
  METADATA_KEYS,
  OpenAPIMetadata,
} from './metadata';


/* ================= API DOC ================= */

export function ApiDoc(
  metadata: OpenAPIMetadata
): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata(
      METADATA_KEYS.OPENAPI,
      metadata,
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= API RESPONSE ================= */

export function ApiResponse(
  statusCode: number,
  description: string,
  schema?: ZodType<unknown, ZodTypeDef, unknown>
): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const existing =
      (Reflect.getMetadata(
        METADATA_KEYS.OPENAPI,
        target,
        propertyKey
      ) as OpenAPIMetadata | undefined) ??
      {};

    const updated: OpenAPIMetadata = {
      ...existing,
      responses: {
        ...(existing.responses ?? {}),
        [statusCode]: {
          description,
          schema: schema ?? undefined,
        },
      },
    };

    Reflect.defineMetadata(
      METADATA_KEYS.OPENAPI,
      updated,
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= API DEPRECATED ================= */

export function ApiDeprecated(): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    const existing =
      (Reflect.getMetadata(
        METADATA_KEYS.OPENAPI,
        target,
        propertyKey
      ) as OpenAPIMetadata | undefined) ??
      {};

    const updated: OpenAPIMetadata = {
      ...existing,
      deprecated: true,
    };

    Reflect.defineMetadata(
      METADATA_KEYS.OPENAPI,
      updated,
      target,
      propertyKey
    );

    return descriptor;
  };
}

/* ================= API TAGS ================= */

export function ApiTags(
  ...tags: string[]
): MethodDecorator & ClassDecorator {
  return (
    target: object,
    propertyKey?: string | symbol
  ): void => {
    if (propertyKey !== undefined) {
      // ===== METHOD DECORATOR =====

      const existing =
        (Reflect.getMetadata(
          METADATA_KEYS.OPENAPI,
          target,
          propertyKey
        ) as OpenAPIMetadata | undefined) ??
        {};

      const updated: OpenAPIMetadata = {
        ...existing,
        tags: [
          ...(existing.tags ?? []),
          ...tags,
        ],
      };

      Reflect.defineMetadata(
        METADATA_KEYS.OPENAPI,
        updated,
        target,
        propertyKey
      );

      return;
    }

    // ===== CLASS DECORATOR =====

    const existing =
      (Reflect.getMetadata(
        METADATA_KEYS.OPENAPI,
        target
      ) as OpenAPIMetadata | undefined) ??
      {};

    const updated: OpenAPIMetadata = {
      ...existing,
      tags,
    };

    Reflect.defineMetadata(
      METADATA_KEYS.OPENAPI,
      updated,
      target
    );
  };
}

