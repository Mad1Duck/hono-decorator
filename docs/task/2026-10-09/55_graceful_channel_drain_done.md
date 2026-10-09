# Task 55 — Graceful shutdown drains channel transports

**Status:** done

## Goal

SIGTERM previously cleared subscriber maps without closing live transports —
SSE streams and WebSocket connections were dropped abruptly.

## Implementation

- `src/channels/types.ts` — optional `close()` on `SseStreamLike`,
  `WsLike`, and `ChannelClient`.
- `src/channels/clients.ts` — `SseChannelClient.close()` →
  `stream.close?.()`; `WsChannelClient.close()` → `ws.close?.(1001,
  'server shutting down')` (WS "going away").
- `src/channels/memory.adapter.ts` + `redis.adapter.ts` — `close()` now
  calls every client's `close?.()` (best-effort, errors swallowed) before
  clearing maps; Redis then quits sub/pub connections.
- `src/utils/shutdown.ts` — `gracefulShutdown` option `drainChannels`
  (default `true`): sequence is `onShutdown()` → `channels.close()` →
  `container.shutdown()` → exit.

## Tests

`tests/production.test.ts` — registry close invokes every client `close()`
and empties all channel maps.
