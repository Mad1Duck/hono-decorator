import { METADATA_KEYS } from './metadata';
import { Get } from './controller';

/**
 * Marks a GET route as an SSE (Server-Sent Events) endpoint.
 * The handler receives `(c: Context, stream: SSEStreamingApi)` as arguments.
 *
 * @example
 * @Sse('/events')
 * async events(c: Context, stream: SSEStreamingApi) {
 *   await stream.writeSSE({ data: 'hello', event: 'message' });
 * }
 */
export function Sse(path = ''): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (value, context) => {
    const all = (context.metadata[METADATA_KEYS.SSE_ROUTE] as Record<string, boolean> | undefined) ?? {};
    all[String(context.name)] = true;
    context.metadata[METADATA_KEYS.SSE_ROUTE] = all;
    Get(path)(value, context);
  };
}
