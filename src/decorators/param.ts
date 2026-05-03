import 'reflect-metadata';

import type {
  ZodType,
  ZodTypeDef,
} from 'zod';

import {
  METADATA_KEYS,
  ParamMetadata,
} from './metadata';

/* ================= TYPES ================= */

type ZodSchemaType =
  ZodType<unknown, ZodTypeDef, unknown>;

/* ================= FACTORY ================= */

function createParamDecorator(
  type: ParamMetadata['type']
) {
  return function (
    nameOrSchema?: string | ZodSchemaType,
    schema?: ZodSchemaType
  ): ParameterDecorator {
    return (
      target: object,
      propertyKey: string | symbol | undefined,
      parameterIndex: number
    ): void => {
      if (!propertyKey) return;

      const params =
        (Reflect.getMetadata(
          METADATA_KEYS.PARAMS,
          target,
          propertyKey
        ) as ParamMetadata[] | undefined) ?? [];

      let name: string | undefined;
      let validationSchema:
        | ZodSchemaType
        | undefined;

      if (typeof nameOrSchema === 'string') {
        name = nameOrSchema;
        validationSchema = schema;
      } else if (nameOrSchema) {
        validationSchema = nameOrSchema;
      }

      const metadata: ParamMetadata = {
        type,
        index: parameterIndex,
        name,
        schema: validationSchema,
      };

      params.push(metadata);

      Reflect.defineMetadata(
        METADATA_KEYS.PARAMS,
        params,
        target,
        propertyKey
      );
    };
  };
}

/* ================= BASIC DECORATORS ================= */

export const Body =
  createParamDecorator('body');

export const Param =
  createParamDecorator('param');

export const Query =
  createParamDecorator('query');

export const Headers =
  createParamDecorator('headers');

export const User =
  createParamDecorator('user');

export const Req =
  createParamDecorator('req');

export const Res =
  createParamDecorator('res');

export const Next =
  createParamDecorator('next');

/* ================= VALIDATED (INFERRED) ================= */

/**
 * Type-safe Body decorator with Zod inference
 */
export function ValidatedBody<
  T extends ZodSchemaType
>(schema: T): ParameterDecorator & {
  __type?: T['_output'];
} {
  return Body(schema) as ParameterDecorator & {
    __type?: T['_output'];
  };
}

/**
 * Type-safe Query decorator with Zod inference
 */
export function ValidatedQuery<
  T extends ZodSchemaType
>(schema: T): ParameterDecorator & {
  __type?: T['_output'];
} {
  return Query(schema) as ParameterDecorator & {
    __type?: T['_output'];
  };
}

/**
 * Type-safe Param decorator with Zod inference
 */
export function ValidatedParam<
  T extends ZodSchemaType
>(
  name: string,
  schema: T
): ParameterDecorator & {
  __type?: T['_output'];
} {
  return Param(
    name,
    schema
  ) as ParameterDecorator & {
    __type?: T['_output'];
  };
}
