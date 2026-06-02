import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { extractIp, detectDevice, extractUserAgent } from '../utils/request';

/* ===============================================================
 * Context helper functions — drop-in replacements for the old
 * parameter decorators. Call them inside your handler:
 *
 *   @Post()
 *   async create(c: Context) {
 *     const body = await Body(c, CreateSchema);
 *     const id   = Param(c, 'id');
 *     const q    = Query(c);
 *   }
 * =============================================================== */

/* ================= BODY ================= */

export async function Body<T>(c: Context, schema: ZodType<T>): Promise<T>;
export async function Body(c: Context): Promise<unknown>;
export async function Body(c: Context, schema?: ZodType): Promise<unknown> {
  const raw = await c.req.json() as unknown;
  return schema ? schema.parseAsync(raw) : raw;
}

/* ================= PARAM ================= */

export function Param(c: Context, name: string): string;
export function Param(c: Context): Record<string, string>;
export function Param(c: Context, name?: string): string | Record<string, string> {
  if (name !== undefined) return c.req.param(name) ?? '';
  return c.req.param() as Record<string, string>;
}

/* ================= QUERY ================= */

export async function Query<T>(c: Context, schema: ZodType<T>): Promise<T>;
export function Query(c: Context): Record<string, string>;
export function Query(c: Context, schema?: ZodType): unknown {
  const raw = c.req.query();
  return schema ? schema.parseAsync(raw) : raw;
}

/* ================= HEADERS ================= */

export function Headers(c: Context, name: string): string | undefined;
export function Headers(c: Context): Record<string, string>;
export function Headers(c: Context, name?: string): string | undefined | Record<string, string> {
  return name ? c.req.header(name) : c.req.header();
}

/* ================= USER ================= */

export function User<T = unknown>(c: Context): T {
  return c.get('user') as T;
}

/* ================= REQ / CTX / RES ================= */

/** Returns `c.req` — the Hono HonoRequest object. */
export function Req(c: Context): Context['req'] {
  return c.req;
}

/** Returns the full Hono Context `c`. Alias for readability. */
export function Ctx(c: Context): Context {
  return c;
}

/** Returns the full Hono Context `c`. Same as Ctx(). */
export const Res = Ctx;

/* ================= IP / DEVICE / USER-AGENT ================= */

/** Resolves the real client IP (CF-Connecting-IP → X-Real-IP → X-Forwarded-For). */
export function Ip(c: Context): string {
  return extractIp(c);
}

/** Detects device type: 'mobile' | 'tablet' | 'desktop' | 'bot'. */
export function Device(c: Context): 'mobile' | 'tablet' | 'desktop' | 'bot' {
  return detectDevice(extractUserAgent(c));
}

/** Returns the raw User-Agent header string. */
export function UserAgent(c: Context): string {
  return extractUserAgent(c);
}

/* ================= COOKIES ================= */

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';').filter(Boolean).map((s) => {
      const eq = s.indexOf('=');
      return [s.slice(0, eq).trim(), decodeURIComponent(s.slice(eq + 1).trim())];
    })
  );
}

/** Get a single cookie value by name. */
export function Cookie(c: Context, name: string): string | undefined {
  return parseCookies(c.req.header('cookie') ?? '')[name];
}

/** Get all cookies as a Record<string, string>. */
export function Cookies(c: Context): Record<string, string> {
  return parseCookies(c.req.header('cookie') ?? '');
}

/* ================= FILE UPLOAD ================= */

/**
 * Get a single uploaded file from multipart form data.
 *
 * @example
 * @Post('/avatar')
 * async upload(c: Context) {
 *   const file = await UploadedFile(c, 'avatar');
 *   return { name: file?.name, size: file?.size };
 * }
 */
export async function UploadedFile(c: Context, fieldName: string): Promise<File | null> {
  const fd = await c.req.formData();
  const val = fd.get(fieldName);
  return val instanceof File ? val : null;
}

/**
 * Get all uploaded files from multipart form data.
 * Pass a fieldName to filter by field, or omit to get every file.
 *
 * @example
 * @Post('/gallery')
 * async upload(c: Context) {
 *   const files = await UploadedFiles(c, 'images');
 *   return files.map(f => ({ name: f.name }));
 * }
 */
export async function UploadedFiles(c: Context, fieldName?: string): Promise<File[]> {
  const fd = await c.req.formData();
  const result: File[] = [];
  const entries = fieldName ? fd.getAll(fieldName) : [...fd.values()];
  for (const v of entries) {
    if (v instanceof File) result.push(v);
  }
  return result;
}

/**
 * Get the raw FormData object from a multipart request.
 *
 * @example
 * @Post('/submit')
 * async submit(c: Context) {
 *   const form = await FormBody(c);
 *   const name = form.get('name');
 * }
 */
export async function FormBody(c: Context): Promise<FormData> {
  return c.req.formData();
}

/* ================= VALIDATED SHORTHANDS ================= */

/**
 * Type-safe Body — same as Body(c, schema) but emphasises validation intent.
 *
 * @example
 * const data = await ValidatedBody(c, CreateSchema);  // data is z.infer<typeof CreateSchema>
 */
export const ValidatedBody = Body;

/**
 * Type-safe Query — same as Query(c, schema).
 */
export const ValidatedQuery = Query;

/**
 * Type-safe Param — parses a single route param through a Zod schema.
 *
 * @example
 * const id = await ValidatedParam(c, 'id', z.string().uuid());
 */
export async function ValidatedParam<T>(
  c: Context,
  name: string,
  schema: ZodType<T>
): Promise<T> {
  return schema.parseAsync(c.req.param(name));
}
