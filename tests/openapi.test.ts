import 'reflect-metadata';
import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Sse,
  WebSocket,
  Body,
  Param,
  Query,
  Public,
  RequireAuth,
  RequireRole,
} from '../src';
import { ApiDoc, ApiTags, ApiResponse, ApiDeprecated } from '../src';
import { OpenAPIGenerator } from '../src';

/* ================= CONTROLLERS ================= */

const CreateItemSchema = z.object({ name: z.string().min(1), price: z.number() });
const ItemQuerySchema = z.object({ search: z.string().optional(), page: z.number().optional() });

@Controller('/items')
@ApiTags('Items')
class ItemController {
  @Get()
  @Public()
  @ApiDoc({ summary: 'List items', description: 'Returns all items' })
  @ApiResponse(200, 'Success')
  list(@Query(ItemQuerySchema) _q: unknown) {}

  @Get('/:id')
  @Public()
  @ApiDoc({ summary: 'Get item' })
  getOne(@Param('id') _id: string) {}

  @Post()
  @RequireAuth()
  @ApiDoc({ summary: 'Create item' })
  @ApiResponse(201, 'Created')
  create(@Body(CreateItemSchema) _body: unknown) {}

  @Put('/:id')
  @RequireRole('admin')
  update(@Param('id') _id: string, @Body(CreateItemSchema) _body: unknown) {}

  @Delete('/:id')
  @RequireAuth()
  @ApiDeprecated()
  remove(@Param('id') _id: string) {}
}

@Controller('/events')
class StreamController {
  @Sse('/feed')
  @Public()
  feed() {}

  @WebSocket('/chat')
  @Public()
  chat() {}
}

/* ================= HELPERS ================= */

function generate(...controllers: (new (...args: unknown[]) => unknown)[]) {
  return OpenAPIGenerator.generate(controllers, {
    info: { title: 'Test API', version: '1.0.0' },
  });
}

type Spec = ReturnType<typeof generate>;
type PathItem = Record<string, Record<string, unknown>>;

function op(spec: Spec, path: string, method: string): Record<string, unknown> {
  return ((spec['paths'] as Record<string, PathItem>)[path]?.[method] ?? {}) as Record<string, unknown>;
}

/* ================= TESTS ================= */

describe('OpenAPIGenerator.generate', () => {

  describe('spec structure', () => {
    it('sets openapi version to 3.1.0', () => {
      expect(generate(ItemController)['openapi']).toBe('3.1.0');
    });

    it('includes info block', () => {
      const info = generate(ItemController)['info'] as Record<string, string>;
      expect(info['title']).toBe('Test API');
      expect(info['version']).toBe('1.0.0');
    });

    it('skips controller without @Controller decorator', () => {
      class Bare {}
      const spec = generate(Bare as never);
      expect(Object.keys(spec['paths'] as object)).toHaveLength(0);
    });
  });

  describe('paths', () => {
    it('generates /items GET', () => {
      const spec = generate(ItemController);
      const paths = spec['paths'] as Record<string, unknown>;
      expect('/items' in paths).toBe(true);
      expect('get' in (paths['/items'] as object)).toBe(true);
    });

    it('generates /items/{id} GET', () => {
      const spec = generate(ItemController);
      const paths = spec['paths'] as Record<string, unknown>;
      expect('/items/{id}' in paths).toBe(true);
    });

    it('converts Hono :param to {param} in path', () => {
      const spec = generate(ItemController);
      const paths = spec['paths'] as Record<string, unknown>;
      expect('/:id' in paths).toBe(false);
      expect('/items/{id}' in paths).toBe(true);
    });
  });

  describe('operations', () => {
    it('sets summary from @ApiDoc', () => {
      expect(op(generate(ItemController), '/items', 'get')['summary']).toBe('List items');
    });

    it('sets description from @ApiDoc', () => {
      expect(op(generate(ItemController), '/items', 'get')['description']).toBe('Returns all items');
    });

    it('sets operationId', () => {
      expect(op(generate(ItemController), '/items', 'get')['operationId']).toBe('get_list');
    });

    it('marks deprecated from @ApiDeprecated', () => {
      expect(op(generate(ItemController), '/items/{id}', 'delete')['deprecated']).toBe(true);
    });

    it('SSE route description prefix', () => {
      const desc = op(generate(StreamController), '/events/feed', 'get')['description'];
      expect((desc as string)).toContain('SSE stream');
    });

    it('WebSocket route description prefix', () => {
      const desc = op(generate(StreamController), '/events/chat', 'get')['description'];
      expect((desc as string)).toContain('WebSocket upgrade');
    });
  });

  describe('tags', () => {
    it('class-level @ApiTags propagate to all operations', () => {
      const spec = generate(ItemController);
      expect((op(spec, '/items', 'get')['tags'] as string[])).toContain('Items');
      expect((op(spec, '/items', 'post')['tags'] as string[])).toContain('Items');
    });
  });

  describe('parameters', () => {
    it('generates path parameter for /:id', () => {
      const params = op(generate(ItemController), '/items/{id}', 'get')['parameters'] as unknown[];
      expect(params?.some((p: unknown) => (p as Record<string, string>)['name'] === 'id' && (p as Record<string, string>)['in'] === 'path')).toBe(true);
    });

    it('path param is required', () => {
      const params = op(generate(ItemController), '/items/{id}', 'get')['parameters'] as unknown[];
      const id = params?.find((p: unknown) => (p as Record<string, string>)['name'] === 'id') as Record<string, unknown>;
      expect(id?.['required']).toBe(true);
    });

    it('expands @Query(schema) with object schema into individual params', () => {
      const params = op(generate(ItemController), '/items', 'get')['parameters'] as unknown[];
      const names = params?.map((p: unknown) => (p as Record<string, string>)['name']) ?? [];
      expect(names).toContain('search');
      expect(names).toContain('page');
    });
  });

  describe('requestBody', () => {
    it('generates requestBody from @Body schema', () => {
      const rb = op(generate(ItemController), '/items', 'post')['requestBody'] as Record<string, unknown>;
      expect(rb).toBeDefined();
      expect(rb['required']).toBe(true);
      const content = rb['content'] as Record<string, { schema: { properties: Record<string, unknown> } }>;
      expect(content['application/json']?.['schema']?.['properties']?.['name']).toBeDefined();
    });

    it('no requestBody for GET', () => {
      expect(op(generate(ItemController), '/items/{id}', 'get')['requestBody']).toBeUndefined();
    });
  });

  describe('responses', () => {
    it('uses @ApiResponse when provided', () => {
      const responses = op(generate(ItemController), '/items', 'get')['responses'] as Record<string, unknown>;
      expect('200' in responses).toBe(true);
    });

    it('adds 400 when requestBody or query schema present', () => {
      const responses = op(generate(ItemController), '/items', 'post')['responses'] as Record<string, unknown>;
      expect('400' in responses).toBe(true);
    });

    it('adds 401/403 for guarded routes', () => {
      const responses = op(generate(ItemController), '/items', 'post')['responses'] as Record<string, unknown>;
      expect('401' in responses).toBe(true);
      expect('403' in responses).toBe(true);
    });

    it('no 401/403 for @Public routes', () => {
      const responses = op(generate(ItemController), '/items', 'get')['responses'] as Record<string, unknown>;
      expect('401' in responses).toBe(false);
    });
  });

  describe('security', () => {
    it('@RequireAuth sets bearerAuth security', () => {
      const security = op(generate(ItemController), '/items', 'post')['security'] as unknown[];
      expect(security?.some(s => 'bearerAuth' in (s as object))).toBe(true);
    });

    it('@RequireRole sets bearerAuth security', () => {
      const security = op(generate(ItemController), '/items/{id}', 'put')['security'] as unknown[];
      expect(security?.some(s => 'bearerAuth' in (s as object))).toBe(true);
    });

    it('@Public sets empty security array', () => {
      const security = op(generate(ItemController), '/items', 'get')['security'] as unknown[];
      expect(Array.isArray(security)).toBe(true);
      expect(security).toHaveLength(0);
    });

    it('adds bearerAuth securityScheme to components when auth is present', () => {
      const components = generate(ItemController)['components'] as Record<string, unknown> | undefined;
      expect(components).toBeDefined();
      const schemes = components?.['securitySchemes'] as Record<string, unknown>;
      expect('bearerAuth' in schemes).toBe(true);
    });

    it('omits components when no auth routes', () => {
      @Controller('/open')
      class OpenController {
        @Get() @Public() list() {}
      }
      const spec = generate(OpenController);
      expect(spec['components']).toBeUndefined();
    });
  });

  describe('servers', () => {
    it('includes servers when provided', () => {
      const spec = OpenAPIGenerator.generate([ItemController], {
        info: { title: 'API', version: '1.0.0' },
        servers: [{ url: 'https://api.example.com', description: 'Production' }],
      });
      const servers = spec['servers'] as Array<{ url: string }>;
      expect(servers[0]?.url).toBe('https://api.example.com');
    });
  });
});
