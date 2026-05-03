import type { ChannelAdapter, ChannelClient, RedisPubClient, RedisSubClient } from './types';

/**
 * Redis-backed channel adapter for multi-instance deployments.
 *
 * Each server instance maintains a local map of connected clients.
 * Messages are published to Redis and every instance pushes to its own
 * local subscribers, so broadcasts work across the cluster.
 *
 * @example
 * import Redis from 'ioredis';
 * const pub = new Redis();
 * const sub = new Redis();
 * HonoRouteBuilder.configure({ ... });
 * channels.use(new RedisChannelAdapter(pub, sub));
 */
export class RedisChannelAdapter implements ChannelAdapter {
  /** channel → local clients on THIS instance */
  private localClients = new Map<string, Set<ChannelClient>>();

  constructor(
    private readonly pub: RedisPubClient,
    private readonly sub: RedisSubClient
  ) {
    this.sub.on('message', (channel, message) => {
      void this.handleMessage(channel, message);
    });
  }

  private async handleMessage(channel: string, message: string): Promise<void> {
    const clients = this.localClients.get(channel);
    if (!clients) return;

    let parsed: { event: string; data: unknown };
    try {
      parsed = JSON.parse(message) as { event: string; data: unknown };
    } catch {
      return;
    }

    const dead: ChannelClient[] = [];

    for (const client of clients) {
      if (client.isAlive()) {
        await client.send(parsed.event, parsed.data);
      } else {
        dead.push(client);
      }
    }

    for (const client of dead) {
      clients.delete(client);
    }
  }

  async subscribe(channel: string, client: ChannelClient): Promise<void> {
    const isNew = !this.localClients.has(channel);
    if (isNew) {
      this.localClients.set(channel, new Set());
      await this.sub.subscribe(channel);
    }
    this.localClients.get(channel)!.add(client);
  }

  async unsubscribe(channel: string, clientId: string): Promise<void> {
    const clients = this.localClients.get(channel);
    if (!clients) return;

    for (const client of clients) {
      if (client.id === clientId) {
        clients.delete(client);
        break;
      }
    }

    if (clients.size === 0) {
      this.localClients.delete(channel);
      await this.sub.unsubscribe(channel);
    }
  }

  /**
   * Publish to Redis — all instances (including this one) will receive it
   * and push to their local subscribers.
   */
  async publish(channel: string, event: string, data: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify({ event, data }));
  }

  async close(): Promise<void> {
    this.localClients.clear();
    await this.sub.quit();
    await this.pub.quit();
  }
}
