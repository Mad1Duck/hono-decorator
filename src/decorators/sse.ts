import { METADATA_KEYS } from './metadata';
import { Get } from './controller';

export interface SseOptions {
  /**
   * Send a `:keepalive` SSE comment every N milliseconds while the stream is
   * open. Prevents intermediaries (nginx, cloudflared, AWS ALB ~60s) from
   * closing idle connections. Recommended: 15_000.
   */
  keepAliveMs?: number;
}

/**
 * Marks a GET route as an SSE (Server-Sent Events) endpoint.
 * The handler receives `(c: Context, stream: SSEStreamingApi)` as arguments.
 *
 * @example
 * @Sse('/events', { keepAliveMs: 15_000 })
 * async events(c: Context, stream: SSEStreamingApi) {
 *   await stream.writeSSE({ data: 'hello', event: 'message' });
 * }
 */
export function Sse(path = '', options: SseOptions = {}): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (value, context) => {
    const all = (context.metadata[METADATA_KEYS.SSE_ROUTE] as Record<string, SseOptions> | undefined) ?? {};
    all[String(context.name)] = options;
    context.metadata[METADATA_KEYS.SSE_ROUTE] = all;
    Get(path)(value, context);
  };
}
