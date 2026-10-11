import type { Context } from 'hono';
import { METADATA_KEYS } from './metadata';
import type { ChannelAuthorizeFn } from './metadata';

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

/**
 * Authorize the resolved `@ChannelRoute` channel before subscribing —
 * the channel equivalent of a guard. Runs as middleware *before* the SSE
 * stream opens or the WebSocket upgrade completes, so a denied request
 * gets a clean `403` (never a connect-then-close).
 *
 * The callback receives the request context and the resolved channel name;
 * return `false`/`throw` to deny. Combine with your auth middleware —
 * `@JwtAuth`/`c.get('user')` are populated by the time this runs.
 *
 * @example
 * @WebSocket('/kds/:outletId/:station')
 * @ChannelRoute((c) => `outlet:${Param(c, 'outletId')}:kds:${Param(c, 'station')}`)
 * @ChannelAuth((c, channel) => User(c)?.outletIds?.includes(Param(c, 'outletId')))
 * kds(c: Context) { return {}; }
 */
export function ChannelAuth(authorize: (c: Context, channel: string) => boolean | Promise<boolean>) {
  return (_value: Function, context: ClassMethodDecoratorContext) => {
    const all = (context.metadata[METADATA_KEYS.CHANNEL_AUTH] as Record<string, ChannelAuthorizeFn> | undefined) ?? {};
    all[String(context.name)] = authorize;
    context.metadata[METADATA_KEYS.CHANNEL_AUTH] = all;
  };
}
