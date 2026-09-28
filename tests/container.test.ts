import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Container,
  Injectable,
  Singleton,
  Stateless,
  RequestScoped,
  CircularDependencyError,
  DependencyResolutionError,
} from '../src';
import type { OnInit, OnDestroy } from '../src';

/* ---- classes for simple resolve tests ---- */

@Injectable()
class SimpleDep { value = 42; }

@Injectable([SimpleDep])
class SimpleService { constructor(public dep: SimpleDep) { } }

@Injectable()
class NodeA { }

@Injectable([NodeA])
class NodeB { constructor(public a: NodeA) { } }

@Injectable([NodeB])
class NodeC { constructor(public b: NodeB) { } }

@Injectable()
@Singleton()
class SingletonService { id = Math.random(); }

@Injectable()
class TransientService { id = Math.random(); }

/* ---- classes for token injection tests ---- */

const LOGGER_TOKEN = Symbol('logger');
const CONFIG_TOKEN = 'CONFIG_TOKEN';

@Injectable([LOGGER_TOKEN])
class SvcWithSymbolInject {
  constructor(public logger: unknown) { }
}

@Injectable([CONFIG_TOKEN])
class SvcWithStringInject {
  constructor(public config: unknown) { }
}

/* ---- classes for error tests ---- */

@Injectable()
class FailingDep { }

@Injectable([FailingDep])
class SvcThatDependsOnFailingDep {
  constructor(public dep: FailingDep) { }
}

class CircularA { }
class CircularB { }

/* ================= TESTS ================= */

describe('Container', () => {
  let c: Container;

  beforeEach(() => {
    c = new Container();
  });

  /* -------- resolve -------- */

  it('resolves a plain class', () => {
    @Injectable()
    class PlainSvc { }
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
    class Svc { }
    const instance = new Svc();
    c.registerSingleton(Svc, instance);
    expect(c.resolve(Svc)).toBe(instance);
  });

  it('registerSingleton works with string token', () => {
    const value = { config: true };
    c.registerSingleton('MY_TOKEN', value);
    expect(c.resolve('MY_TOKEN' as never) as typeof value).toBe(value);
  });

  /* -------- registerInstance -------- */

  it('registerInstance stores a pre-built object and resolves via symbol token', () => {
    const DB = Symbol('db');
    const fakeDb = { query: () => [] };
    c.registerInstance(DB, fakeDb);
    expect(c.resolve(DB as never) as typeof fakeDb).toBe(fakeDb);
  });

  it('registerInstance allows injecting external objects via explicit token', () => {
    const REDIS = Symbol('redis');
    const fakeRedis = { get: (_k: string) => null };
    c.registerInstance(REDIS, fakeRedis);

    @Injectable([REDIS])
    class CacheService {
      constructor(public redis: typeof fakeRedis) { }
    }

    const svc = c.resolve(CacheService);
    expect(svc.redis).toBe(fakeRedis);
  });

  it('registerInstance and registerSingleton are interchangeable', () => {
    const TOKEN = Symbol('tok');
    const val = { x: 1 };
    c.registerInstance(TOKEN, val);
    expect(c.resolve(TOKEN as never) as typeof val).toBe(val);
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

  /* -------- token injection -------- */

  it('resolves by symbol token declared in @Injectable', () => {
    const logger = { log: () => { } };
    c.registerSingleton(LOGGER_TOKEN, logger);
    const instance = c.resolve(SvcWithSymbolInject);
    expect(instance.logger as typeof logger).toBe(logger);
  });

  it('resolves by string token declared in @Injectable', () => {
    const config = { debug: true };
    c.registerSingleton(CONFIG_TOKEN, config);
    const instance = c.resolve(SvcWithStringInject);
    expect(instance.config as typeof config).toBe(config);
  });

  /* -------- has / remove / clear -------- */

  it('has() returns false for unregistered token', () => {
    class Svc { }
    expect(c.has(Svc)).toBe(false);
  });

  it('has() returns true after registerSingleton', () => {
    class Svc { }
    c.registerSingleton(Svc, new Svc());
    expect(c.has(Svc)).toBe(true);
  });

  it('has() returns true after registerFactory', () => {
    class Svc { }
    c.registerFactory(Svc, () => new Svc());
    expect(c.has(Svc)).toBe(true);
  });

  it('remove() unregisters a singleton token', () => {
    class Svc { }
    c.registerSingleton(Svc, new Svc());
    c.remove(Svc);
    expect(c.has(Svc)).toBe(false);
  });

  it('remove() unregisters a factory token', () => {
    class Svc { }
    c.registerFactory(Svc, () => new Svc());
    c.remove(Svc);
    expect(c.has(Svc)).toBe(false);
  });

  it('clear() removes all registrations', () => {
    class A { }
    class B { }
    c.registerSingleton(A, new A());
    c.registerSingleton(B, new B());
    c.clear();
    expect(c.getRegisteredTokens()).toHaveLength(0);
  });

  it('getRegisteredTokens() returns all registered tokens', () => {
    class A { }
    class B { }
    c.registerSingleton(A, new A());
    c.registerFactory(B, () => new B());
    const tokens = c.getRegisteredTokens();
    expect(tokens).toContain(A);
    expect(tokens).toContain(B);
  });

  /* -------- errors -------- */

  it('throws DependencyResolutionError when a factory dependency fails', () => {
    c.registerFactory(FailingDep, () => { throw new Error('Connection refused'); });
    expect(() => c.resolve(SvcThatDependsOnFailingDep)).toThrow(DependencyResolutionError);
  });

  it('throws CircularDependencyError for circular factory dependencies', () => {
    c.registerFactory(CircularA, () => { c.resolve(CircularB); return new CircularA(); });
    c.registerFactory(CircularB, () => { c.resolve(CircularA); return new CircularB(); });
    expect(() => c.resolve(CircularA)).toThrow(CircularDependencyError);
  });

  /* -------- @RequestScoped -------- */

  describe('@RequestScoped', () => {
    it('throws when resolved outside a scope', () => {
      @Injectable()
      @RequestScoped()
      class ScopedSvc { id = Math.random(); }
      expect(() => c.resolve(ScopedSvc)).toThrow(/request.?scoped|no active request scope/i);
    });

    it('returns the same instance within a single scope', async () => {
      @Injectable()
      @RequestScoped()
      class ScopedSvc { id = Math.random(); }

      await c.runInScope(async () => {
        const a = c.resolve(ScopedSvc);
        const b = c.resolve(ScopedSvc);
        expect(a).toBe(b);
      });
    });

    it('returns a fresh instance for each scope', async () => {
      @Injectable()
      @RequestScoped()
      class ScopedSvc { id = Math.random(); }

      let first!: ScopedSvc;
      await c.runInScope(async () => { first = c.resolve(ScopedSvc); });

      let second!: ScopedSvc;
      await c.runInScope(async () => { second = c.resolve(ScopedSvc); });

      expect(first).not.toBe(second);
      expect(first.id).not.toBe(second.id);
    });

    it('calls onDestroy at end of scope', async () => {
      const log: string[] = [];

      @Injectable()
      @RequestScoped()
      class ScopedSvc implements OnDestroy {
        onDestroy() { log.push('destroyed'); }
      }

      await c.runInScope(async () => {
        c.resolve(ScopedSvc);
        expect(log).toHaveLength(0);
      });

      expect(log).toEqual(['destroyed']);
    });

    it('calls onDestroy even when handler throws', async () => {
      const log: string[] = [];

      @Injectable()
      @RequestScoped()
      class ScopedSvc implements OnDestroy {
        onDestroy() { log.push('destroyed'); }
      }

      await expect(c.runInScope(async () => {
        c.resolve(ScopedSvc);
        throw new Error('handler error');
      })).rejects.toThrow('handler error');

      expect(log).toEqual(['destroyed']);
    });

    it('injects a lazy proxy into a singleton — resolves per scope', async () => {
      @Injectable()
      @RequestScoped()
      class ScopedSvc { id = Math.random(); }

      @Injectable([ScopedSvc])
      @Singleton()
      class Holder {
        constructor(public dep: ScopedSvc) {}
      }

      const holder = c.resolve(Holder);
      const ids = new Set<number>();
      for (let i = 0; i < 2; i++) {
        await c.runInScope(async () => { ids.add(holder.dep.id); });
      }
      expect(ids.size).toBe(2);
    });

    it('lazy proxy throws when accessed outside a request scope', async () => {
      @Injectable()
      @RequestScoped()
      class ScopedSvc { id = Math.random(); }

      @Injectable([ScopedSvc])
      @Singleton()
      class Holder {
        constructor(public dep: ScopedSvc) {}
      }

      const holder = c.resolve(Holder);
      expect(() => holder.dep.id).toThrow(/request.?scoped|outside a request scope/i);
    });
  });

  /* -------- missing @Injectable tokens -------- */

  describe('constructor params without tokens', () => {
    it('throws DependencyResolutionError when class declares params but no tokens', () => {
      class Dep { }
      @Injectable()
      class NeedsDep {
        constructor(public dep: Dep) {}
      }
      expect(() => c.resolve(NeedsDep)).toThrow(/Did you forget @Injectable/);
    });

    it('resolves fine when the constructor has no params', () => {
      @Injectable()
      class NoDeps { ok = true; }
      expect(c.resolve(NoDeps).ok).toBe(true);
    });
  });

  /* -------- @Stateless enforcement -------- */

  describe('@Stateless', () => {
    it('allows property reads on the resolved instance', () => {
      @Injectable()
      @Singleton()
      @Stateless()
      class PureRepo {
        readonly config = { db: 'postgres' };
      }
      const instance = c.resolve(PureRepo);
      expect(instance.config.db).toBe('postgres');
    });

    it('throws when a property is written post-construction', () => {
      @Injectable()
      @Singleton()
      @Stateless()
      class MutatingRepo {
        value = 1;
      }
      const instance = c.resolve(MutatingRepo);
      expect(() => { (instance as { value: number; }).value = 2; }).toThrow(/stateless/i);
    });

    it('error message includes the class name', () => {
      @Injectable()
      @Singleton()
      @Stateless()
      class NamedRepo {
        state = 0;
      }
      const instance = c.resolve(NamedRepo);
      expect(() => { (instance as { state: number; }).state = 99; }).toThrow('NamedRepo');
    });

    it('returns same (proxied) instance on repeated resolve', () => {
      @Injectable()
      @Singleton()
      @Stateless()
      class CachedRepo { }
      expect(c.resolve(CachedRepo)).toBe(c.resolve(CachedRepo));
    });

    it('does NOT enforce on non-@Stateless singletons', () => {
      @Injectable()
      @Singleton()
      class MutableSingleton {
        count = 0;
      }
      const instance = c.resolve(MutableSingleton);
      expect(() => { instance.count = 1; }).not.toThrow();
      expect(instance.count).toBe(1);
    });
  });

  /* -------- lifecycle hooks -------- */

  describe('lifecycle hooks', () => {
    it('boot() calls onInit on registered singletons', async () => {
      const log: string[] = [];

      @Injectable()
      @Singleton()
      class DbClient implements OnInit {
        async onInit() { log.push('db:init'); }
      }

      const instance = new DbClient();
      c.registerInstance(DbClient, instance);
      await c.boot();
      expect(log).toEqual(['db:init']);
    });

    it('boot() skips instances without onInit', async () => {
      class Plain { }
      c.registerInstance(Plain, new Plain());
      await expect(c.boot()).resolves.toBeUndefined();
    });

    it('shutdown() calls onDestroy on singletons in reverse order', async () => {
      const log: string[] = [];

      class SvcA implements OnDestroy { onDestroy() { log.push('A'); } }
      class SvcB implements OnDestroy { onDestroy() { log.push('B'); } }
      class SvcC implements OnDestroy { onDestroy() { log.push('C'); } }

      c.registerInstance(SvcA, new SvcA());
      c.registerInstance(SvcB, new SvcB());
      c.registerInstance(SvcC, new SvcC());

      await c.shutdown();
      expect(log).toEqual(['C', 'B', 'A']);
    });

    it('shutdown() skips instances without onDestroy', async () => {
      class Plain { }
      c.registerInstance(Plain, new Plain());
      await expect(c.shutdown()).resolves.toBeUndefined();
    });
  });
});
