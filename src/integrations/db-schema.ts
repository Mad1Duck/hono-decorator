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
import { dirname, join } from 'node:path';
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
  /** 'pg' | 'mysql' | 'sqlite' from Drizzle; provider name from Prisma/live sources. */
  dialect?: string;
  /** Provenance label, e.g. 'pg:public' (live introspection) or 'prisma'. */
  source?: string;
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

// ── Generic schema docs (--from file) ─────────────────────────────────────
// Accepts the canonical doc plus friendlier hand-written shapes:
//   tables: { users: { columns: { id: "uuid", email: { type: text, pk: true } } } }
// Column aliases: type|dataType, nullable↔notNull, primary|primaryKey|pk,
// default|hasDefault, enum|enumValues. Table aliases: pk|primaryKey,
// ref|references|foreignKeys.

function columnFromAny(name: string, raw: unknown): DbSchemaColumn {
  const r: AnyRecord = typeof raw === 'string' ? { type: raw } : (raw as AnyRecord) ?? {};
  const dataType = String(r.dataType ?? r.type ?? r.columnType ?? 'custom');
  const notNull =
    typeof r.notNull === 'boolean' ? r.notNull :
    typeof r.nullable === 'boolean' ? !r.nullable : false;
  const enums = (r.enumValues ?? r.enum) as unknown;
  return {
    name,
    dataType,
    columnType: String(r.columnType ?? dataType),
    notNull,
    primary: Boolean(r.primary ?? r.primaryKey ?? r.pk) || undefined,
    hasDefault: Boolean(r.hasDefault ?? r.default !== undefined) || undefined,
    enumValues: Array.isArray(enums) ? enums.map(String) : undefined,
  };
}

function columnsFromAny(raw: unknown): DbSchemaColumn[] {
  if (Array.isArray(raw)) {
    return raw
      .map((c) => (typeof c === 'object' && c !== null ? columnFromAny(String((c as AnyRecord).name ?? ''), c) : undefined))
      .filter((c): c is DbSchemaColumn => Boolean(c?.name));
  }
  return Object.entries((raw as Record<string, unknown>) ?? {}).map(([n, c]) => columnFromAny(n, c));
}

function fkFromAny(tableName: string, raw: unknown): DbSchemaForeignKey | undefined {
  const r = raw as AnyRecord;
  if (!r) return undefined;
  const ref = r.references as AnyRecord | string | undefined;
  // { references: 'users.id' } | { references: { table, columns } } | { referencesTable, referencesColumns }
  let table = r.referencesTable;
  let cols = r.referencesColumns;
  if (typeof ref === 'string') {
    const [t, c] = ref.split('.');
    table ??= t;
    cols ??= c ? [c] : undefined;
  } else if (ref) {
    table ??= ref.table ?? ref.referencesTable;
    cols ??= ref.columns ?? ref.referencesColumns;
  }
  const local = r.columns;
  if (!table) return undefined;
  return {
    columns: (Array.isArray(local) ? local : local ? [local] : []).map(String),
    referencesTable: String(table),
    referencesColumns: (Array.isArray(cols) ? cols : cols ? [cols] : []).map(String),
    onDelete: r.onDelete as string | undefined,
    onUpdate: r.onUpdate as string | undefined,
  };
}

/**
 * Normalize a parsed `.schema.yaml`/`.json` document into the canonical
 * `DbSchemaFile` — tolerant of hand-written shorthand (see aliases above).
 * Throws on docs with no usable tables.
 */
export function normalizeDbSchemaDoc(doc: unknown): DbSchemaFile {
  const d = doc as AnyRecord;
  const rawTables = d?.tables;
  const tables: DbSchemaTable[] = Array.isArray(rawTables)
    ? rawTables.map((t) => tableFromAny(t))
    : Object.entries((rawTables as Record<string, unknown>) ?? {}).map(([name, t]) =>
        tableFromAny({ ...(t as object), name }));

  function tableFromAny(t: unknown): DbSchemaTable {
    const r = (t as AnyRecord) ?? {};
    const name = String(r.name ?? '');
    const columns = columnsFromAny(r.columns);
    const pk = (r.primaryKey ?? r.pk) as unknown;
    const rawFks = r.foreignKeys ?? r.references ?? r.ref;
    const foreignKeys = Array.isArray(rawFks)
      ? rawFks.map((f) => fkFromAny(name, f)).filter((f): f is DbSchemaForeignKey => f !== undefined)
      : Object.entries((rawFks as Record<string, unknown>) ?? {})
          .map(([col, f]) => fkFromAny(name, { ...(f as object), columns: (f as AnyRecord)?.columns ?? [col] }))
          .filter((f): f is DbSchemaForeignKey => f !== undefined);
    return {
      name,
      export: String(r.export ?? name),
      schema: r.schema as string | undefined,
      columns,
      primaryKey: Array.isArray(pk) && pk.length > 1 ? pk.map(String)
        : columns.filter((c) => c.primary).length > 1
          ? columns.filter((c) => c.primary).map((c) => c.name)
          : undefined,
      foreignKeys: foreignKeys.length ? foreignKeys : undefined,
    };
  }

  const usable = tables.filter((t) => t.name && t.columns.length);
  if (!usable.length) {
    throw new Error('No tables found — expected `tables:` as a map or array with `columns` per table');
  }
  return {
    version: 1,
    kind: DB_SCHEMA_KIND,
    generatedAt: typeof d?.generatedAt === 'string' ? d.generatedAt : new Date().toISOString(),
    dialect: (d?.dialect as DbSchemaFile['dialect']) ?? undefined,
    tables: usable,
  };
}

/**
 * Read a `.schema.yaml` / `.schema.json` / generic schema doc from disk.
 * `.json` parses natively; `.yaml`/`.yml` uses the project's `yaml` package
 * (lazy `createRequire`, same trick as Drizzle) — hono-forge stays dep-free.
 */
export async function readDbSchemaDoc(file: string): Promise<unknown> {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(file, 'utf8');
  if (/\.json$/i.test(file)) return JSON.parse(text);
  try {
    const req = createRequire(file);
    const { parse } = req('yaml') as { parse: (t: string) => unknown };
    return parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
    throw new Error(
      `Parsing '${file}' needs the 'yaml' package in this project (bun add yaml) — or pass a .json schema file`,
    );
  }
}

// ── Prisma schema files (--from prisma) ────────────────────────────────────

const PRISMA_TYPE_MAP: Record<string, string> = {
  String: 'string', Int: 'number', BigInt: 'bigint', Float: 'number', Decimal: 'number',
  Boolean: 'boolean', DateTime: 'date', Json: 'json', Bytes: 'buffer',
};

const PRISMA_PROVIDER_DIALECT: Record<string, DbSchemaFile['dialect']> = {
  postgresql: 'pg', mysql: 'mysql', sqlite: 'sqlite', sqlserver: 'custom', mongodb: 'mongo',
};

/**
 * Parse a Prisma `schema.prisma` file into a `DbSchemaFile`. Covers the common
 * subset — models, scalar/enum fields, `@id`, `@@id`, `@map`, `@@map`, and
 * `fields:`/`references:` relations. Not a full Prisma parser: exotic blocks
 * are ignored rather than mis-parsed.
 */
export function parsePrismaSchema(text: string): DbSchemaFile {
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/[^\n]*$/g, '')).join('\n');

  const blocks = new Map<string, { kind: string; body: string }[]>();
  for (const m of clean.matchAll(/(model|enum|datasource)\s+(\w+)\s*\{([\s\S]*?)\}/g)) {
    const [, kind, name, body] = m;
    const list = blocks.get(kind!) ?? [];
    list.push({ kind: name!, body: body! });
    blocks.set(kind!, list);
  }

  const enums = new Map<string, string[]>();
  for (const e of blocks.get('enum') ?? []) {
    const values = e.body
      .split('\n').flatMap((l) => l.trim().split(/\s*,?\s+/))
      .map((w) => w.replace(/@.*$/, '').trim())
      .filter((w) => /^\w+$/.test(w));
    enums.set(e.kind, values);
  }

  let dialect: DbSchemaFile['dialect'];
  const provider = (blocks.get('datasource')?.[0]?.body ?? '').match(/provider\s*=\s*"(\w+)"/)?.[1];
  if (provider) dialect = PRISMA_PROVIDER_DIALECT[provider];

  const tables: DbSchemaTable[] = [];
  // Pass 1 — models, columns, composite PKs. FKs resolved in pass 2 once every
  // model's field→column map exists (references may point at @map'ed columns).
  interface ParsedModel {
    modelName: string; tableName: string; body: string;
    fieldToColumn: Map<string, string>; compositePk?: string[];
    columns: DbSchemaColumn[]; relations: { fields: string[]; references: string[]; target: string; onDelete?: string; onUpdate?: string }[];
  }
  const models: ParsedModel[] = [];

  for (const { kind: modelName, body } of blocks.get('model') ?? []) {
    const mapped = body.match(/@@map\(\s*"([^"]+)"\s*\)/)?.[1];
    const tableName = mapped ?? modelName;
    const compositeRaw = body.match(/@@id\(\s*\[([^\]]+)\]\s*\)/)?.[1];
    const fieldToColumn = new Map<string, string>();
    const columns: DbSchemaColumn[] = [];
    const relations: ParsedModel['relations'] = [];

    for (const line of body.split('\n')) {
      const f = line.match(/^\s*(\w+)\s+([\w]+)(\[\])?(\?)?\s*(.*)$/);
      if (!f || f[1]!.startsWith('@@')) continue;
      const [, fieldName, prismaType, isArray, isOptional, attrs = ''] = f;
      const columnName = attrs.match(/@map\(\s*"([^"]+)"\s*\)/)?.[1] ?? fieldName!;
      fieldToColumn.set(fieldName!, columnName);
      const rel = attrs.match(/@relation\(([^)]*)\)/)?.[1];
      if (rel) {
        const pick = (key: string) => rel.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`))?.[1]
          ?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
        const fields = pick('fields');
        const references = pick('references');
        if (fields.length && references.length) {
          relations.push({
            fields, references, target: prismaType!,
            onDelete: rel.match(/onDelete\s*:\s*(\w+)/)?.[1],
            onUpdate: rel.match(/onUpdate\s*:\s*(\w+)/)?.[1],
          });
        }
        continue; // relation fields aren't physical columns
      }
      if (isArray) continue; // prisma list scalars — skip for portability
      const enumValues = enums.get(prismaType!);
      columns.push({
        name: columnName,
        dataType: enumValues ? 'custom' : (PRISMA_TYPE_MAP[prismaType!] ?? 'custom'),
        columnType: prismaType!,
        notNull: !isOptional,
        primary: /@id\b/.test(attrs) || undefined,
        hasDefault: /@default\(/.test(attrs) || /@updatedAt\b/.test(attrs) || undefined,
        enumValues,
      });
    }

    models.push({
      modelName, tableName, body, fieldToColumn, columns, relations,
      compositePk: compositeRaw?.split(',').map((s) => s.trim()).filter(Boolean),
    });
  }

  // Pass 2 — resolve relation targets into FK rows.
  const byModel = new Map(models.map((m) => [m.modelName, m]));
  for (const m of models) {
    const fks: DbSchemaForeignKey[] = [];
    for (const r of m.relations) {
      const target = byModel.get(r.target);
      if (!target) continue;
      fks.push({
        columns: r.fields.map((f) => m.fieldToColumn.get(f) ?? f),
        referencesTable: target.tableName,
        referencesColumns: r.references.map((f) => target.fieldToColumn.get(f) ?? f),
        onDelete: r.onDelete, onUpdate: r.onUpdate,
      });
    }
    tables.push({
      name: m.tableName,
      export: m.modelName,
      columns: m.columns,
      primaryKey: m.compositePk?.length && m.compositePk.length > 1
        ? m.compositePk.map((f) => m.fieldToColumn.get(f) ?? f)
        : undefined,
      foreignKeys: fks.length ? fks : undefined,
    });
  }

  if (!tables.length) throw new Error('No `model` blocks found — is this a schema.prisma file?');
  return { version: 1, kind: DB_SCHEMA_KIND, generatedAt: new Date().toISOString(), dialect, tables };
}

// ── Live Postgres introspection (--from pg) ────────────────────────────────

const PG_TYPE_MAP: Record<string, string> = {
  'character varying': 'string', character: 'string', text: 'string', uuid: 'string', name: 'string',
  integer: 'number', smallint: 'number', numeric: 'number', real: 'number', 'double precision': 'number',
  bigint: 'bigint', boolean: 'boolean', json: 'json', jsonb: 'json', bytea: 'buffer',
  date: 'date', 'timestamp without time zone': 'date', 'timestamp with time zone': 'date', time: 'date', interval: 'custom',
};

const PG_COLUMNS_SQL = `
select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
       c.column_default is not null as has_default, k.ordinal_position as pk_pos
from information_schema.columns c
left join information_schema.table_constraints tc
  on tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = c.table_schema and tc.table_name = c.table_name
left join information_schema.key_column_usage k
  on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
 and k.table_name = c.table_name and k.column_name = c.column_name
where c.table_schema = $1 order by c.table_name, c.ordinal_position`;

const PG_FKS_SQL = `
select kcu1.constraint_name, kcu1.table_name, kcu1.column_name, kcu1.ordinal_position,
       kcu2.table_name as foreign_table, kcu2.column_name as foreign_column,
       rc.delete_rule, rc.update_rule
from information_schema.referential_constraints rc
join information_schema.key_column_usage kcu1
  on rc.constraint_name = kcu1.constraint_name and rc.constraint_schema = kcu1.constraint_schema
join information_schema.key_column_usage kcu2
  on rc.unique_constraint_name = kcu2.constraint_name
 and rc.unique_constraint_schema = kcu2.constraint_schema
 and kcu1.ordinal_position = kcu2.ordinal_position
where kcu1.constraint_schema = $1
order by kcu1.constraint_name, kcu1.ordinal_position`;

/**
 * Introspect a live Postgres database via `information_schema` into a
 * `DbSchemaFile` — works regardless of which ORM (or none) owns the schema.
 * Uses the project's `pg` driver (lazy `createRequire`, dep-free for us).
 */
export async function introspectPostgresSchema(
  connectionString: string,
  options: { schema?: string; entryFile?: string } = {},
): Promise<DbSchemaFile> {
  const schemaName = options.schema ?? 'public';
  let pg: { Client: new (opts: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(sql: string, params: unknown[]): Promise<{ rows: AnyRecord[] }> } };
  try {
    pg = createRequire(options.entryFile ?? join(process.cwd(), 'cli-placeholder.js'))('pg');
  } catch {
    throw new Error(
      `Live introspection needs the 'pg' package in this project (bun add pg) — or use --from prisma / --from file instead`,
    );
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  let colRows: AnyRecord[]; let fkRows: AnyRecord[];
  try {
    colRows = (await client.query(PG_COLUMNS_SQL, [schemaName])).rows;
    fkRows = (await client.query(PG_FKS_SQL, [schemaName])).rows;
  } finally {
    await client.end();
  }

  const tables = new Map<string, DbSchemaTable>();
  const pkCols = new Map<string, { pos: number; name: string }[]>();
  for (const r of colRows) {
    const t = String(r.table_name);
    const table = tables.get(t) ?? { name: t, export: t, columns: [] };
    const dataType = String(r.data_type);
    const udt = String(r.udt_name ?? dataType);
    table.columns.push({
      name: String(r.column_name),
      dataType: dataType === 'USER-DEFINED' || dataType === 'ARRAY' ? 'custom' : (PG_TYPE_MAP[dataType] ?? 'custom'),
      columnType: udt,
      notNull: r.is_nullable === 'NO',
      primary: r.pk_pos != null || undefined,
      hasDefault: Boolean(r.has_default) || undefined,
    });
    if (r.pk_pos != null) {
      const list = pkCols.get(t) ?? [];
      list.push({ pos: Number(r.pk_pos), name: String(r.column_name) });
      pkCols.set(t, list);
    }
    tables.set(t, table);
  }
  for (const [t, cols] of pkCols) {
    if (cols.length > 1) tables.get(t)!.primaryKey = cols.sort((a, b) => a.pos - b.pos).map((c) => c.name);
  }
  const fkByConstraint = new Map<string, { table: string; fk: DbSchemaForeignKey }>();
  for (const r of fkRows) {
    const key = String(r.constraint_name);
    const entry = fkByConstraint.get(key) ?? {
      table: String(r.table_name),
      fk: { columns: [], referencesTable: String(r.foreign_table), referencesColumns: [], onDelete: r.delete_rule as string | undefined, onUpdate: r.update_rule as string | undefined },
    };
    entry.fk.columns.push(String(r.column_name));
    entry.fk.referencesColumns.push(String(r.foreign_column));
    fkByConstraint.set(key, entry);
  }
  for (const { table, fk } of fkByConstraint.values()) {
    const t = tables.get(table);
    if (t) t.foreignKeys = [...(t.foreignKeys ?? []), fk];
  }

  return {
    version: 1, kind: DB_SCHEMA_KIND, generatedAt: new Date().toISOString(),
    dialect: 'pg', source: `pg:${schemaName}`,
    tables: [...tables.values()],
  };
}
