# Task 60 — In-flight request drain on shutdown

**Status:** done

## Goal

SIGTERM previously exited while plain HTTP requests were still mid-flight —
responses cut mid-write. `drainChannels` covered SSE/WS; this covers the
rest.

## Implementation

- `src/utils/shutdown.ts`
  - `RequestDrain` — middleware counts active requests; `drain(timeoutMs)`
    resolves when the count reaches zero (or the deadline passes). While
    draining, new requests get a fast `503` ("stop sending traffic" — the
    k8s contract).
  - `getRequestDrain()` / `mountDrain(app)` — process-wide drain behind
    `Symbol.for('hono-forge.requestDrain')`; mount BEFORE routes so every
    request is counted.
  - `GracefulShutdownOptions.drainRequests` (default true when mounted):
    sequence is now `onShutdown` → `drainRequests` → `channels.close()` →
    `container.shutdown()` → exit.
- `src/utils/app.ts` — `createApp` mounts the drain automatically when
  `shutdown` is enabled (opt-out via `drainRequests: false`).
- Exports via `utils/index.ts`.

Known limit, documented: non-channel `@Sse`/`@WebSocket` connections are
long-lived in-flight requests and hold the drain until `timeoutMs` — use
`@ChannelRoute` so they close cleanly instead.

## Tests

`tests/production.test.ts` — in-flight request completes during drain, new
request gets 503, active count returns to 0.
