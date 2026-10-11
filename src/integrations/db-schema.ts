/**
 * DB schema introspection — reflect Drizzle ORM table exports into a
 * portable `.schema.yaml` document that api-tester can import for its
 * Postgres nodes (table/column catalog, FK graph).
 *
 * hono-forge stays dependency-free: `drizzle-orm` is resolved lazily from the
 * *consumer's* project via `createRequire`, and table detection falls back to
 * Drizzle's `Symbol.for('drizzle:IsDrizzleTable')` brand when the package
 * can't be loaded — so duplicated or hoisted installs still work.
 *
 * @example
 * // bunx hono-forge schema ./src/db/schema.ts --out ./db.schema.yaml
 * import { extractDbSchema, writeDbSchema } from 'hono-forge';
 * import * as schema from './src/db/schema';
 *
 * await writeDbSchema('./db.schema.yaml', extractDbSchema(schema));
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { yamlStringify } from '../utils/yaml';

export const DB_SCHEMA_KIND = 'hono-forge/db-schema';

export interface DbSchemaColumn {
  name: string;
  /** Portable-ish type family: string | number | boolean | date | json | bigint | buffer | custom. */
  dataType: string;
  /** Vendor column type, e.g. 'PgVarchar', 'SQLiteInteger' — useful for display/debug. */
  columnType: string;
  notNull: boolean;
  primary?: boolean;
  hasDefault?: boolean;
  enumValues?: string[];
}

export interface DbSchemaForeignKey {
  /** Local column names. */
  columns: string[];
  /** Referenced table's DB name. */
  referencesTable: string;
  /** Referenced column names. */
  referencesColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface DbSchemaTable {
  /** DB table name, e.g. 'users'. */
  name: string;
  /** Export name in the entry module, e.g. 'users' in `export const users = pgTable(...)`. */
  export: string;
  /** Database schema (Postgres `pgSchema`, etc.) when set. */
  schema?: string;
  columns: DbSchemaColumn[];
  /** Composite primary key column names, when the PK spans >1 column. */
  primaryKey?: string[];
  foreignKeys?: DbSchemaForeignKey[];
}

export interface DbSchemaFile {
  version: 1;
  kind: typeof DB_SCHEMA_KIND;
  generatedAt: string;
  /** Detected from the table class: 'pg' | 'mysql' | 'sqlite'. */
  dialect?: 'pg' | 'mysql' | 'sqlite';
  tables: DbSchemaTable[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<PropertyKey, any>;

interface TableConfigLike {
  name: string;
  schema?: string;
  columns: AnyRecord[];
  primaryKeys?: { columns: AnyRecord[] }[];
  foreignKeys?: AnyRecord[];
}

interface DrizzleModule {
  isTable?: (v: unknown) => boolean;
  getTableConfig?: (t: unknown) => TableConfigLike;
}

const DRIZZLE_TABLE_BRAND = Symbol.for('drizzle:IsDrizzleTable');

function looksLikeTable(v: unknown, isTable?: DrizzleModule['isTable']): boolean {
  if (!v || typeof v !== 'object' && typeof v !== 'function') return false;
  if (isTable) {
    try {
      if (isTable(v)) return true;
    } catch {
      /* fall through to brand check */
    }
  }
  return (v as AnyRecord)[DRIZZLE_TABLE_BRAND] === true;
}

function detectDialect(table: unknown, cfg?: TableConfigLike): DbSchemaFile['dialect'] {
  const ctor = (table as AnyRecord)?.constructor?.name as string | undefined;
  if (ctor?.startsWith('Pg')) return 'pg';
  if (ctor?.startsWith('MySql')) return 'mysql';
  if (ctor?.startsWith('SQLite')) return 'sqlite';
  const colType = cfg?.columns?.[0]?.columnType as string | undefined;
  if (colType?.startsWith('Pg')) return 'pg';
  if (colType?.startsWith('MySql')) return 'mysql';
  if (colType?.startsWith('SQLite')) return 'sqlite';
  return undefined;
}

function columnToSchema(c: AnyRecord): DbSchemaColumn {
  return {
    name: String(c.name),
    dataType: String(c.dataType ?? 'custom'),
    columnType: String(c.columnType ?? 'unknown'),
    notNull: c.notNull === true,
    primary: c.primary === true ? true : undefined,
    hasDefault: c.hasDefault === true ? true : undefined,
    enumValues: Array.isArray(c.enumValues) && c.enumValues.length
      ? c.enumValues.map(String)
      : undefined,
  };
}

function foreignKeyToSchema(
  fk: AnyRecord,
  getTableConfig?: DrizzleModule['getTableConfig'],
): DbSchemaForeignKey | undefined {
  try {
    const ref = typeof fk.reference === 'function' ? fk.reference() : fk;
    const localCols: AnyRecord[] = ref?.columns ?? ref?.localColumns ?? [];
    const foreignCols: AnyRecord[] = ref?.foreignColumns ?? [];
    const foreignTable = ref?.foreignTable;
    const foreignTableName: string | undefined =
      (foreignTable && getTableConfig?.(foreignTable)?.name) ??
      foreignTable?.[Symbol.for('drizzle:OriginalName')] ??
      foreignTable?.[Symbol.for('drizzle:Name')];
    if (!foreignTableName) return undefined;
    return {
      columns: localCols.map((c) => String(c?.name ?? c)),
      referencesTable: String(foreignTableName),
      referencesColumns: foreignCols.map((c) => String(c?.name ?? c)),
      onDelete: typeof fk.onDelete === 'string' ? fk.onDelete : undefined,
      onUpdate: typeof fk.onUpdate === 'string' ? fk.onUpdate : undefined,
    };
  } catch {
    return undefined;
  }
}

const DRIZZLE_ENTRY_POINTS = [
  'drizzle-orm',
  'drizzle-orm/pg-core',
  'drizzle-orm/mysql-core',
  'drizzle-orm/sqlite-core',
];

/**
 * Load `drizzle-orm` from the project that owns `entryFile` so `getTableConfig`
 * matches the exact Drizzle version that built the tables. The helpers live in
 * different places across versions (root in newer releases, dialect subpaths
 * in older ones), so every entry point is tried and the first hit wins.
 * Returns undefined pieces when the package isn't resolvable — callers fall
 * back to brand checks.
 */
function loadDrizzle(entryFile?: string): DrizzleModule {
  if (!entryFile) return {};
  let req: NodeJS.Require;
  try {
    req = createRequire(entryFile);
  } catch {
    return {};
  }
  const out: DrizzleModule = {};
  for (const spec of DRIZZLE_ENTRY_POINTS) {
    try {
      const d = req(spec) as AnyRecord;
      out.isTable ??= d.isTable;
      out.getTableConfig ??=
        d.getTableConfig ??
        d.getPgTableConfig ??
        d.getMySqlTableConfig ??
        d.getSQLiteTableConfig;
      if (out.isTable && out.getTableConfig) break;
    } catch {
      /* entry point not exported/installed in this version */
    }
  }
  return out;
}

/**
 * Scan a module's exports for Drizzle table objects and reflect them into a
 * `DbSchemaFile`. `entryFile` should be the absolute path the module was
 * imported from — it's used to resolve the project's own `drizzle-orm`.
 */
export function extractDbSchema(
  mod: Record<string, unknown>,
  options: { entryFile?: string } = {},
): DbSchemaFile {
  const { isTable, getTableConfig } = loadDrizzle(options.entryFile);
  const tables: DbSchemaTable[] = [];
  const dialects = new Set<NonNullable<DbSchemaFile['dialect']>>();

  for (const [exportName, value] of Object.entries(mod)) {
    if (!looksLikeTable(value, isTable)) continue;

    let cfg: TableConfigLike | undefined;
    if (getTableConfig) {
      try {
        cfg = getTableConfig(value);
      } catch {
        cfg = undefined;
      }
    }

    const v = value as AnyRecord;
    const name =
      cfg?.name ??
      (v[Symbol.for('drizzle:OriginalName')] as string | undefined) ??
      (v[Symbol.for('drizzle:Name')] as string | undefined) ??
      exportName;

    let columns: AnyRecord[] = cfg?.columns ?? [];
    if (!columns.length) {
      const colMap = v[Symbol.for('drizzle:Columns')] as Record<string, AnyRecord> | undefined;
      if (colMap) columns = Object.values(colMap);
    }

    const compositePk = (cfg?.primaryKeys ?? [])
      .flatMap((pk) => pk.columns ?? [])
      .map((c) => String(c?.name ?? c));

    const foreignKeys = (cfg?.foreignKeys ?? [])
      .map((fk) => foreignKeyToSchema(fk, getTableConfig))
      .filter((fk): fk is DbSchemaForeignKey => fk !== undefined);

    const dialect = detectDialect(value, cfg);
    if (dialect) dialects.add(dialect);

    tables.push({
      name,
      export: exportName,
      schema: cfg?.schema ?? (v[Symbol.for('drizzle:Schema')] as string | undefined),
      columns: columns.map(columnToSchema),
      primaryKey: compositePk.length > 1 ? compositePk : undefined,
      foreignKeys: foreignKeys.length ? foreignKeys : undefined,
    });
  }

  return {
    version: 1,
    kind: DB_SCHEMA_KIND,
    generatedAt: new Date().toISOString(),
    dialect: dialects.size === 1 ? [...dialects][0] : undefined,
    tables,
  };
}

/** Serialize a `DbSchemaFile` to the `.schema.yaml` document api-tester imports. */
export function stringifyDbSchema(schema: DbSchemaFile): string {
  return yamlStringify(schema);
}

/** Write a `DbSchemaFile` to `file` (parent dirs created). Returns the path written. */
export async function writeDbSchema(file: string, schema: DbSchemaFile): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, stringifyDbSchema(schema), 'utf8');
  return file;
}
