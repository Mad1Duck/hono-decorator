import type { ChannelAdapter, ChannelClient } from './types';

export class InMemoryChannelAdapter implements ChannelAdapter {
  private channels = new Map<string, Set<ChannelClient>>();

  async subscribe(channel: string, client: ChannelClient): Promise<void> {
    let clients = this.channels.get(channel);
    if (!clients) {
      clients = new Set();
      this.channels.set(channel, clients);
    }
    clients.add(client);
  }

  async unsubscribe(channel: string, clientId: string): Promise<void> {
    const clients = this.channels.get(channel);
    if (!clients) return;

    for (const client of clients) {
      if (client.id === clientId) {
        clients.delete(client);
        break;
      }
    }

    if (clients.size === 0) {
      this.channels.delete(channel);
    }
  }

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    const clients = this.channels.get(channel);
    if (!clients) return;

    const dead: ChannelClient[] = [];

    for (const client of clients) {
      if (client.isAlive()) {
        await client.send(event, data);
      } else {
        dead.push(client);
      }
    }

    for (const client of dead) {
      clients.delete(client);
    }

    if (clients.size === 0) {
      this.channels.delete(channel);
    }
  }

  async close(): Promise<void> {
    this.channels.clear();
  }

  /** Exposed for testing/debugging. */
  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}
