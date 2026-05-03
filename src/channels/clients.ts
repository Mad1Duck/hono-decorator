import type { ChannelClient, SseStreamLike, WsLike } from './types';

/* ================= SSE CLIENT ================= */

export class SseChannelClient implements ChannelClient {
  constructor(
    public readonly id: string,
    private readonly stream: SseStreamLike
  ) {}

  async send(event: string, data: unknown): Promise<void> {
    await this.stream.writeSSE({ event, data: JSON.stringify(data) });
  }

  isAlive(): boolean {
    return !this.stream.closed;
  }
}

/* ================= WEBSOCKET CLIENT ================= */

export class WsChannelClient implements ChannelClient {
  constructor(
    public readonly id: string,
    private readonly ws: WsLike
  ) {}

  async send(event: string, data: unknown): Promise<void> {
    this.ws.send(JSON.stringify({ event, data }));
  }

  isAlive(): boolean {
    return this.ws.readyState === 1; // 1 = OPEN
  }
}
