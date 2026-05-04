import type { ZodType, ZodObject, ZodRawShape } from 'zod';

/* ================= TYPES ================= */

// ZodTypeAny was removed in Zod v4; ZodType (no generics) serves as the base.
type ZodTypeAny = ZodType;

export interface TableSchemas<
  TSelect extends ZodTypeAny,
  TInsert extends ZodObject<ZodRawShape>,
  TUpdate extends ZodTypeAny = ZodType,
> {
  /** Full row schema — use for GET responses / @ApiResponse / @ValidateResult */
  select: TSelect;
  /** Insert schema — use for POST @Body validation */
  insert: TInsert;
  /** Update schema — use for PATCH @Body validation (partial by default) */
  update: TUpdate;
}

export interface DefineSchemasOptions<
  TInsert extends ZodObject<ZodRawShape>,
  TUpdate extends ZodTypeAny = ZodType,
> {
  /**
   * Custom update schema. Defaults to `insert.partial()`.
   * Use when PATCH has different rules than a partial POST
   * (e.g. email cannot be changed, or extra fields are allowed).
   *
   * @example
   * update: insertSchema.omit({ email: true }).partial()
   */
  update?: TUpdate;
}

/* ================= defineSchemas ================= */

/**
 * Creates a consistent `{ select, insert, update }` schema set from
 * a select schema and an insert schema.
 *
 * Works with any Zod-based source: drizzle-zod, zod-prisma, hand-written schemas, etc.
 *
 * @example With drizzle-zod
 * ```ts
 * import { pgTable, serial, varchar, text } from 'drizzle-orm/pg-core';
 * import { createSelectSchema, createInsertSchema } from 'drizzle-zod';
 * import { defineSchemas } from 'hono-forge';
 *
 * const users = pgTable('users', {
 *   id:    serial('id').primaryKey(),
 *   name:  varchar('name', { length: 255 }).notNull(),
 *   email: text('email').notNull(),
 * });
 *
 * export const UserSchemas = defineSchemas(
 *   createSelectSchema(users),
 *   createInsertSchema(users),
 * );
 * ```
 *
 * @example Custom update schema (email cannot be changed)
 * ```ts
 * const insert = z.object({ name: z.string(), email: z.string().email() });
 *
 * export const UserSchemas = defineSchemas(
 *   z.object({ id: z.number(), name: z.string(), email: z.string() }),
 *   insert,
 *   { update: insert.omit({ email: true }).partial() },
 * );
 * ```
 *
 * @example Hand-written schemas (no ORM)
 * ```ts
 * export const PostSchemas = defineSchemas(
 *   z.object({ id: z.number(), title: z.string(), content: z.string() }),
 *   z.object({ title: z.string().min(1), content: z.string().min(1) }),
 * );
 * ```
 */
export function defineSchemas<
  TSelect extends ZodTypeAny,
  TInsert extends ZodObject<ZodRawShape>,
  TUpdate extends ZodTypeAny = ZodType,
>(
  select: TSelect,
  insert: TInsert,
  options?: DefineSchemasOptions<TInsert, TUpdate>
): TableSchemas<TSelect, TInsert, TUpdate> {
  return {
    select,
    insert,
    update: (options?.update ?? insert.partial()) as TUpdate,
  };
}
