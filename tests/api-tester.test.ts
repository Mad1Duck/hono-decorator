import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Post,
  Public,
  RequireAuth,
  Sse,
  Status,
  Validate,
  WebSocket,
} from '../src';
import {
  generateFlowFile,
  generateFlowFiles,
  stringifyFlowFile,
  type ApiTesterFlowFile,
  type ApiTesterRestConfig,
  type ApiTesterSseConfig,
  type ApiTesterWsConfig,
} from '../src/integrations/api-tester';

const CreateTodoSchema = z.object({
  title: z.string(),
  done: z.boolean().default(false),
});

@Injectable()
class TodoService {}

@Controller('/todos')
class TodoController {
  constructor(private svc: TodoService) {}

  @Get() @Public()
  list() { return []; }

  @Post() @Public() @Status(201)
  @Validate({ body: CreateTodoSchema })
  create() { return { id: 'x' }; }

  @Get('/:id') @Public()
  getOne() { return {}; }

  @Delete('/:id') @RequireAuth()
  remove() {}

  @Sse('/feed') @Public()
  feed() {}

  @WebSocket('/ws') @Public()
  ws() {}
}

@Module({ controllers: [TodoController], providers: [TodoService] })
class TodoModule {}

describe('generateFlowFiles', () => {
  const [result] = generateFlowFiles(TodoModule, { baseUrl: 'http://localhost:4000' });
  const file = result!.file;

  test('produces one FlowFile per controller with a stable id', () => {
    expect(result!.fileName).toBe('todo.flow.yaml');
    expect(file.version).toBe(1);
    expect(file.name).toBe('Todo flow');
    expect(file.id).toMatch(/^[0-9a-f-]{36}$/);
    // deterministic — regenerating yields the same id so re-imports upsert
    expect(generateFlowFiles(TodoModule)[0]!.file.id).toBe(file.id);
  });

  test('settings carry baseUrl and the auth token variable', () => {
    expect(file.settings?.baseUrl).toBe('http://localhost:4000');
    expect(file.settings?.defaultVariables?.some(v => v.key === 'token')).toBe(true);
  });

  test('routes are ordered CRUD-style: list → create → get → delete → sse/ws', () => {
    const labels = file.nodes.map(n => n.label);
    expect(labels[0]).toContain('GET /todos');
    expect(labels[1]).toContain('POST /todos');
    expect(labels[2]).toContain('GET /todos/:id');
    expect(labels[3]).toContain('DELETE /todos/:id');
    expect(labels.at(-2)).toContain('/feed');
    expect(labels.at(-1)).toContain('/ws');
  });

  test('nodes are chained linearly via edges', () => {
    expect(file.edges).toHaveLength(file.nodes.length - 1);
    for (let i = 0; i < file.edges.length; i++) {
      expect(file.edges[i]!.source).toBe(file.nodes[i]!.id);
      expect(file.edges[i]!.target).toBe(file.nodes[i + 1]!.id);
    }
  });

  test('POST node extracts id; downstream param nodes consume {{id}}', () => {
    const create = file.nodes[1]!.config as ApiTesterRestConfig;
    expect(create.method).toBe('POST');
    expect(create.extractors).toEqual([{ variableName: 'id', path: '$.id' }]);
    expect(create.assertions).toContainEqual({ path: '$.id', operator: 'exists' });

    const getOne = file.nodes[2]!.config as ApiTesterRestConfig;
    expect(getOne.url).toBe('/todos/{{id}}');
    expect(getOne.pathParams).toEqual([{ key: 'id', value: '{{id}}', enabled: true }]);
  });

  test('@Validate body becomes a sample JSON payload', () => {
    const create = file.nodes[1]!.config as ApiTesterRestConfig;
    expect(create.bodyMode).toBe('raw');
    expect(JSON.parse(create.body!)).toEqual({ title: 'Example', done: false });
    expect(create.headers).toContainEqual({ key: 'Content-Type', value: 'application/json', enabled: true });
  });

  test('guarded route gets a bearer header; public routes do not', () => {
    const del = file.nodes.find(n => n.label.startsWith('DELETE'))!.config as ApiTesterRestConfig;
    expect(del.headers).toContainEqual({ key: 'Authorization', value: 'Bearer {{token}}', enabled: true });
    const list = file.nodes[0]!.config as ApiTesterRestConfig;
    expect(list.headers).toEqual([]);
  });

  test('@Status(201) drives the expected assertion; delete defaults to 204', () => {
    const create = file.nodes[1]!.config as ApiTesterRestConfig;
    expect(create.assertions).toContainEqual({ path: '$status', operator: 'equals', expected: '201' });
    const del = file.nodes.find(n => n.label.startsWith('DELETE'))!.config as ApiTesterRestConfig;
    expect(del.assertions).toContainEqual({ path: '$status', operator: 'equals', expected: '204' });
  });

  test('SSE node uses the http baseUrl; WS node gets a ws:// URL', () => {
    const sse = file.nodes.find(n => n.label.includes('/feed'))!.config as ApiTesterSseConfig;
    expect(sse.type).toBe('sse');
    expect(sse.url).toBe('/todos/feed');
    expect(sse.listenDurationMs).toBe(10_000);
    const ws = file.nodes.find(n => n.label.includes('/ws'))!.config as ApiTesterWsConfig;
    expect(ws.type).toBe('ws');
    expect(ws.url).toBe('ws://localhost:4000/todos/ws');
  });
});

describe('generateFlowFile (single file)', () => {
  const { file } = generateFlowFile(TodoModule, { baseUrl: 'http://localhost:4000' });

  test('one file for the whole module with a group per controller', () => {
    expect(file.name).toBe('Todo flow');
    expect(file.groups).toHaveLength(1);
    expect(file.groups![0]!.label).toBe('Todo');
    expect(file.nodes.every(n => n.groupId === file.groups![0]!.id)).toBe(true);
    // group covers the node column
    expect(file.groups![0]!.size.height).toBeGreaterThanOrEqual(file.nodes.length * 110);
  });

  test('node positions are relative to their group', () => {
    expect(file.nodes[0]!.position).toEqual({ x: 20, y: 40 });
  });

  test('round-trips through YAML with groups intact', () => {
    const parsed = Bun.YAML.parse(stringifyFlowFile(file)) as ApiTesterFlowFile;
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.nodes.filter(n => n.groupId)).toHaveLength(file.nodes.length);
  });
});

describe('stringifyFlowFile', () => {
  test('emits YAML that parses back to the same structure', () => {
    const [result] = generateFlowFiles(TodoModule);
    const yaml = stringifyFlowFile(result!.file);
    const parsed = Bun.YAML.parse(yaml) as ApiTesterFlowFile;
    expect(parsed.version).toBe(1);
    expect(parsed.id).toBe(result!.file.id);
    expect(parsed.nodes).toHaveLength(result!.file.nodes.length);
    expect(parsed.nodes[1]!.label).toBe(result!.file.nodes[1]!.label);
    expect((parsed.nodes[1]!.config as ApiTesterRestConfig).body).toContain('"title"');
    expect(parsed.settings?.baseUrl).toBe('http://localhost:3000');
  });

  test('quotes strings that would otherwise parse as other YAML types', () => {
    const yaml = stringifyFlowFile({
      version: 1, id: 'x', name: 'n',
      nodes: [], edges: [],
      settings: { defaultVariables: [{ key: 'k', value: 'true', enabled: true }] },
    });
    expect(yaml).toContain('value: "true"');
    expect((Bun.YAML.parse(yaml) as any).settings.defaultVariables[0].value).toBe('true');
  });
});
