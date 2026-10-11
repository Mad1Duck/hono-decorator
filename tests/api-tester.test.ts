import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ApiBody,
  ApiQuery,
  ApiResponse,
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

@Controller('/docs')
class DocsController {
  @Post('/upload') @Public()
  @ApiBody(z.object({ file: z.string(), name: z.string() }))
  upload() { return {}; }

  @Post('/ping') @Public()
  ping() { return {}; }
}

@Controller('/uploads')
class UploadController {
  @Post('/files/:folderId') @Public()
  @Validate({ params: z.object({ folderId: z.string().uuid() }) })
  @ApiQuery('notify', z.boolean(), { required: true })
  @ApiQuery('tags', z.string())
  @ApiBody(z.object({ file: z.file(), caption: z.string() }))
  @ApiResponse(201, 'created', z.object({ id: z.string(), url: z.string() }))
  upload() { return {}; }

  @Get('/search') @Public()
  @ApiQuery('q', z.string(), { required: true })
  @ApiQuery('limit', z.number())
  search() { return []; }
}

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

describe('generateFlowFiles — body detection without @Validate', () => {
  const [result] = generateFlowFiles(DocsController);
  const file = result!.file;

  test('@ApiBody schema becomes a sample JSON payload', () => {
    const upload = file.nodes.find((n) => n.label.includes('/upload'))!
      .config as ApiTesterRestConfig;
    expect(upload.bodyMode).toBe('raw');
    const body = JSON.parse(upload.body!) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['file', 'name']);
    expect(upload.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
      enabled: true,
    });
  });

  test('schema-less POST still gets a visible (empty) raw body field', () => {
    const ping = file.nodes.find((n) => n.label.includes('/ping'))!
      .config as ApiTesterRestConfig;
    expect(ping.bodyMode).toBe('raw');
    // empty string = the field renders but nothing is sent
    expect(ping.body).toBe('');
    expect(ping.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
      enabled: true,
    });
  });

  test('GET routes still carry no body config', () => {
    const get = file.nodes.find((n) => n.label.startsWith('GET'));
    expect(get).toBeUndefined(); // DocsController has no GET — sanity
  });
});

describe('generateFlowFiles — metadata completeness', () => {
  const [result] = generateFlowFiles(UploadController);
  const file = result!.file;
  const upload = file.nodes.find((n) => n.label.includes('/files'))!
    .config as ApiTesterRestConfig;
  const search = file.nodes.find((n) => n.label.includes('/search'))!
    .config as ApiTesterRestConfig;

  test('@ApiQuery becomes query rows — required enabled, optional disabled', () => {
    expect(search.query).toContainEqual({ key: 'q', value: 'string', enabled: true });
    expect(search.query).toContainEqual({ key: 'limit', value: '42', enabled: false });
  });

  test('z.file() body becomes form-data with a file row', () => {
    expect(upload.bodyMode).toBe('form-data');
    expect(upload.formData).toContainEqual({ key: 'file', value: '', enabled: true, type: 'file' });
    expect(upload.formData).toContainEqual({ key: 'caption', value: 'string', enabled: true });
    // multipart boundary is set by api-tester — no manual Content-Type
    expect(upload.headers.find((h) => h.key === 'Content-Type')).toBeUndefined();
  });

  test('typed path params seed the editable variable default', () => {
    expect(upload.pathParams).toContainEqual({ key: 'folderId', value: '{{folderId}}', enabled: true });
    const folderVar = file.settings?.defaultVariables?.find((v) => v.key === 'folderId');
    expect(folderVar?.value).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(folderVar?.enabled).toBe(true);
  });

  test('@ApiResponse 2xx drives the status assertion and shape checks', () => {
    expect(upload.assertions).toContainEqual({ path: '$status', operator: 'equals', expected: '201' });
    expect(upload.assertions).toContainEqual({ path: '$.id', operator: 'exists', forStatus: 201 });
    expect(upload.assertions).toContainEqual({ path: '$.url', operator: 'exists', forStatus: 201 });
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

describe('generateFlowFiles — auth preamble', () => {
  const auth = {
    method: 'POST' as const,
    path: '/v1/auth/login',
    body: '{"username":"{{user}}","password":"{{pass}}"}',
    extract: { token: 'data.accessToken' },
  };
  const [result] = generateFlowFiles(TodoModule, { auth });
  const file = result!.file;

  test('prepends a login node that extracts the token', () => {
    const first = file.nodes[0]!;
    expect(first.label).toContain('POST /v1/auth/login');
    const cfg = first.config as ApiTesterRestConfig;
    expect(cfg.method).toBe('POST');
    expect(cfg.url).toBe('/v1/auth/login');
    expect(cfg.extractors).toEqual([
      { variableName: 'token', path: '$.data.accessToken' },
    ]);
    expect(cfg.body).toContain('{{user}}');
    expect(cfg.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
      enabled: true,
    });
  });

  test('chains login → first route and shifts positions down', () => {
    expect(file.nodes[0]!.position.y).toBe(0);
    expect(file.nodes[1]!.position.y).toBe(110);
    expect(file.edges[0]!.source).toBe(file.nodes[0]!.id);
    expect(file.edges[0]!.target).toBe(file.nodes[1]!.id);
    expect(file.edges).toHaveLength(file.nodes.length - 1);
  });

  test('token is produced by login — only credentials stay editable', () => {
    const vars = file.settings?.defaultVariables ?? [];
    expect(vars.find((v) => v.key === 'token')).toBeUndefined();
    expect(vars.some((v) => v.key === 'user')).toBe(true);
    expect(vars.some((v) => v.key === 'pass')).toBe(true);
  });
});

describe('generateFlowFile — auth preamble (single file)', () => {
  const { file } = generateFlowFile(TodoModule, {
    auth: { method: 'POST', path: '/v1/auth/login', extract: { token: 'data.accessToken' } },
  });

  test('one ungrouped login node edged into the group start', () => {
    const authNode = file.nodes.find((n) => !n.groupId);
    expect(authNode).toBeDefined();
    expect(authNode!.label).toContain('POST /v1/auth/login');
    const groupFirst = file.nodes.find((n) => n.groupId);
    expect(
      file.edges.some((e) => e.source === authNode!.id && e.target === groupFirst!.id),
    ).toBe(true);
    expect(
      file.settings?.defaultVariables?.some((v) => v.key === 'token'),
    ).toBeFalsy();
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
