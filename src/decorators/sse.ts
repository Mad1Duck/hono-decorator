import 'reflect-metadata';

import { METADATA_KEYS } from './metadata';
import { Get } from './controller';

/**
 * Marks a GET route as an SSE (Server-Sent Events) endpoint.
 * The handler receives a streaming API object via @SseStream().
 *
 * @example
 * @Sse('/events')
 * async events(@SseStream() stream: SSEStreamingApi) {
 *   await stream.writeSSE({ data: 'hello', event: 'message' });
 * }
 */
export function Sse(path = ''): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ) => {
    Reflect.defineMetadata(METADATA_KEYS.SSE_ROUTE, true, target, propertyKey);
    return Get(path)(target, propertyKey, descriptor);
  };
}
