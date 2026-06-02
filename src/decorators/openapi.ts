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

/* ================= API DEPRECATED ================= */

export function ApiDeprecated(): MethodDec {
  return (_value, context) => {
    const name = String(context.name);
    setMethodOpenApi(context, name, { ...getMethodOpenApi(context, name), deprecated: true });
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
