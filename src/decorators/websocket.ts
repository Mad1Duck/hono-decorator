import 'reflect-metadata';

import { METADATA_KEYS } from './metadata';
import { Get } from './controller';

/**
 * Marks a GET route as a WebSocket endpoint.
 * The handler should return a WebSocket event-handlers object.
 * Requires `webSocketUpgrader` to be configured via HonoRouteBuilder.configure().
 *
 * @example
 * // configure once at startup:
 * import { upgradeWebSocket } from 'hono/bun';
 * HonoRouteBuilder.configure({ webSocketUpgrader: upgradeWebSocket });
 *
 * // in controller:
 * @WebSocket('/chat')
 * chat(@Req() c: Context) {
 *   return {
 *     onMessage(event, ws) { ws.send(`Echo: ${event.data}`); },
 *     onClose() { console.log('disconnected'); },
 *   };
 * }
 */
export function WebSocket(path = ''): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata(METADATA_KEYS.WEBSOCKET_ROUTE, true, target, propertyKey);
    return Get(path)(target, propertyKey, descriptor);
  };
}
