import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  Body, Controller, createApp, Get, HonoRouteBuilder, Injectable,
  Module, OpenAPIGenerator, Param, Params, Post, Public, Query, Validate,
} from '../src';

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().default('member'),
});

const FilterSchema = z.object({
  limit: z.coerce.number().default(20),
  search: z.string().optional(),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

/* ================= RUNTIME VALIDATION ================= */

@Controller('/users')
@Injectable()
class UserController {
  @Post()
  @Public()
  @Validate({ body: CreateUserSchema })
  async create(c: Context) {
    const body = await Body<z.infer<typeof CreateUserSchema>>(c);
    return body; // echo back — includes schema defaults
  }

  @Get()
  @Public()
  @Validate({ query: FilterSchema })
  list(c: Context) {
    const q = Query<z.infer<typeof FilterSchema>>(c);
    return { limit: q.limit, search: q.search ?? null };
  }

  @Get('/:id')
  @Public()
  @Validate({ params: IdParamSchema })
  getOne(c: Context) {
    const { id } = Params<{ id: string }>(c);
    return { id, raw: Param(c, 'id') };
  }
}

const build = () => {
  const app = new Hono();
  app.route('/', HonoRouteBuilder.build(UserController));
  return app;
};

describe('@Validate', () => {
  it('returns 400 VALIDATION_ERROR on invalid body', async () => {
    const res = await build().request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'nope' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Body(c) returns validated data including schema defaults — no second parse', async () => {
    const res = await build().request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@x.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('member'); // zod default applied
  });

  it('validates + parses query params with coercion and defaults', async () => {
    const res = await build().request('/users?limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(5); // z.coerce.number
  });

  it('rejects invalid query params', async () => {
    const res = await build().request('/users?limit=notanumber');
    expect(res.status).toBe(400);
  });

  it('validates route params — invalid id → 400, valid → typed Params()', async () => {
    const bad = await build().request('/users/not-a-uuid');
    expect(bad.status).toBe(400);

    const id = crypto.randomUUID();
    const ok = await build().request(`/users/${id}`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { id: string; raw: string };
    expect(body.id).toBe(id);
    expect(body.raw).toBe(id);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await build().request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Invalid JSON body');
  });
});

/* ================= OPENAPI EMISSION ================= */

describe('@Validate → OpenAPI spec', () => {
  const spec = OpenAPIGenerator.generate([UserController], {
    info: { title: 'T', version: '1' },
  }) as {
    paths: Record<string, Record<string, {
      requestBody?: { content: Record<string, { schema: unknown }> };
      parameters?: { name: string; in: string; required: boolean; schema?: { type?: string; format?: string } }[];
    }>>;
  };

  it('emits requestBody from the body schema — no @ApiBody needed', () => {
    const op = spec.paths['/users']?.['post'];
    expect(op?.requestBody).toBeDefined();
    const schema = op!.requestBody!.content['application/json']!.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain('email');
  });

  it('emits query parameters from the query schema', () => {
    const op = spec.paths['/users']?.['get'];
    const params = op?.parameters ?? [];
    const names = params.filter((p) => p.in === 'query').map((p) => p.name);
    expect(names).toContain('limit');
    expect(names).toContain('search');
    // .optional() search → not required
    const search = params.find((p) => p.name === 'search');
    expect(search?.required).toBe(false);
  });

  it('emits typed path params from the params schema', () => {
    const op = spec.paths['/users/{id}']?.['get'];
    const idParam = op?.parameters?.find((p) => p.name === 'id');
    expect(idParam?.in).toBe('path');
    expect(idParam?.required).toBe(true);
    expect(idParam?.schema?.format).toBe('uuid');
  });
});

/* ================= createApp bootstrap ================= */

@Module({ controllers: [UserController] })
class UserModule {}

describe('createApp', () => {
  it('wires routes + health + openapi in one call', async () => {
    const app = createApp(UserModule, {
      health: true,
      openapi: { info: { title: 'T', version: '1' } },
    });

    const health = await app.request('/health');
    expect(health.status).toBe(200);

    const spec = await app.request('/openapi.json');
    expect(spec.status).toBe(200);
    const specBody = (await spec.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(specBody.paths)).toContain('/users');

    const list = await app.request('/users?limit=3');
    expect(list.status).toBe(200);
  });

  it('works with zero options — plain module build', async () => {
    const app = createApp(UserModule);
    const res = await app.request('/users?limit=7');
    expect(res.status).toBe(200);
  });
});
