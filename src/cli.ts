#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClassMeta, METADATA_KEYS } from './decorators/metadata';
import type { ScheduleMetadata } from './decorators/metadata';
import { HonoRouteBuilder } from './core/route-builder';
import { container } from './core/container';
import { parseCron } from './core/cron';
import { OpenAPIGenerator } from './openapi/generator';
import { generateClientTypes } from './utils/client';
import { initProject } from './cli-init';
import { writeFlowFile, writeFlowFiles } from './integrations/api-tester';

interface CommandSpec {
  desc: string;
  /** Positional arg name — defaults to '<entry-file>' (init uses '<name>'). */
  arg?: string;
  opts: [flag: string, desc: string][];
  /** Example invocations shown in `<command> --help`. */
  examples: string[];
  /** Suppress the @Module/@Controller entry-file note (init doesn't take one). */
  noEntryNote?: boolean;
}

const COMMON_OPTS: [string, string][] = [
  ['--export <name>', 'pick this export when the file exports several\n                     @Module/@Controller classes'],
];

const COMMANDS: Record<string, CommandSpec> = {
  init: {
    desc: 'scaffold a new Bun + hono-forge project',
    arg: '<name>',
    noEntryNote: true,
    opts: [],
    examples: [
      'bunx hono-forge init my-api',
      '# → my-api/ with src/app.module.ts, a sample controller, tsconfig,',
      '#   package.json — then: cd my-api && bun install && bun run dev',
    ],
  },
  flows: {
    desc: 'api-tester .flow.yaml files',
    opts: [
      ['--out <dir>', 'output dir (default ./flows)'],
      ['--base-url <url>', 'flow settings baseUrl (default http://localhost:3000)'],
      ['--single', 'one file with a visual group per controller'],
      ...COMMON_OPTS,
    ],
    examples: [
      'bunx hono-forge flows ./src/app.module.ts --out ./flows',
      'bunx hono-forge flows ./src/app.module.ts --single --base-url http://localhost:3000',
      '# then in api-tester: Import flow → pick a .flow.yaml → Run',
    ],
  },
  openapi: {
    desc: 'OpenAPI 3.1 spec → JSON file',
    opts: [
      ['--out <file>', 'output file (default ./openapi.json)'],
      ['--title <text>', 'info.title (default: entry file name)'],
      ['--version <ver>', 'info.version (default 1.0.0)'],
      ...COMMON_OPTS,
    ],
    examples: [
      'bunx hono-forge openapi ./src/app.module.ts --out openapi.json',
      'bunx hono-forge openapi ./src/app.module.ts --title "Todo API" --version 2.1.0',
      '# feed the file to Swagger UI, api-tester "Import from API", or codegen',
    ],
  },
  routes: {
    desc: 'print the route table',
    opts: [...COMMON_OPTS],
    examples: [
      'bunx hono-forge routes ./src/app.module.ts',
      '# method / path / handler / guards / middleware / flags — no server needed',
    ],
  },
  graph: {
    desc: 'print the DI dependency graph',
    opts: [...COMMON_OPTS],
    examples: [
      'bunx hono-forge graph ./src/app.module.ts',
      '# shows provider scopes, constructor deps, and "missing" warnings',
    ],
  },
  doctor: {
    desc: 'static wiring check — exit 1 on issues (CI guard)',
    opts: [...COMMON_OPTS],
    examples: [
      'bunx hono-forge doctor ./src/app.module.ts',
      '# CI: fails on missing DI deps, route collisions, bad @Cron,',
      '# and @Interval/@OnBootstrap on @RequestScoped classes',
    ],
  },
  client: {
    desc: 'typed client route map → .ts file',
    opts: [
      ['--out <file>', 'output file (default ./routes.gen.ts)'],
      ['--name <ident>', 'exported interface name (default AppRoutes)'],
      ['--import-path <p>', 'module specifier the generated file imports\n                     controller types from (default: entry file relative\n                     to the output — controllers must be exported from it)'],
      ...COMMON_OPTS,
    ],
    examples: [
      'bunx hono-forge client ./src/app.module.ts --out src/routes.gen.ts',
      '# then: import { createClient } from "hono-forge"',
      '#       import type { AppRoutes } from "./routes.gen"',
      '#       const api = createClient<AppRoutes>("http://localhost:3000")',
    ],
  },
};

function commandHelp(name: string): string {
  const spec = COMMANDS[name]!;
  const lines = [`hono-forge ${name} — ${spec.desc}`, '', `Usage:`, `  hono-forge ${name} ${spec.arg ?? '<entry-file>'} [options]`];
  if (spec.opts.length) {
    lines.push('', 'Options:');
    for (const [flag, desc] of spec.opts) lines.push(`  ${flag.padEnd(20)} ${desc}`);
    lines.push(`  ${'-h, --help'.padEnd(20)} show this help`);
  }
  if (spec.examples.length) {
    lines.push('', 'Examples:');
    for (const ex of spec.examples) lines.push(`  ${ex}`);
  }
  if (!spec.noEntryNote) {
    lines.push('', `The entry file must export your @Module class (or @Controller classes).`, `TypeScript entries need Bun: bunx hono-forge ${name} ./src/app.module.ts`);
  }
  return lines.join('\n');
}

const HELP = `hono-forge — CLI

Usage: hono-forge <command> <entry-file> [options]

Commands:
${Object.entries(COMMANDS).map(([name, s]) => `  ${name.padEnd(9)} ${s.desc}`).join('\n')}

Run 'hono-forge help <command>' or 'hono-forge <command> --help' for
command options and examples. The entry file must export your @Module
class (or @Controller classes). TypeScript entries need Bun.

Example:
  bunx hono-forge routes ./src/app.module.ts
`;

/** Levenshtein distance — for "did you mean" hints on typos. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

function suggestCommand(input: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of Object.keys(COMMANDS)) {
    const d = editDistance(input, name);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return bestDist <= 2 ? best : undefined;
}

interface CliArgs {
  command?: string;
  entry?: string;
  out?: string;
  baseUrl: string;
  single: boolean;
  exportName?: string;
  title?: string;
  version?: string;
  name?: string;
  importPath?: string;
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
    else if (a === '--name') args.name = rest[++i]!;
    else if (a === '--import-path') args.importPath = rest[++i]!;
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

/** './foo/bar' module specifier pointing from `fromDir` at `toFile` (extension stripped). */
function relativeImport(fromDir: string, toFile: string): string {
  let rel = relative(fromDir, toFile).replace(/\\/g, '/').replace(/\.[tj]sx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
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

  // `hono-forge` / `hono-forge help` / `hono-forge help <command>`
  if (args.command === 'help') {
    console.log(args.entry && args.entry in COMMANDS ? commandHelp(args.entry) : HELP);
    return;
  }
  if (!args.command) { console.log(HELP); return; }
  if (!(args.command in COMMANDS)) {
    const suggestion = suggestCommand(args.command);
    fail(`Unknown command: '${args.command}'` +
      (suggestion ? ` — did you mean '${suggestion}'?` : ''));
  }
  // `hono-forge <command> --help` → per-command help
  if (args.help) { console.log(commandHelp(args.command)); return; }

  // init doesn't take an entry file — the positional arg is the project name.
  if (args.command === 'init') {
    if (!args.entry) fail('Missing <name> — e.g. hono-forge init my-api');
    const { dir, files } = await initProject(args.entry);
    console.log(`Created ${dir}`);
    for (const f of files) console.log(`  • ${f}`);
    console.log(`\nNext steps:\n  cd ${args.entry}\n  bun install\n  bun run dev\n\nThen open http://localhost:3000/docs`);
    return;
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

  if (args.command === 'client') {
    const out = resolve(process.cwd(), args.out ?? './routes.gen.ts');
    // The generated file imports controller types from the entry file by
    // default — require it to re-export them, or pass --import-path.
    const importPath = args.importPath ?? relativeImport(dirname(out), entryPath);
    // The generated file `import type`s each controller by name — warn when
    // one isn't exported from the entry module or the output won't compile.
    const unexported = (controllers as Function[]).filter(c => !(c.name in mod));
    if (unexported.length) {
      console.warn(`hono-forge: warning — not exported from the entry file: ${unexported.map(c => c.name).join(', ')}`);
      console.warn(`  The generated file imports types from '${importPath}' — export them there or pass --import-path.`);
    }
    const code = generateClientTypes({
      controllers: controllers as never,
      importPath,
      exportName: args.name ?? 'AppRoutes',
    });
    await writeFile(out, code, 'utf8');
    console.log(`Wrote ${out}`);
    return;
  }

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
