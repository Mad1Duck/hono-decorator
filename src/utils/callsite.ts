import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';

/**
 * Absolute path of the user file that invoked the caller of this function —
 * captured from the V8 call site stack. Used to record which file a
 * @Controller class lives in, so codegen can import it from its real source
 * file instead of assuming a barrel.
 *
 * Internals detection: in dev this file sits at src/utils/callsite.ts so the
 * whole src/ tree is internal; in the published bundle everything internal is
 * inside dist/. Anything under either root is skipped — the first frame
 * outside is the user file.
 */
const SELF_DIR = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const INTERNAL_ROOT =
  basename(SELF_DIR) === 'dist' ? SELF_DIR : dirname(SELF_DIR);

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

function normalizeFileName(name: string): string | undefined {
  if (!name || name.startsWith('node:') || name === 'native') return undefined;
  let p = name;
  if (p.startsWith('file://')) {
    try {
      p = fileURLToPath(p);
    } catch {
      return undefined;
    }
  }
  if (!SOURCE_EXT.test(p)) return undefined;
  return p;
}

/**
 * Absolute path of the first stack frame outside hono-forge internals —
 * i.e. the file where a decorator was applied. Undefined when the call site
 * can't be determined (bundled/test environments fall back to other
 * resolution strategies).
 */
export function captureCallSiteFile(): string | undefined {
  const prev = Error.prepareStackTrace;
  let sites: NodeJS.CallSite[] | undefined;
  try {
    Error.prepareStackTrace = (_err, s) => s;
    const raw = new Error().stack;
    if (Array.isArray(raw)) sites = raw as unknown as NodeJS.CallSite[];
  } catch {
    // prepareStackTrace unsupported — fall through to string parsing
  } finally {
    Error.prepareStackTrace = prev;
  }

  const files: string[] = [];
  if (sites) {
    for (const cs of sites) {
      const p = normalizeFileName(cs.getFileName?.() ?? '');
      if (p) files.push(p);
    }
  } else {
    // String-stack fallback (SpiderMonkey-style or custom formatters):
    //   '    at fn (file:///path/to/file.ts:10:7)' / 'at /path/file.ts:10:7'
    for (const line of String(new Error().stack ?? '').split('\n').slice(1)) {
      const m = line.match(/\(?((?:file:\/\/\/)?\S+?\.\w+):\d+:\d+/);
      if (!m) continue;
      const p = normalizeFileName(m[1]!);
      if (p) files.push(p);
    }
  }

  for (const p of files) {
    const norm = p.replace(/\\/g, '/');
    if (norm.startsWith(INTERNAL_ROOT + '/')) continue;
    return p;
  }
  return undefined;
}
