import { describe, it, expect, beforeEach } from 'bun:test';
import {
  InMemoryChannelAdapter,
  RedisChannelAdapter,
  SseChannelClient,
  WsChannelClient,
  ChannelRegistry,
} from '../src';
import type { ChannelClient, RedisPubClient, RedisSubClient } from '../src';

/* ================= MOCKS ================= */

function makeSseStream(closed = false) {
  const sent: Array<{ event?: string; data: string }> = [];
  return {
    stream: {
      writeSSE: async (d: { event?: string; data: string }) => { sent.push(d); },
      closed,
    },
    sent,
  };
}

function makeWs(readyState = 1) {
  const sent: string[] = [];
  return {
    ws: { send: (d: string) => { sent.push(d); }, readyState },
    sent,
  };
}

function makeClient(id: string, alive = true): ChannelClient & { _msgs: Array<{ event: string; data: unknown }> } {
  const msgs: Array<{ event: string; data: unknown }> = [];
  return {
    id,
    send: async (event, data) => { msgs.push({ event, data }); },
    isAlive: () => alive,
    _msgs: msgs,
  } as ChannelClient & { _msgs: typeof msgs };
}

/* ================= SSE CLIENT ================= */

describe('SseChannelClient', () => {
  it('sends event as SSE format', async () => {
    const { stream, sent } = makeSseStream();
    const client = new SseChannelClient('u1', stream);
    await client.send('order.created', { id: 1 });
    expect(sent[0]?.event).toBe('order.created');
    expect(JSON.parse(sent[0]?.data ?? '')).toEqual({ id: 1 });
  });

  it('isAlive() reflects stream.closed', () => {
    const open = new SseChannelClient('u1', makeSseStream(false).stream);
    const closed = new SseChannelClient('u2', makeSseStream(true).stream);
    expect(open.isAlive()).toBe(true);
    expect(closed.isAlive()).toBe(false);
  });
});

/* ================= WS CLIENT ================= */

describe('WsChannelClient', () => {
  it('sends JSON with event and data', async () => {
    const { ws, sent } = makeWs();
    const client = new WsChannelClient('u1', ws);
    await client.send('chat.message', { text: 'hello' });
    const parsed = JSON.parse(sent[0] ?? '');
    expect(parsed.event).toBe('chat.message');
    expect(parsed.data).toEqual({ text: 'hello' });
  });

  it('isAlive() is true when readyState === 1', () => {
    expect(new WsChannelClient('u1', makeWs(1).ws).isAlive()).toBe(true);
    expect(new WsChannelClient('u2', makeWs(3).ws).isAlive()).toBe(false);
  });
});

/* ================= IN-MEMORY ADAPTER ================= */

describe('InMemoryChannelAdapter', () => {
  let adapter: InMemoryChannelAdapter;

  beforeEach(() => { adapter = new InMemoryChannelAdapter(); });

  it('subscribes a client to a channel', async () => {
    await adapter.subscribe('room:a', makeClient('u1'));
    expect(adapter.subscriberCount('room:a')).toBe(1);
  });

  it('publishes to all subscribers', async () => {
    const c1 = makeClient('u1') as ChannelClient & { _msgs: Array<{ event: string; data: unknown }> };
    const c2 = makeClient('u2') as ChannelClient & { _msgs: Array<{ event: string; data: unknown }> };
    await adapter.subscribe('room:a', c1);
    await adapter.subscribe('room:a', c2);
    await adapter.publish('room:a', 'msg', { text: 'hi' });
    expect((c1 as { _msgs: unknown[] })._msgs).toHaveLength(1);
    expect((c2 as { _msgs: unknown[] })._msgs).toHaveLength(1);
  });

  it('does not publish to other channels', async () => {
    const c1 = makeClient('u1') as ChannelClient & { _msgs: unknown[] };
    await adapter.subscribe('room:a', c1);
    await adapter.publish('room:b', 'msg', {});
    expect(c1._msgs).toHaveLength(0);
  });

  it('unsubscribes a client', async () => {
    const client = makeClient('u1');
    await adapter.subscribe('room:a', client);
    await adapter.unsubscribe('room:a', 'u1');
    expect(adapter.subscriberCount('room:a')).toBe(0);
  });

  it('removes channel when last subscriber leaves', async () => {
    await adapter.subscribe('room:a', makeClient('u1'));
    await adapter.unsubscribe('room:a', 'u1');
    expect(adapter.subscriberCount('room:a')).toBe(0);
  });

  it('skips dead clients and removes them during publish', async () => {
    const alive = makeClient('u1', true);
    const dead = makeClient('u2', false);
    await adapter.subscribe('room:a', alive);
    await adapter.subscribe('room:a', dead);
    await adapter.publish('room:a', 'msg', {});
    expect(adapter.subscriberCount('room:a')).toBe(1);
  });

  it('multiple clients same channel get separate events', async () => {
    const c1 = makeClient('u1') as ChannelClient & { _msgs: Array<{ event: string }> };
    const c2 = makeClient('u2') as ChannelClient & { _msgs: Array<{ event: string }> };
    await adapter.subscribe('room:a', c1);
    await adapter.subscribe('room:a', c2);
    await adapter.publish('room:a', 'ping', {});
    await adapter.publish('room:a', 'pong', {});
    expect(c1._msgs).toHaveLength(2);
    expect(c1._msgs[0]?.event).toBe('ping');
    expect(c1._msgs[1]?.event).toBe('pong');
  });

  it('close() clears all channels', async () => {
    await adapter.subscribe('room:a', makeClient('u1'));
    await adapter.subscribe('room:b', makeClient('u2'));
    await adapter.close();
    expect(adapter.subscriberCount('room:a')).toBe(0);
    expect(adapter.subscriberCount('room:b')).toBe(0);
  });
});

/* ================= REDIS ADAPTER ================= */

describe('RedisChannelAdapter', () => {
  function makeRedisMock() {
    let messageListener: ((ch: string, msg: string) => void) | null = null;
    const published: Array<{ channel: string; message: string }> = [];
    const subscribed: string[] = [];

    const pub: RedisPubClient = {
      publish: async (channel, message) => { published.push({ channel, message }); return 0; },
      quit: async () => 'OK',
    };

    const sub: RedisSubClient = {
      subscribe: async (...channels) => { subscribed.push(...channels); },
      unsubscribe: async () => {},
      on: (_event, listener) => { messageListener = listener; return sub; },
      quit: async () => 'OK',
    };

    const trigger = (channel: string, message: string) => messageListener?.(channel, message);

    return { pub, sub, published, subscribed, trigger };
  }

  it('publishes to Redis pub client', async () => {
    const { pub, sub, published } = makeRedisMock();
    const adapter = new RedisChannelAdapter(pub, sub);
    await adapter.subscribe('room:a', makeClient('u1'));
    await adapter.publish('room:a', 'msg', { text: 'hi' });
    expect(published[0]?.channel).toBe('room:a');
    expect(JSON.parse(published[0]?.message ?? '')).toMatchObject({ event: 'msg' });
  });

  it('subscribes to Redis channel on first local subscriber', async () => {
    const { pub, sub, subscribed } = makeRedisMock();
    const adapter = new RedisChannelAdapter(pub, sub);
    await adapter.subscribe('room:a', makeClient('u1'));
    expect(subscribed).toContain('room:a');
  });

  it('delivers Redis message to local subscribers', async () => {
    const { pub, sub, trigger } = makeRedisMock();
    const adapter = new RedisChannelAdapter(pub, sub);
    const client = makeClient('u1') as ChannelClient & { _msgs: Array<{ event: string }> };
    await adapter.subscribe('room:a', client);
    trigger('room:a', JSON.stringify({ event: 'ping', data: {} }));
    await Promise.resolve(); // flush microtasks
    expect(client._msgs[0]?.event).toBe('ping');
  });

  it('ignores malformed Redis messages', async () => {
    const { pub, sub, trigger } = makeRedisMock();
    const adapter = new RedisChannelAdapter(pub, sub);
    const client = makeClient('u1') as ChannelClient & { _msgs: unknown[] };
    await adapter.subscribe('room:a', client);
    trigger('room:a', 'not-json{{');
    await Promise.resolve();
    expect(client._msgs).toHaveLength(0);
  });
});

/* ================= CHANNEL REGISTRY ================= */

describe('ChannelRegistry', () => {
  it('uses InMemoryChannelAdapter by default', async () => {
    const registry = new ChannelRegistry();
    const client = makeClient('u1') as ChannelClient & { _msgs: Array<{ event: string }> };
    await registry.subscribe('ch', client);
    await registry.publish('ch', 'test', {});
    expect(client._msgs[0]?.event).toBe('test');
  });

  it('can swap adapter with use()', async () => {
    const registry = new ChannelRegistry();
    const custom: InMemoryChannelAdapter = new InMemoryChannelAdapter();
    registry.use(custom);
    const client = makeClient('u1');
    await registry.subscribe('ch', client);
    expect(custom.subscriberCount('ch')).toBe(1);
  });

  it('unsubscribe removes the client', async () => {
    const registry = new ChannelRegistry();
    const adapter = new InMemoryChannelAdapter();
    registry.use(adapter);
    await registry.subscribe('ch', makeClient('u1'));
    await registry.unsubscribe('ch', 'u1');
    expect(adapter.subscriberCount('ch')).toBe(0);
  });
});

/* ================= REDIS INTEGRATION (loopback pair) ================= */

/**
 * Realistic loopback Redis pair: pub.publish serializes and asynchronously
 * delivers to sub 'message' listeners — exercising the full
 * subscribe → JSON roundtrip → delivery → unsubscribe path without mocks.
 */
function makeLoopbackRedis() {
  const handlers = new Set<(channel: string, message: string) => void>();
  const subscribed = new Set<string>();

  const pub: RedisPubClient = {
    publish: async (channel, message) => {
      // Deliver on a microtask tick like a real connection would.
      queueMicrotask(() => {
        if (!subscribed.has(channel)) return;
        for (const h of handlers) h(channel, message);
      });
      return 1;
    },
    quit: async () => 'OK',
  };

  const sub: RedisSubClient = {
    subscribe: async (...channels) => {
      channels.forEach((ch) => subscribed.add(ch));
      return subscribed.size;
    },
    unsubscribe: async (...channels) => {
      channels.forEach((ch) => subscribed.delete(ch));
      return subscribed.size;
    },
    on(event, listener) {
      if (event === 'message') handlers.add(listener);
      return this;
    },
    quit: async () => 'OK',
  };

  return { pub, sub, subscribed };
}

describe('RedisChannelAdapter (loopback integration)', () => {
  it('delivers a published message through the full JSON roundtrip', async () => {
    const { pub, sub } = makeLoopbackRedis();
    const adapter = new RedisChannelAdapter(pub, sub);
    const client = makeClient('c1');

    await adapter.subscribe('orders', client);
    await adapter.publish('orders', 'order.created', { id: 42 });
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks

    expect(client._msgs).toEqual([{ event: 'order.created', data: { id: 42 } }]);
  });

  it('does not deliver to channels that were never subscribed at Redis level', async () => {
    const { pub, sub, subscribed } = makeLoopbackRedis();
    const adapter = new RedisChannelAdapter(pub, sub);
    const client = makeClient('c1');

    await adapter.subscribe('orders', client);
    subscribed.delete('orders'); // simulate Redis-side drop
    await adapter.publish('orders', 'order.created', { id: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(client._msgs).toHaveLength(0);
  });

  it('unsubscribes from Redis when the last local client leaves', async () => {
    const { pub, sub, subscribed } = makeLoopbackRedis();
    const adapter = new RedisChannelAdapter(pub, sub);
    const c1 = makeClient('c1');
    const c2 = makeClient('c2');

    await adapter.subscribe('orders', c1);
    await adapter.subscribe('orders', c2);
    expect(subscribed.has('orders')).toBe(true);

    await adapter.unsubscribe('orders', 'c1');
    expect(subscribed.has('orders')).toBe(true); // c2 still there

    await adapter.unsubscribe('orders', 'c2');
    expect(subscribed.has('orders')).toBe(false); // channel drained
  });

  it('multi-instance broadcast: pub on adapter A reaches clients of adapter B', async () => {
    const { pub, sub, subscribed } = makeLoopbackRedis();
    const adapterA = new RedisChannelAdapter(pub, sub);
    // Second "instance" shares the same Redis connection pair semantics —
    // model it with a second sub handler on the same bus.
    const adapterB = new RedisChannelAdapter(pub, sub);
    const clientB = makeClient('b1');

    await adapterB.subscribe('orders', clientB);
    await adapterA.publish('orders', 'order.shipped', { id: 7 });
    await new Promise((r) => setTimeout(r, 0));

    expect(clientB._msgs).toEqual([{ event: 'order.shipped', data: { id: 7 } }]);
  });
});
