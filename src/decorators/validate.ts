import type { ZodType } from 'zod';
import { METADATA_KEYS } from './metadata';
import type { OpenAPIMetadata, ValidationMetadata } from './metadata';

/**
 * One source of truth for request validation AND OpenAPI documentation.
 *
 * Declare the schemas once — the route builder validates body/query/params
 * before your handler runs (400 VALIDATION_ERROR on failure) and the same
 * schemas are emitted into the generated OpenAPI spec. Inside the handler,
 * `Body(c)`, `Query(c)`, and `Params(c)` return the already-validated,
 * correctly-typed values — no second parse, no duplicate declaration.
 *
 * @ApiBody / @ApiQuery remain available for adding descriptions/overrides;
 * their extra fields (description, required) merge over the schemas set here.
 *
 * @example
 * const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });
 *
 * @Post()
 * @Validate({ body: CreateUserSchema })
 * async create(c: Context) {
 *   const body = await Body<z.infer<typeof CreateUserSchema>>(c); // validated
 *   return this.svc.create(body);
 * }
 *
 * @example
 * @Get('/:id')
 * @Validate({
 *   params: z.object({ id: z.string().uuid() }),
 *   query:  z.object({ verbose: z.coerce.boolean().default(false) }),
 * })
 * async getOne(c: Context) {
 *   const { id }      = Params<{ id: string }>(c);
 *   const { verbose } = Query<{ verbose: boolean }>(c);
 *   return this.svc.find(id, verbose);
 * }
 */
export function Validate(schemas: ValidationMetadata): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const name = String(context.name);

    /* --- Runtime validation metadata --- */
    const all = (context.metadata[METADATA_KEYS.VALIDATION] as Record<string, ValidationMetadata> | undefined) ?? {};
    all[name] = schemas;
    context.metadata[METADATA_KEYS.VALIDATION] = all;

    /* --- OpenAPI metadata — the validator IS the spec --- */
    const openapi = (context.metadata[METADATA_KEYS.OPENAPI] as Record<string, OpenAPIMetadata> | undefined) ?? {};
    const existing = openapi[name] ?? {};
    const next: OpenAPIMetadata = { ...existing };

    if (schemas.body) {
      next.body = { schema: schemas.body, ...(existing.body ?? {}) };
    }

    const queryShape = shapeOf(schemas.query);
    if (queryShape) {
      const merged = { ...(existing.query ?? {}) };
      for (const [key, field] of Object.entries(queryShape)) {
        merged[key] = { schema: field, ...(merged[key] ?? {}) };
      }
      next.query = merged;
    }

    const paramShape = shapeOf(schemas.params);
    if (paramShape) {
      const merged = { ...(existing.params ?? {}) };
      for (const [key, field] of Object.entries(paramShape)) {
        merged[key] = { schema: field, ...(merged[key] ?? {}) };
      }
      next.params = merged;
    }

    openapi[name] = next;
    context.metadata[METADATA_KEYS.OPENAPI] = openapi;
  };
}

/** Extract the per-key shape from a ZodObject schema (undefined for non-objects). */
function shapeOf(schema: ZodType | undefined): Record<string, ZodType> | undefined {
  if (!schema) return undefined;
  return (schema as unknown as { shape?: Record<string, ZodType> }).shape;
}
