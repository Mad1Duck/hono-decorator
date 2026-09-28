import { HttpException } from '../core/http-exception';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/** Thrown when a circuit is open — a 503 that propagates cleanly through the route error pipeline. */
export class CircuitOpenError extends HttpException {
  constructor(methodName: string) {
    super(503, `Circuit open — '${methodName}' temporarily unavailable`, {
      code: 'CIRCUIT_OPEN',
    });
    this.name = 'CircuitOpenError';
  }
}

interface CircuitState {
  failures: number;
  openedAt: number;
  probing: boolean;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a single probe is allowed through. */
  resetAfterMs: number;
  /** Called when a call is rejected because the circuit is open. */
  onError?: (error: CircuitOpenError) => void;
}

/**
 * Circuit breaker for service methods — after `failureThreshold` consecutive
 * failures the circuit opens and calls fail fast with `CircuitOpenError`
 * (503) instead of piling up timeouts. After `resetAfterMs` one probe call is
 * allowed: success closes the circuit, failure re-opens it.
 *
 * State is per instance+method. Combine with `@Retry`/`@Timeout` for
 * full resilience:
 *
 * @example
 * @CircuitBreaker({ failureThreshold: 5, resetAfterMs: 30_000 })
 * async charge(amount: number) { ... }
 */
export function CircuitBreaker(options: CircuitBreakerOptions) {
  const states = new WeakMap<object, CircuitState>();

  return <T extends AnyFn>(originalFn: T, context: ClassMethodDecoratorContext): T => {
    const methodName = String(context.name);
    return (async function (this: object, ...args: unknown[]) {
      let s = states.get(this);
      if (!s) {
        s = { failures: 0, openedAt: 0, probing: false };
        states.set(this, s);
      }

      const isOpen = s.failures >= options.failureThreshold;
      if (isOpen) {
        const elapsed = Date.now() - s.openedAt;
        if (elapsed < options.resetAfterMs || s.probing) {
          const err = new CircuitOpenError(methodName);
          options.onError?.(err);
          throw err;
        }
        s.probing = true; // half-open: let one call through
      }

      try {
        const result = await (originalFn as AnyFn).apply(this, args);
        s.failures = 0;
        s.openedAt = 0;
        s.probing = false;
        return result;
      } catch (error) {
        s.failures += 1;
        s.probing = false;
        if (s.failures >= options.failureThreshold) s.openedAt = Date.now();
        throw error;
      }
    }) as unknown as T;
  };
}
