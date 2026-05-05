import type { Context } from 'hono';

/* ================= TYPES ================= */

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'bot';

export interface RequestLogEntry {
  method: string;
  path: string;
  ip: string;
  device: DeviceType;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  /** Trace / correlation ID. Value of incoming X-Request-ID header or a generated UUID. */
  traceId?: string;
}

export type RequestLogger = (entry: RequestLogEntry) => void | Promise<void>;

/* ================= IP ================= */

/**
 * Extracts the real client IP, respecting common proxy headers in priority order:
 * CF-Connecting-IP → X-Real-IP → X-Forwarded-For (first) → fallback 'unknown'
 */
export function extractIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Real-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/* ================= DEVICE DETECTION ================= */

/**
 * Classifies a User-Agent string into mobile / tablet / desktop / bot.
 * Lightweight regex — no external dependency.
 */
export function detectDevice(ua: string): DeviceType {
  if (!ua) return 'desktop';
  if (/bot|crawl|spider|slurp|archive|facebookexternalhit/i.test(ua)) return 'bot';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|windows phone|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

/* ================= USER-AGENT ================= */

export function extractUserAgent(c: Context): string {
  return c.req.header('user-agent') ?? '';
}

/* ================= COMBINED ================= */

export interface RequestContext {
  ip: string;
  device: DeviceType;
  userAgent: string;
}

export function extractRequestContext(c: Context): RequestContext {
  const userAgent = extractUserAgent(c);
  return {
    ip: extractIp(c),
    device: detectDevice(userAgent),
    userAgent,
  };
}
