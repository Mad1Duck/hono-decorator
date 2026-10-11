import { METADATA_KEYS } from './metadata';

type MethodDec = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassOrMethodDec = (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void;

/** Security scheme registered once at the document level (components.securitySchemes). */
export interface SecuritySchemeSpec {
  /** HTTP scheme (bearer, basic), apiKey, oauth2, openIdConnect */
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: 'header' | 'query' | 'cookie';
  name?: string;
  description?: string;
  /** oauth2/openIdConnect fields */
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}

/**
 * Mark the route as requiring a named security scheme, e.g.
 * `@ApiSecurity('basicAuth')`. The scheme must also be declared with
 * `@ApiSecurityScheme('basicAuth', { type: 'http', scheme: 'basic' })` on the
 * controller or module. Bearer JWT via `@JwtAuth`/`@RequireAuth` is inferred
 * automatically and does not need this decorator.
 */
export function ApiSecurity(name: string): MethodDec {
  return (_value, context) => {
    const methodName = String(context.name);
    const all = (context.metadata[METADATA_KEYS.SECURITY] as Record<string, string[]> | undefined) ?? {};
    all[methodName] = [...(all[methodName] ?? []), name];
    context.metadata[METADATA_KEYS.SECURITY] = all;
  };
}

/**
 * Declare a security scheme once — the OpenAPI generator emits it under
 * `components.securitySchemes` if any route uses it.
 */
export function ApiSecurityScheme(name: string, spec: SecuritySchemeSpec): ClassOrMethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.SECURITY_SCHEMES] as Record<string, SecuritySchemeSpec> | undefined) ?? {};
    all[name] = spec;
    context.metadata[METADATA_KEYS.SECURITY_SCHEMES] = all;
  };
}
