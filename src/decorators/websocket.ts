import { METADATA_KEYS } from './metadata';
import { Get } from './controller';

/**
 * Marks a GET route as a WebSocket endpoint.
 * The handler receives `(c: Context)` and should return a WebSocket event-handlers object.
 *
 * @example
 * // configure once at startup:
 * import { upgradeWebSocket } from 'hono/bun';
 * HonoRouteBuilder.configure({ webSocketUpgrader: upgradeWebSocket });
 *
 * // in controller:
 * @WebSocket('/chat')
 * chat(c: Context) {
 *   return {
 *     onMessage(event, ws) { ws.send(`Echo: ${event.data}`); },
 *     onClose() { console.log('disconnected'); },
 *   };
 * }
 */
export function WebSocket(path = ''): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (value, context) => {
    const all = (context.metadata[METADATA_KEYS.WEBSOCKET_ROUTE] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.WEBSOCKET_ROUTE] = all;
    Get(path)(value, context);
  };
}

/**
 * Route a WebSocket message by its `event` field to a sibling method on the
 * same controller — Socket.IO-style multiplexing inside one connection.
 *
 * Incoming text frames are parsed as JSON envelopes:
 *   { "event": "<name>", "data": <payload> }
 *
 * When `parsed.event` matches, the decorated method runs as
 * `(data, ws, rawEvent)`. Non-JSON frames, messages without an `event`
 * field, and unmatched events fall through to the route's own
 * `onMessage` callback (returned by the @WebSocket handler), if any.
 *
 * @example
 * @WebSocket('/chat')
 * chat(c: Context) {
 *   return { onOpen: (_e, ws) => ws.send('welcome') };
 * }
 *
 * @OnWsMessage('join')
 * onJoin(data: { room: string }, ws) { this.rooms.join(data.room, ws); }
 *
 * @OnWsMessage('message')
 * onChat(data: { text: string }, ws) { ws.send(`Echo: ${data.text}`); }
 */
export function OnWsMessage(event: string): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.WS_MESSAGE] as Record<string, string> | undefined) ?? {};
    all[String(context.name)] = event;
    context.metadata[METADATA_KEYS.WS_MESSAGE] = all;
  };
}
