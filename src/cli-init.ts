import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import pkgJson from '../package.json' with { type: 'json' };

/**
 * `hono-forge init <name>` — scaffold a runnable Bun + hono-forge project.
 * Kept as pure file generation (no prompts, no git init, no install) so it is
 * fast, testable, and safe to run in CI.
 */

const PKG_MAJOR = pkgJson.version.split('.')[0];

function appModule(): string {
  return `import { Module } from 'hono-forge';
import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

@Module({
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
`;
}

function helloController(): string {
  return `import type { Context } from 'hono';
import { z } from 'zod';
import {
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Public,
  Validate,
} from 'hono-forge';
import { HelloService } from './hello.service';

const GreetSchema = z.object({ name: z.string().min(1) });

@Controller('/hello')
@Injectable([HelloService])
export class HelloController {
  constructor(private readonly svc: HelloService) {}

  @Get()
  @Public()
  list() {
    return { greeting: this.svc.greeting(), docs: '/docs' };
  }

  @Post()
  @Public()
  @Validate({ body: GreetSchema })
  async greet(c: Context) {
    const body = await Body<z.infer<typeof GreetSchema>>(c); // already validated
    return { message: \`Hello, \${body.name}!\` };
  }
}
`;
}

function helloService(): string {
  return `import { Injectable, Singleton } from 'hono-forge';

@Injectable()
@Singleton()
export class HelloService {
  greeting(): string {
    return 'Hello from hono-forge';
  }
}
`;
}

function indexTs(name: string): string {
  return `import { createApp } from 'hono-forge';
import { AppModule } from './app.module';

const app = createApp(AppModule, {
  health: true,            // GET /health
  openapi: {
    info: { title: '${name}', version: '1.0.0' },
    // mounts GET /openapi.json + interactive Scalar UI at /docs
  },
  printRoutes: true,       // route table at startup
  shutdown: true,          // SIGINT/SIGTERM → drain → clean exit
});

export default {
  port: 3000,
  fetch: app.fetch,
};
`;
}

function tsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      lib: ['ESNext'],
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      types: ['bun-types'],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src'],
  }, null, 2)}\n`;
}

function readme(name: string): string {
  return `# ${name}

API built with [hono-forge](https://www.npmjs.com/package/hono-forge) — NestJS-style decorators for Hono.

## Run

\`\`\`bash
bun install
bun run dev
\`\`\`

- API → http://localhost:3000/hello
- Interactive docs (Scalar) → http://localhost:3000/docs
- OpenAPI spec → http://localhost:3000/openapi.json
- Health → http://localhost:3000/health

## Tooling

\`\`\`bash
bun run type-check
bunx hono-forge routes src/app.module.ts    # route table
bunx hono-forge doctor src/app.module.ts    # wiring check (CI)
bunx hono-forge openapi src/app.module.ts   # emit openapi.json
bunx hono-forge flows src/app.module.ts     # api-tester .flow.yaml files
bunx hono-forge client src/app.module.ts    # typed client route map
\`\`\`

## Node.js (optional)

Bun is the default runtime. For plain Node:

\`\`\`bash
bun add @hono/node-server
\`\`\`

\`\`\`ts
// src/node.ts
import { serve } from '@hono/node-server';
import app from './index';
serve(app);
\`\`\`
`;
}

export interface InitResult {
  dir: string;
  files: string[];
}

/** Scaffold a new project in `<cwd>/<name>` (or `<name>` if absolute). */
export async function initProject(name: string, cwd = process.cwd()): Promise<InitResult> {
  const dir = resolve(cwd, name);
  // The arg may be a path — title/package name come from the basename and
  // must be npm-name + string-literal safe.
  const displayName = basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'hono-forge-app';
  try {
    const existing = await readdir(dir);
    if (existing.length > 0) {
      throw new Error(`Directory '${dir}' already exists and is not empty.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({
      name: displayName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'bun --watch src/index.ts',
        start: 'bun src/index.ts',
        'type-check': 'tsc --noEmit',
      },
      dependencies: {
        'hono-forge': `^${PKG_MAJOR}.0.0`,
        hono: '^4.0.0',
        zod: '^4.0.0',
      },
      devDependencies: {
        'bun-types': 'latest',
        typescript: '^5.0.0',
      },
    }, null, 2)}\n`,
    'tsconfig.json': tsconfig(),
    'README.md': readme(displayName),
    '.gitignore': 'node_modules/\ndist/\n.env\n',
    'src/index.ts': indexTs(displayName),
    'src/app.module.ts': appModule(),
    'src/hello.controller.ts': helloController(),
    'src/hello.service.ts': helloService(),
  };

  await mkdir(join(dir, 'src'), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(dir, file), content, 'utf8');
  }
  return { dir, files: Object.keys(files) };
}
