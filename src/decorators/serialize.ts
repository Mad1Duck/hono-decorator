import type { ZodType } from 'zod';
import { METADATA_KEYS } from './metadata';

type MethodDec = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassOrMethodDec = (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void;

/**
 * Run the handler return through a Zod schema before sending the response —
 * useful for stripping internal fields (omit/pick) or coercing output shape.
 * The parsed value replaces the original result.
 */
export function Serialize(schema: ZodType): ClassOrMethodDec {
  return (_value, context) => {
    const all = (context.metadata[METADATA_KEYS.SERIALIZE] as Record<string, ZodType> | undefined) ?? {};
    if (context.kind === 'class') {
      context.metadata[METADATA_KEYS.SERIALIZE] = { '*': schema };
    } else {
      all[String(context.name)] = schema;
      context.metadata[METADATA_KEYS.SERIALIZE] = all;
    }
  };
}
