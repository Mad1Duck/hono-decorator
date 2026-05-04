import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/* ================= TYPES ================= */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/* ================= QUERY SCHEMA ================= */

/**
 * Zod schema for standard pagination query params.
 * Use with @Query() or @ValidatedQuery() to validate incoming page/limit.
 *
 * @example
 * @Get()
 * list(@ValidatedQuery(PaginationQuerySchema) q: PaginationQuery) {
 *   const { page, limit } = q;
 *   const [data, total] = await this.repo.findAndCount({ limit, offset: (page - 1) * limit });
 *   return paginate(data, total, q);
 * }
 */
export const PaginationQuerySchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/* ================= paginate ================= */

/**
 * Wraps a data array and total count into a standard paginated response.
 *
 * @example
 * const [data, total] = await db.select().from(users) ...;
 * return paginate(data, total, { page: 1, limit: 20 });
 *
 * // Returns:
 * // {
 * //   data: [...],
 * //   meta: { page: 1, limit: 20, total: 95, totalPages: 5, hasNext: true, hasPrev: false }
 * // }
 */
export function paginate<T>(
  data: T[],
  total: number,
  { page, limit }: { page: number; limit: number }
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/* ================= paginatedSchema ================= */

/**
 * Wraps an item schema into a paginated response schema.
 * Use with @ApiResponse or @ValidateResult.
 *
 * @example
 * const UserListSchema = paginatedSchema(UserSchemas.select);
 *
 * @Get()
 * @ApiResponse(200, { schema: UserListSchema })
 * @ValidateResult(UserListSchema)
 * async list(@ValidatedQuery(PaginationQuerySchema) q: PaginationQuery) { ... }
 */
export function paginatedSchema<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: z.object({
      page:       z.number().int(),
      limit:      z.number().int(),
      total:      z.number().int(),
      totalPages: z.number().int(),
      hasNext:    z.boolean(),
      hasPrev:    z.boolean(),
    }),
  });
}
