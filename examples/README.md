# Examples

Runnable example applications for **hono-forge**. These import from `../src` —
no build step needed.

## todo-api

A realistic app exercising most of the framework surface:

- `@Module` + `createApp` one-call bootstrap (routes + `/health` + `/docs` + graceful shutdown)
- `@Validate` — one schema drives both validation and the OpenAPI spec
- DI (`@Injectable` tokens), guards (`guardExecutor`), `@RateLimit`
- `@Sse` + `@ChannelRoute` live feed bridged from `@OnEvent` domain events
- `@Interval` scheduled job via `startScheduler`

```bash
bun examples/todo-api/index.ts
```

Then:

```bash
open http://localhost:3000/docs     # Scalar UI
curl http://localhost:3000/health   # {"status":"ok","uptime":...}
curl "http://localhost:3000/todos?limit=10"
curl -X POST http://localhost:3000/todos \
  -H 'authorization: Bearer demo' \
  -H 'content-type: application/json' \
  -d '{"title":"ship hono-forge"}'
```
