# Task 58 — `@OnWsMessage` per-message routing

**Status:** done

## Goal

Socket.IO-style multiplexing: route incoming WS frames to different handler
methods by event name within a single connection — today every frame hits
one `onMessage` callback.

## Implementation

- `src/decorators/metadata.ts` — `WS_MESSAGE` key
  (`Symbol.for('hono-forge.wsMessage')`).
- `src/decorators/websocket.ts` — `@OnWsMessage('event')` maps sibling
  method names → event names on the controller class.
- `src/core/route-builder.ts` — `@WebSocket` handler wraps the returned
  `onMessage`: text frames parsed as JSON envelopes `{ event, data }`
  dispatch to matching methods as `(data, ws, rawEvent)`; non-JSON frames,
  missing `event`, and unmatched events fall through to the user's own
  `onMessage`. Composes with `@ChannelRoute` (open/close wrapping is
  orthogonal).

## Tests

`tests/production.test.ts` — fake upgrader captures the events object;
JSON envelope dispatch, unmatched event fallback, non-JSON fallback,
multi-handler routing.
