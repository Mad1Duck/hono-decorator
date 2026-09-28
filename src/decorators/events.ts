import { METADATA_KEYS } from './metadata';
import type { OnEventMetadata } from './metadata';

/**
 * Subscribe a service method to an in-process event. Repeatable — decorate
 * twice to listen to multiple events. Supports `prefix.*` wildcards:
 * `@OnEvent('user.*')` receives `user.created`, `user.deleted`, ...
 *
 * The class must be registered via `startEventBus([...])` (or reachable from
 * an `@Module` passed to it) for the subscription to activate. The instance is
 * resolved through the DI container on every emit, so `@Singleton`/`@Injectable`
 * work as usual.
 *
 * @example
 * @Injectable()
 * class MailService {
 *   @OnEvent('user.created')
 *   async sendWelcome(payload: { id: string }) { ... }
 * }
 */
export function OnEvent(event: string): (value: Function, context: ClassMethodDecoratorContext) => void {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.ON_EVENT] as Record<string, OnEventMetadata> | undefined) ?? {};
    const methods = all[String(context.name)] ?? [];
    if (!methods.includes(event)) methods.push(event);
    all[String(context.name)] = methods;
    context.metadata[METADATA_KEYS.ON_EVENT] = all;
  };
}
