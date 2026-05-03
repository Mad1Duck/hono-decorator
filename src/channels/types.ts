/* ================= CLIENT INTERFACES ================= */

/**
 * Minimal SSE stream interface. Compatible with hono/streaming SSEStreamingApi.
 */
export interface SseStreamLike {
  writeSSE(data: { event?: string; data: string }): Promise<void>;
  closed: boolean;
}

/**
 * Minimal WebSocket interface. Compatible with hono/ws WSContext.
 */
export interface WsLike {
  send(data: string): void;
  readyState: number;
}

/* ================= CHANNEL CLIENT ================= */

export interface ChannelClient {
  /** Unique client identifier (e.g. userId, connectionId). */
  id: string;
  send(event: string, data: unknown): Promise<void>;
  isAlive(): boolean;
}

/* ================= ADAPTER INTERFACE ================= */

export interface ChannelAdapter {
  subscribe(channel: string, client: ChannelClient): Promise<void>;
  unsubscribe(channel: string, clientId: string): Promise<void>;
  publish(channel: string, event: string, data: unknown): Promise<void>;
  close(): Promise<void>;
}

/* ================= REDIS CLIENT INTERFACES ================= */

/** Minimal publisher interface — compatible with ioredis, node-redis, etc. */
export interface RedisPubClient {
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

/** Minimal subscriber interface — must be a dedicated connection (ioredis sub mode). */
export interface RedisSubClient {
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): this;
  quit(): Promise<unknown>;
}
