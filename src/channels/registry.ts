import type { ChannelAdapter, ChannelClient } from './types';
import { InMemoryChannelAdapter } from './memory.adapter';

/**
 * Singleton registry that proxies to the configured adapter.
 * Defaults to InMemoryChannelAdapter — swap to RedisChannelAdapter for multi-instance.
 *
 * @example
 * // startup (single instance):
 * import { channels } from 'hono-decorators';
 * // default in-memory, nothing to configure
 *
 * // startup (multi instance):
 * import { channels, RedisChannelAdapter } from 'hono-decorators';
 * channels.use(new RedisChannelAdapter(pubClient, subClient));
 *
 * // in controller:
 * const client = new SseChannelClient(userId, stream);
 * await channels.subscribe(`user:${userId}`, client);
 * stream.onAbort(() => channels.unsubscribe(`user:${userId}`, userId));
 *
 * // push from anywhere:
 * await channels.publish(`user:${userId}`, 'order.created', { id: 123 });
 */
export class ChannelRegistry {
  private adapter: ChannelAdapter = new InMemoryChannelAdapter();

  /**
   * Swap the underlying adapter (call once at startup before any connections).
   */
  use(adapter: ChannelAdapter): void {
    this.adapter = adapter;
  }

  subscribe(channel: string, client: ChannelClient): Promise<void> {
    return this.adapter.subscribe(channel, client);
  }

  unsubscribe(channel: string, clientId: string): Promise<void> {
    return this.adapter.unsubscribe(channel, clientId);
  }

  /**
   * Publish an event to all subscribers of the channel.
   * With RedisChannelAdapter this broadcasts across all instances.
   */
  publish(channel: string, event: string, data: unknown): Promise<void> {
    return this.adapter.publish(channel, event, data);
  }

  close(): Promise<void> {
    return this.adapter.close();
  }
}

export const channels = new ChannelRegistry();
