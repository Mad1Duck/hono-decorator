import { container } from './container';

/**
 * Logger contract used by hono-forge internals (e.g. `@Audit`). Follows the
 * pino calling convention: `level(data, message?)`.
 */
export interface Logger {
  info?: (data: unknown, message?: string) => void;
  warn?: (data: unknown, message?: string) => void;
  error?: (data: unknown, message?: string) => void;
  debug?: (data: unknown, message?: string) => void;
}

/**
 * DI token for the application logger. Register your own implementation
 * (pino, winston, ...) via {@link registerLogger} or
 * `container.registerInstance(LOGGER, logger)`, then inject `LOGGER` like any
 * other injection token.
 */
export const LOGGER: unique symbol = Symbol('hono-forge:logger');

/** Default logger backed by `console` — used when nothing is registered. */
export class ConsoleLogger implements Logger {
  info(data: unknown, message?: string): void {
    console.info(message ?? '', data);
  }

  warn(data: unknown, message?: string): void {
    console.warn(message ?? '', data);
  }

  error(data: unknown, message?: string): void {
    console.error(message ?? '', data);
  }

  debug(data: unknown, message?: string): void {
    console.debug(message ?? '', data);
  }
}

const fallbackLogger = new ConsoleLogger();

/**
 * Resolve the registered {@link LOGGER} from the container, falling back to
 * {@link ConsoleLogger} when nothing is bound.
 */
export function getLogger(): Logger {
  if (!container.has(LOGGER)) return fallbackLogger;
  try {
    return container.resolve(LOGGER as never) as Logger;
  } catch {
    return fallbackLogger;
  }
}

/** Bind a logger instance to the {@link LOGGER} DI token. */
export function registerLogger(logger: Logger): void {
  container.registerInstance(LOGGER, logger);
}
