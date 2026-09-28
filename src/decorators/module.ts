import { METADATA_KEYS } from './metadata';
import type { ModuleMetadata } from './metadata';

/**
 * Group controllers and providers into a module. Modules can import other
 * modules; `HonoRouteBuilder.buildModule(AppModule)` builds every controller
 * reachable through the import graph and eagerly resolves `providers` for
 * fail-fast DI validation at startup.
 *
 * Note: providers are registered in the shared container — modules organize
 * wiring, they do not create isolated scopes. Global `configure()` options
 * still apply to all routes.
 *
 * @example
 * @Module({
 *   imports: [SharedModule],
 *   controllers: [UserController],
 *   providers: [UserService],
 * })
 * class UserModule {}
 *
 * const app = HonoRouteBuilder.buildModule(UserModule);
 */
export function Module(metadata: ModuleMetadata) {
  return (_value: Function, context: ClassDecoratorContext) => {
    context.metadata[METADATA_KEYS.MODULE] = metadata;
  };
}
