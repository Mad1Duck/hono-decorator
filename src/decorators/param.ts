import 'reflect-metadata';

import type { ZodType } from 'zod';

import type { ParamMetadata } from './metadata';
import { METADATA_KEYS } from './metadata';

/* ================= TYPES ================= */

type ZodSchemaType = ZodType;

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

/** Injects the Hono Context `c` directly. Prefer this over `@Res()` for clarity. */
export const Ctx =
  createParamDecorator('ctx');

/**
 * @deprecated `@Next()` always returns `undefined` in Hono's request model.
 * Hono middleware uses `await next()` internally — there is no Express-style next callback.
 * Remove this decorator from your handlers.
 */
export const Next =
  createParamDecorator('next');

export const SseStream =
  createParamDecorator('sse');

/** Injects the real client IP (respects CF-Connecting-IP, X-Real-IP, X-Forwarded-For). */
export const Ip =
  createParamDecorator('ip');

/** Injects the detected device type: 'mobile' | 'tablet' | 'desktop' | 'bot'. */
export const Device =
  createParamDecorator('device');

/** Injects the raw User-Agent header string. */
export const UserAgent =
  createParamDecorator('useragent');

/** Injects a single cookie value by name. */
export function Cookie(name: string): ParameterDecorator {
  return createParamDecorator('cookie')(name);
}

/** Injects all cookies as a `Record<string, string>`. */
export function Cookies(): ParameterDecorator {
  return createParamDecorator('cookies')();
}

/* ================= FILE UPLOAD ================= */

/**
 * Injects a single uploaded file from multipart form data.
 *
 * @example
 * @Post('/avatar')
 * upload(@UploadedFile('avatar') file: File | null) {
 *   if (!file) return { error: 'no file' };
 *   return { name: file.name, size: file.size };
 * }
 */
export function UploadedFile(fieldName: string): ParameterDecorator {
  return createParamDecorator('uploadedfile')(fieldName);
}

/**
 * Injects all uploaded files from multipart form data.
 * Pass a fieldName to filter by field, or omit to get every file in the form.
 *
 * @example
 * @Post('/gallery')
 * upload(@UploadedFiles('images') files: File[]) {
 *   return files.map(f => ({ name: f.name, size: f.size }));
 * }
 */
export function UploadedFiles(fieldName?: string): ParameterDecorator {
  return createParamDecorator('uploadedfiles')(fieldName);
}

/**
 * Injects the raw FormData object from a multipart request.
 *
 * @example
 * @Post('/submit')
 * submit(@FormBody() form: FormData) {
 *   const name = form.get('name');
 *   return { name };
 * }
 */
export function FormBody(): ParameterDecorator {
  return createParamDecorator('formbody')();
}

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
