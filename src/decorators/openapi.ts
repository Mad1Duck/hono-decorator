import type { ZodType } from 'zod';
import { METADATA_KEYS } from './metadata';
import type { OpenAPIMetadata } from './metadata';

type MethodDec = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassOrMethodDec = (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void;

function getMethodOpenApi(context: ClassMethodDecoratorContext, name: string): OpenAPIMetadata {
  const all = (context.metadata[METADATA_KEYS.OPENAPI] as Record<string, OpenAPIMetadata> | undefined) ?? {};
  return all[name] ?? {};
}

function setMethodOpenApi(context: ClassMethodDecoratorContext, name: string, meta: OpenAPIMetadata): void {
  const all = (context.metadata[METADATA_KEYS.OPENAPI] as Record<string, OpenAPIMetadata> | undefined) ?? {};
  all[name] = meta;
  context.metadata[METADATA_KEYS.OPENAPI] = all;
}

/* ================= API DOC ================= */

export function ApiDoc(metadata: OpenAPIMetadata): MethodDec {
  return (_value, context) => {
    const name = String(context.name);
    const existing = getMethodOpenApi(context, name);
    setMethodOpenApi(context, name, { ...existing, ...metadata });
  };
}

/* ================= API RESPONSE ================= */

export function ApiResponse(statusCode: number, description: string, schema?: ZodType): MethodDec {
  return (_value, context) => {
    const name = String(context.name);
    const existing = getMethodOpenApi(context, name);
    setMethodOpenApi(context, name, {
      ...existing,
      responses: { ...(existing.responses ?? {}), [statusCode]: { description, schema } },
    });
  };
}

/* ================= API BODY ================= */

/**
 * Document the JSON request body. `required` defaults to whether the schema
 * rejects `undefined` — schemas with `.optional()`/`.default()` are optional.
 */
export function ApiBody(
  schema: ZodType,
  options?: { required?: boolean; description?: string; }
): MethodDec {
  return (_value, context) => {
    const name = String(context.name);
    const existing = getMethodOpenApi(context, name);
    setMethodOpenApi(context, name, { ...existing, body: { schema, ...options } });
  };
}

/* ================= API QUERY ================= */

/** Document a query parameter. `required` is auto-inferred like @ApiBody. */
export function ApiQuery(
  name: string,
  schema: ZodType,
  options?: { required?: boolean; description?: string; }
): MethodDec {
  return (_value, context) => {
    const methodName = String(context.name);
    const existing = getMethodOpenApi(context, methodName);
    setMethodOpenApi(context, methodName, {
      ...existing,
      query: { ...(existing.query ?? {}), [name]: { schema, ...options } },
    });
  };
}

/* ================= API DEPRECATED ================= */

/**
 * Mark the route deprecated in the OpenAPI spec AND emit `Deprecation: true`
 * (RFC 9745) on every response. Pass `sunset` (ISO date string or Date) to
 * also emit a `Sunset` header.
 */
export function ApiDeprecated(sunset?: string | Date): MethodDec {
  return (_value, context) => {
    const name = String(context.name);
    const sunsetDate = sunset instanceof Date ? sunset.toUTCString() : sunset;
    setMethodOpenApi(context, name, {
      ...getMethodOpenApi(context, name),
      deprecated: sunsetDate ? { sunset: sunsetDate } : true,
    });
  };
}

/* ================= API TAGS ================= */

export function ApiTags(...tags: string[]): ClassOrMethodDec {
  return (_value, context) => {
    if (context.kind === 'class') {
      const existing = (context.metadata[METADATA_KEYS.CLASS_OPENAPI] as OpenAPIMetadata | undefined) ?? {};
      context.metadata[METADATA_KEYS.CLASS_OPENAPI] = { ...existing, tags: [...(existing.tags ?? []), ...tags] };
    } else {
      const name = String(context.name);
      const existing = getMethodOpenApi(context as ClassMethodDecoratorContext, name);
      setMethodOpenApi(context as ClassMethodDecoratorContext, name, {
        ...existing,
        tags: [...(existing.tags ?? []), ...tags],
      });
    }
  };
}
