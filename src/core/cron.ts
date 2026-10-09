/**
 * Minimal dependency-free cron expression engine — standard 5-field syntax:
 * `min hour day-of-month month day-of-week`.
 *
 * Supported per field: `*`, `*\/n`, `a`, `a-b`, `a-b/n`, `a,b,c` (and mixes).
 * Day-of-month and day-of-week combine with OR semantics, matching Vixie cron:
 * when both are restricted (non-`*`), a date matching EITHER fires.
 *
 * Example: `0 2 * * *` daily 02:00 · `*\/15 * * * 1-5` weekdays every 15 min.
 */

const FIELD_RANGES: Array<[min: number, max: number]> = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day of month
  [1, 12],   // month
  [0, 6],    // day of week (0 = Sunday)
];

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step '${stepStr}' in '${field}'`);
    }
    const [lo, hi] =
      range === '*' || range === undefined || range === ''
        ? [min, max]
        : range.includes('-')
          ? (range.split('-').map(Number) as [number, number])
          : [parseInt(range, 10), parseInt(range, 10)];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Invalid cron range '${range}' in '${field}' (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  /** true when dom or dow is `*` — affects the OR rule. */
  domWildcard: boolean;
  dowWildcard: boolean;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression '${expr}' — expected 5 fields (min hour dom mon dow)`);
  }
  const [m, h, dom, mon, dow] = fields;
  return {
    minutes: parseField(m!, 0, 59),
    hours: parseField(h!, 0, 23),
    dom: parseField(dom!, 1, 31),
    months: parseField(mon!, 1, 12),
    dow: parseField(dow!, 0, 6),
    domWildcard: dom === '*',
    dowWildcard: dow === '*',
  };
}

function matches(d: Date, cron: ParsedCron): boolean {
  if (!cron.minutes.has(d.getMinutes())) return false;
  if (!cron.hours.has(d.getHours())) return false;
  if (!cron.months.has(d.getMonth() + 1)) return false;
  // Vixie cron OR rule: if both dom and dow are restricted, either may match.
  if (cron.domWildcard && cron.dowWildcard) return true;
  if (cron.domWildcard) return cron.dow.has(d.getDay());
  if (cron.dowWildcard) return cron.dom.has(d.getDate());
  return cron.dom.has(d.getDate()) || cron.dow.has(d.getDay());
}

/**
 * Next fire time strictly after `from` (rounded up to the next minute).
 * Scans forward minute-by-minute — bounded at ~4 years for impossible
 * expressions (e.g. Feb 30) which then throw.
 */
export function nextCronTime(cron: ParsedCron | string, from: Date = new Date()): Date {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + 4);
  while (d <= limit) {
    if (matches(d, parsed)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new Error('Cron expression has no fire time within the next 4 years');
}
