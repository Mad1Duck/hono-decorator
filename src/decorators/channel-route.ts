import type { Context } from 'hono';
import { METADATA_KEYS } from './metadata';

/**
 * Bridge a @Sse or @WebSocket route to the pub/sub channels registry.
 * On connect, a channel client is subscribed to the resolved channel and every
 * published event is pushed to the stream/socket; on disconnect it unsubscribes.
 *
 * The pattern can be static or a function of the request context.
 *
 * @example
 * @Sse('/events')
 * @ChannelRoute((c) => `user:${User(c)?.id}`)
 * async notifications(c: Context, stream: SSEStreamingApi) { }
 *
 * @WebSocket('/chat')
 * @ChannelRoute('room:general')
 * chat(c: Context) { return { onMessage(e, ws) { ... } }; }
 */
export function ChannelRoute(channel: string | ((c: Context) => string)) {
  return (_value: Function, context: ClassMethodDecoratorContext) => {
    const all = (context.metadata[METADATA_KEYS.CHANNEL_ROUTE] as Record<string, string | ((c: Context) => string)> | undefined) ?? {};
    all[String(context.name)] = channel;
    context.metadata[METADATA_KEYS.CHANNEL_ROUTE] = all;
  };
}
