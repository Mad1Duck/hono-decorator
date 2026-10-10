#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClassMeta, METADATA_KEYS } from './decorators/metadata';
import type { ScheduleMetadata } from './decorators/metadata';
import { HonoRouteBuilder } from './core/route-builder';
import { container } from './core/container';
import { parseCron } from './core/cron';
import { OpenAPIGenerator } from './openapi/generator';
import { writeFlowFile, writeFlowFiles } from './integrations/api-tester';

const HELP = `hono-forge — CLI

Usage:
  hono-forge flows   <entry-file> [options]   api-tester .flow.yaml files
  hono-forge openapi <entry-file> [options]   OpenAPI 3.1 spec → JSON file
  hono-forge routes  <entry-file> [options]   print the route table
  hono-forge graph   <entry-file> [options]   print the DI dependency graph
  hono-forge doctor  <entry-file> [options]   static wiring check (CI guard)

Options:
  --out <path>       flows: output dir (default ./flows)
                     openapi: output file (default ./openapi.json)
  --base-url <url>   flows: baseUrl for flow settings
                     (default: http://localhost:3000)
  --single           flows: one .flow.yaml with a group per controller
  --export <name>    Named export when the file exports several
                     @Module/@Controller classes
  --title <text>     openapi: info.title (default: entry file name)
  --version <ver>    openapi: info.version (default: 1.0.0)
  -h, --help         Show this help

The entry file must export your @Module class (or @Controller classes).
TypeScript entry files need Bun: bunx hono-forge flows ./src/app.module.ts
`;

interface CliArgs {
  command?: string;
  entry?: string;
  out?: string;
  baseUrl: string;
  single: boolean;
  exportName?: string;
  title?: string;
  version?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { baseUrl: 'http://localhost:3000', single: false, help: false };
  const rest = [...argv];
  args.command = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--out') args.out = rest[++i]!;
    else if (a === '--base-url') args.baseUrl = rest[++i]!;
    else if (a === '--single') args.single = true;
    else if (a === '--export') args.exportName = rest[++i]!;
    else if (a === '--title') args.title = rest[++i]!;
    else if (a === '--version') args.version = rest[++i]!;
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
  if (!['flows', 'openapi', 'routes', 'graph', 'doctor'].includes(args.command)) {
    fail(`Unknown command: '${args.command}'`);
  }
  if (!args.entry) fail(`Missing <entry-file> — e.g. hono-forge ${args.command} ./src/app.module.ts`);

  const entryPath = resolve(process.cwd(), args.entry);
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(entryPath).href) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown file extension|ERR_UNKNOWN_FILE_EXTENSION|Cannot find module/i.test(msg)) {
      fail(`Could not load '${args.entry}'. TypeScript files need Bun — run: bunx hono-forge ${args.command} ${args.entry}`);
    }
    throw err;
  }

  const target = resolveTarget(mod, args.exportName);

  if (args.command === 'routes') {
    for (const t of Array.isArray(target) ? target : [target]) {
      HonoRouteBuilder.printRoutes(t);
    }
    return;
  }

  if (args.command === 'graph') {
    for (const t of Array.isArray(target) ? target : [target]) {
      const isModule = getClassMeta(t, METADATA_KEYS.MODULE) !== undefined;
      container.printGraph(
        isModule
          ? [...HonoRouteBuilder.moduleProviders(t), ...HonoRouteBuilder.moduleControllers(t)] as Function[]
          : [t],
      );
    }
    return;
  }

  if (args.command === 'doctor') {
    const targets = (Array.isArray(target) ? target : [target]) as Function[];
    const isModule = (t: Function) => getClassMeta(t, METADATA_KEYS.MODULE) !== undefined;
    const controllers = targets.flatMap(t =>
      isModule(t) ? (HonoRouteBuilder.moduleControllers(t) as Function[]) : [t]);
    const providers = targets.flatMap(t =>
      isModule(t) ? (HonoRouteBuilder.moduleProviders(t) as Function[]) : []);

    const issues: string[] = [];

    // 1. DI — dependencies absent from the module's providers/registrations.
    for (const row of container.describe([...providers, ...controllers])) {
      for (const dep of row.missing) {
        issues.push(`di: '${row.name}' depends on '${dep}' — not in providers or container registrations; resolve() will fail`);
      }
    }

    // 2. Route collisions — two handlers bound to the same method+path.
    const seen = new Map<string, string>();
    for (const ctrl of controllers) {
      for (const d of HonoRouteBuilder.describe(ctrl as never)) {
        const key = `${d.method.toUpperCase()} ${d.path}`;
        const label = `${ctrl.name}.${d.handlerName}`;
        const prev = seen.get(key);
        if (prev) issues.push(`route: ${key} is bound by both ${prev} and ${label} — for exact matches the earlier handler wins`);
        else seen.set(key, label);
      }
    }

    // 3. Scheduler + bootstrap — invalid cron expressions and lifecycle
    //    methods that cannot resolve outside a request scope.
    for (const cls of [...providers, ...controllers]) {
      const sched = getClassMeta(cls, METADATA_KEYS.SCHEDULE) as Record<string, ScheduleMetadata> | undefined;
      const requestScoped = getClassMeta(cls, METADATA_KEYS.REQUEST_SCOPED) !== undefined;
      if (sched) {
        for (const [method, meta] of Object.entries(sched)) {
          if (meta.cron) {
            try {
              parseCron(meta.cron);
            } catch (err) {
              issues.push(`cron: ${cls.name}.${method} — ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          if (requestScoped) {
            issues.push(`schedule: ${cls.name}.${method} is on a @RequestScoped class — no request scope exists at tick time`);
          }
        }
      }
      const boot = getClassMeta(cls, METADATA_KEYS.ON_BOOTSTRAP) as Record<string, boolean> | undefined;
      if (boot && requestScoped) {
        for (const method of Object.keys(boot)) {
          issues.push(`bootstrap: ${cls.name}.${method} (@OnBootstrap) is on a @RequestScoped class — cannot resolve outside a request scope`);
        }
      }
    }

    if (issues.length === 0) {
      console.log(`✔ no issues — ${controllers.length} controller(s), ${providers.length} provider(s)`);
      return;
    }
    console.log(`✖ doctor found ${issues.length} issue(s):`);
    for (const i of issues) console.log(`  • ${i}`);
    process.exitCode = 1;
    return;
  }

  const controllers = (Array.isArray(target) ? target : [target]).flatMap(t =>
    getClassMeta(t, METADATA_KEYS.MODULE) !== undefined
      ? (HonoRouteBuilder.moduleControllers(t) as Function[])
      : [t],
  );

  if (args.command === 'openapi') {
    const out = args.out ?? './openapi.json';
    const spec = OpenAPIGenerator.generate(controllers as any, {
      info: {
        title: args.title ?? (Array.isArray(target) ? 'API' : target.name.replace(/Module$|Controller$/, '') || 'API'),
        version: args.version ?? '1.0.0',
      },
    });
    await writeFile(resolve(process.cwd(), out), JSON.stringify(spec, null, 2), 'utf8');
    console.log(`Wrote ${resolve(process.cwd(), out)}`);
    return;
  }

  const out = args.out ?? './flows';
  if (args.single) {
    const path = await writeFlowFile(out, target, { baseUrl: args.baseUrl });
    console.log(`Wrote ${path}`);
  } else {
    const paths = await writeFlowFiles(out, target, { baseUrl: args.baseUrl });
    console.log(`Wrote ${paths.length} flow file(s):`);
    for (const p of paths) console.log(`  • ${p}`);
  }
}

main().catch((err: unknown) => {
  console.error('hono-forge:', err instanceof Error ? err.message : err);
  process.exit(1);
});
