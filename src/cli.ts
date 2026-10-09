#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClassMeta, METADATA_KEYS } from './decorators/metadata';
import { writeFlowFile, writeFlowFiles } from './integrations/api-tester';

const HELP = `hono-forge — CLI

Usage:
  hono-forge flows <entry-file> [options]

  Generates api-tester flow files (.flow.yaml) from your decorated
  controllers — import them via "Import flow" in api-tester.

Options:
  --out <dir>        Output directory (default: ./flows)
  --base-url <url>   baseUrl for flow settings (default: http://localhost:3000)
  --single           Write one .flow.yaml with a group per controller
                     (default: one file per controller)
  --export <name>    Named export to use when the file exports several
                     @Module/@Controller classes
  -h, --help         Show this help

The entry file must export your @Module class (or @Controller classes).
TypeScript entry files need Bun: bunx hono-forge flows ./src/app.module.ts
`;

interface CliArgs {
  command?: string;
  entry?: string;
  out: string;
  baseUrl: string;
  single: boolean;
  exportName?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { out: './flows', baseUrl: 'http://localhost:3000', single: false, help: false };
  const rest = [...argv];
  args.command = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--out') args.out = rest[++i]!;
    else if (a === '--base-url') args.baseUrl = rest[++i]!;
    else if (a === '--single') args.single = true;
    else if (a === '--export') args.exportName = rest[++i]!;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!a.startsWith('-') && !args.entry) args.entry = a;
    else fail(`Unknown argument: ${a}`);
  }
  return args;
}

function fail(msg: string): never {
  console.error(`hono-forge: ${msg}\n`);
  console.error(HELP);
  process.exit(1);
}

/** Find the @Module class — or collect exported @Controller classes — from a module's exports. */
function resolveTarget(mod: Record<string, unknown>, exportName?: string): Function | Function[] {
  const candidates: Function[] = [];
  for (const [name, value] of Object.entries(mod)) {
    if (exportName && name !== exportName) continue;
    if (typeof value === 'function' &&
        (getClassMeta(value, METADATA_KEYS.MODULE) !== undefined ||
         getClassMeta(value, METADATA_KEYS.CONTROLLER) !== undefined)) {
      candidates.push(value);
    }
  }
  if (!candidates.length) {
    fail(exportName
      ? `Export '${exportName}' is not a @Module or @Controller class.`
      : 'No exported @Module or @Controller class found in the entry file.');
  }
  if (candidates.length > 1 && !exportName) {
    const modules = candidates.filter(c => getClassMeta(c, METADATA_KEYS.MODULE) !== undefined);
    if (modules.length === 1) return modules[0]!;
    fail(`Multiple module/controller exports found — pick one with --export (${candidates.map(c => c.name).join(', ')}).`);
  }
  return candidates[0]!;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) { console.log(HELP); return; }
  if (args.command !== 'flows') fail(`Unknown command: '${args.command}'`);
  if (!args.entry) fail('Missing <entry-file> — e.g. hono-forge flows ./src/app.module.ts');

  const entryPath = resolve(process.cwd(), args.entry);
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(entryPath).href) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown file extension|ERR_UNKNOWN_FILE_EXTENSION|Cannot find module/i.test(msg)) {
      fail(`Could not load '${args.entry}'. TypeScript files need Bun — run: bunx hono-forge flows ${args.entry}`);
    }
    throw err;
  }

  const target = resolveTarget(mod, args.exportName);
  const opts = { baseUrl: args.baseUrl };

  if (args.single) {
    const path = await writeFlowFile(args.out, target, opts);
    console.log(`Wrote ${path}`);
  } else {
    const paths = await writeFlowFiles(args.out, target, opts);
    console.log(`Wrote ${paths.length} flow file(s):`);
    for (const p of paths) console.log(`  • ${p}`);
  }
}

main().catch((err: unknown) => {
  console.error('hono-forge:', err instanceof Error ? err.message : err);
  process.exit(1);
});
