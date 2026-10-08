/**
 * todo-api — a realistic hono-forge application.
 *
 * Run:  bun examples/todo-api/index.ts
 * Then: GET  http://localhost:3000/docs        (interactive Scalar docs)
 *       GET  http://localhost:3000/health      (liveness)
 *       GET  http://localhost:3000/todos       (list)
 *       POST http://localhost:3000/todos       (create — needs a Bearer token)
 */
import type { Context } from 'hono';
import { z } from 'zod';
import {
  Body, channels, Controller, createApp, events, Get, HonoRouteBuilder,
  Injectable, Interval, Module, OnEvent, Param, Params, Post, Public,
  Query, RateLimit, RequireAuth, Sse, ChannelRoute, Status, startEventBus,
  startScheduler, User, Validate,
} from '../../src';

/* ---------------- Schemas (single source of truth: validation + docs) ---------------- */

const CreateTodoSchema = z.object({
  title: z.string().min(1).max(200),
  done: z.boolean().default(false),
});

const ListQuerySchema = z.object({
  done: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const TodoParamsSchema = z.object({ id: z.string().uuid() });

interface Todo { id: string; title: string; done: boolean; }

/* ---------------- Services ---------------- */

@Injectable()
class TodoService {
  private todos = new Map<string, Todo>();

  list(filter: { done?: boolean; limit: number }) {
    let all = [...this.todos.values()];
    if (filter.done !== undefined) all = all.filter((t) => t.done === filter.done);
    return all.slice(0, filter.limit);
  }

  async create(input: z.infer<typeof CreateTodoSchema>) {
    const todo: Todo = { id: crypto.randomUUID(), ...input };
    this.todos.set(todo.id, todo);
    await events.emit('todo.created', todo); // SSE feed + job listeners react
    return todo;
  }

  get(id: string) { return this.todos.get(id); }
}

/** Listens to domain events — resolved through DI when the event fires. */
@Injectable()
class TodoEvents {
  @OnEvent('todo.created')
  async onCreated(todo: Todo) {
    console.log(`[event] todo.created: "${todo.title}"`);
    // Bridge domain events onto the 'todos' channel → live SSE feed
    await channels.publish('todos', 'todo.created', todo);
  }
}

/** Periodic job — ticks while the scheduler runs, overlap-safe. */
@Injectable()
class Janitor {
  @Interval(60_000)
  sweep() {
    console.log('[job] janitor tick');
  }
}

/* ---------------- Controller ---------------- */

@Controller('/todos')
@Injectable([TodoService])
class TodoController {
  constructor(private svc: TodoService) {}

  @Get()
  @Public()
  @Validate({ query: ListQuerySchema })
  list(c: Context) {
    const q = Query<z.infer<typeof ListQuerySchema>>(c); // already validated+coerced
    return this.svc.list(q);
  }

  @Post()
  @RequireAuth()
  @RateLimit({ max: 10, windowMs: 60_000 })
  @Status(201)
  @Validate({ body: CreateTodoSchema })
  async create(c: Context) {
    const body = await Body<z.infer<typeof CreateTodoSchema>>(c); // already parsed
    const user = User<{ sub: string }>(c);
    console.log(`todo created by ${user.sub}`);
    return this.svc.create(body);
  }

  @Get('/:id')
  @Public()
  @Validate({ params: TodoParamsSchema })
  getOne(c: Context) {
    const { id } = Params<z.infer<typeof TodoParamsSchema>>(c);
    const todo = this.svc.get(id);
    if (!todo) return c.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Todo not found' } }, 404);
    return todo;
  }
}

/** Live feed — every 'todo' channel event streams to connected browsers. */
@Controller('/feed')
class FeedController {
  @Sse('/', { keepAliveMs: 15_000 })
  @Public()
  @ChannelRoute('todos')
  async feed() { /* subscribe + hold-open handled by @ChannelRoute */ }
}

/* ---------------- App ---------------- */

@Module({
  controllers: [TodoController, FeedController],
  providers: [TodoService, TodoEvents, Janitor],
})
class AppModule {}

// Auth: plug your token verification here (or use @JwtAuth for turnkey JWT)
HonoRouteBuilder.configure({
  guardExecutor: async (c) => {
    const token = c.req.header('authorization')?.replace('Bearer ', '');
    if (!token) throw new Error('Unauthorized: missing token');
    c.set('user', { sub: 'demo-user' });
    return true;
  },
});

const stopEvents = startEventBus(AppModule);
const stopJobs = startScheduler(AppModule);

const app = createApp(AppModule, {
  health: { checks: { todos: () => true } },
  openapi: { info: { title: 'Todo API', version: '1.0.0' } },
  printRoutes: true,
  shutdown: {
    onShutdown: async () => { stopEvents(); stopJobs(); },
  },
});

export default {
  port: 3000,
  fetch: app.fetch,
};
