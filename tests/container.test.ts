import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Container,
  Injectable,
  Singleton,
  Inject,
  CircularDependencyError,
  DependencyResolutionError,
} from '../src';

/* ---- classes for simple resolve tests ---- */

@Injectable()
class SimpleDep { value = 42; }

@Injectable()
class SimpleService { constructor(public dep: SimpleDep) {} }

@Injectable()
class NodeA {}

@Injectable()
class NodeB { constructor(public a: NodeA) {} }

@Injectable()
class NodeC { constructor(public b: NodeB) {} }

@Injectable()
@Singleton()
class SingletonService { id = Math.random(); }

@Injectable()
class TransientService { id = Math.random(); }

/* ---- classes for @Inject token tests ---- */

const LOGGER_TOKEN = Symbol('logger');
const CONFIG_TOKEN = 'CONFIG_TOKEN';

@Injectable()
class SvcWithSymbolInject {
  constructor(@Inject(LOGGER_TOKEN) public logger: unknown) {}
}

@Injectable()
class SvcWithStringInject {
  constructor(@Inject(CONFIG_TOKEN) public config: unknown) {}
}

/* ---- classes for error tests ---- */

@Injectable()
class FailingDep {}

@Injectable()
class SvcThatDependsOnFailingDep {
  constructor(public dep: FailingDep) {}
}

class CircularA {}
class CircularB {}

/* ================= TESTS ================= */

describe('Container', () => {
  let c: Container;

  beforeEach(() => {
    c = new Container();
  });

  /* -------- resolve -------- */

  it('resolves a plain class', () => {
    @Injectable()
    class PlainSvc {}
    expect(c.resolve(PlainSvc)).toBeInstanceOf(PlainSvc);
  });

  it('resolves with constructor injection', () => {
    const instance = c.resolve(SimpleService);
    expect(instance.dep).toBeInstanceOf(SimpleDep);
    expect(instance.dep.value).toBe(42);
  });

  it('resolves nested dependencies', () => {
    const instance = c.resolve(NodeC);
    expect(instance.b).toBeInstanceOf(NodeB);
    expect(instance.b.a).toBeInstanceOf(NodeA);
  });

  /* -------- singleton -------- */

  it('@Singleton returns same instance on repeated resolve', () => {
    const a = c.resolve(SingletonService);
    const b = c.resolve(SingletonService);
    expect(a).toBe(b);
  });

  it('non-singleton returns different instances', () => {
    const a = c.resolve(TransientService);
    const b = c.resolve(TransientService);
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });

  /* -------- registerSingleton -------- */

  it('registerSingleton returns the exact registered instance', () => {
    class Svc {}
    const instance = new Svc();
    c.registerSingleton(Svc, instance);
    expect(c.resolve(Svc)).toBe(instance);
  });

  it('registerSingleton works with string token', () => {
    const value = { config: true };
    c.registerSingleton('MY_TOKEN', value);
    expect(c.resolve('MY_TOKEN' as never)).toBe(value);
  });

  /* -------- registerFactory -------- */

  it('registerFactory creates new instance each call', () => {
    class Svc { id = Math.random(); }
    c.registerFactory(Svc, () => new Svc());
    const a = c.resolve(Svc);
    const b = c.resolve(Svc);
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });

  /* -------- @Inject token -------- */

  it('@Inject resolves by symbol token', () => {
    const logger = { log: () => {} };
    c.registerSingleton(LOGGER_TOKEN, logger);
    const instance = c.resolve(SvcWithSymbolInject);
    expect(instance.logger as typeof logger).toBe(logger);
  });

  it('@Inject resolves by string token', () => {
    const config = { debug: true };
    c.registerSingleton(CONFIG_TOKEN, config);
    const instance = c.resolve(SvcWithStringInject);
    expect(instance.config as typeof config).toBe(config);
  });

  /* -------- has / remove / clear -------- */

  it('has() returns false for unregistered token', () => {
    class Svc {}
    expect(c.has(Svc)).toBe(false);
  });

  it('has() returns true after registerSingleton', () => {
    class Svc {}
    c.registerSingleton(Svc, new Svc());
    expect(c.has(Svc)).toBe(true);
  });

  it('has() returns true after registerFactory', () => {
    class Svc {}
    c.registerFactory(Svc, () => new Svc());
    expect(c.has(Svc)).toBe(true);
  });

  it('remove() unregisters a singleton token', () => {
    class Svc {}
    c.registerSingleton(Svc, new Svc());
    c.remove(Svc);
    expect(c.has(Svc)).toBe(false);
  });

  it('remove() unregisters a factory token', () => {
    class Svc {}
    c.registerFactory(Svc, () => new Svc());
    c.remove(Svc);
    expect(c.has(Svc)).toBe(false);
  });

  it('clear() removes all registrations', () => {
    class A {}
    class B {}
    c.registerSingleton(A, new A());
    c.registerSingleton(B, new B());
    c.clear();
    expect(c.getRegisteredTokens()).toHaveLength(0);
  });

  it('getRegisteredTokens() returns all registered tokens', () => {
    class A {}
    class B {}
    c.registerSingleton(A, new A());
    c.registerFactory(B, () => new B());
    const tokens = c.getRegisteredTokens();
    expect(tokens).toContain(A);
    expect(tokens).toContain(B);
  });

  /* -------- errors -------- */

  it('throws DependencyResolutionError when a factory dependency fails', () => {
    c.registerFactory(FailingDep, () => {
      throw new Error('Connection refused');
    });
    expect(() => c.resolve(SvcThatDependsOnFailingDep)).toThrow(DependencyResolutionError);
  });

  it('throws CircularDependencyError for circular factory dependencies', () => {
    c.registerFactory(CircularA, () => {
      c.resolve(CircularB);
      return new CircularA();
    });
    c.registerFactory(CircularB, () => {
      c.resolve(CircularA);
      return new CircularB();
    });
    expect(() => c.resolve(CircularA)).toThrow(CircularDependencyError);
  });
});
