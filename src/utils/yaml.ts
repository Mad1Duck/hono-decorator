/**
 * Dependency-free YAML emitter — handles the JSON-compatible subset used by
 * hono-forge artifacts (.flow.yaml, .schema.yaml): plain objects, arrays,
 * strings, numbers, booleans, and null. undefined object values are dropped.
 */

const YAML_PLAIN = /^[A-Za-z0-9 _.\/-]+$/;
const YAML_KEYWORDS = /^(true|false|null|yes|no|on|off|~)$/i;

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s !== '' && YAML_PLAIN.test(s) && !YAML_KEYWORDS.test(s) && !/^\d/.test(s)) return s;
  return JSON.stringify(s);
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function yamlEntry(key: string, v: unknown, pad: string, indent: number): string[] {
  if (isScalar(v)) return [`${pad}${key}: ${yamlScalar(v)}`];
  if (Array.isArray(v) && !v.length) return [`${pad}${key}: []`];
  if (isObject(v) && !Object.keys(v).length) return [`${pad}${key}: {}`];
  return [`${pad}${key}:`, ...yamlLines(v, indent + 1)];
}

function yamlLines(value: unknown, indent: number): string[] {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (isObject(item)) {
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        if (!entries.length) return [`${pad}- {}`];
        const [k, v] = entries[0]!;
        const head = isScalar(v)
          ? `${pad}- ${k}: ${yamlScalar(v)}`
          : Array.isArray(v) && !v.length
            ? `${pad}- ${k}: []`
            : isObject(v) && !Object.keys(v).length
              ? `${pad}- ${k}: {}`
              : `${pad}- ${k}:`;
        const rest = [
          ...(isScalar(v) || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length)
            ? []
            : yamlLines(v, indent + 2)),
          ...entries.slice(1).flatMap(([k2, v2]) => yamlEntry(k2, v2, `${pad}  `, indent + 1)),
        ];
        return [head, ...rest];
      }
      if (Array.isArray(item)) return [`${pad}-`, ...yamlLines(item, indent + 1)];
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return [`${pad}{}`];
    return entries.flatMap(([k, v]) => yamlEntry(k, v, pad, indent));
  }
  return [`${pad}${yamlScalar(value)}`];
}

/** Serialize a plain JSON-compatible value to a YAML document string. */
export function yamlStringify(value: unknown): string {
  return yamlLines(value, 0).join('\n') + '\n';
}
