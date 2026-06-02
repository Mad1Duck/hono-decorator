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
