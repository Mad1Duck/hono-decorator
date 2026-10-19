import { describe, it, expect, afterEach } from 'bun:test';
import type { Context } from 'hono';
import {
  container, Controller, createApp, Get, Injectable, Module, Public, Singleton,
} from '../src';
import type { OnInit } from '../src';

/* ---- classes ---- */

@Injectable([], { strict: true })
class StrictDep {
  tag = 'strict-dep';
}

@Injectable([StrictDep], { strict: true })
class StrictService {
  constructor(public dep: StrictDep) {}
}

@Injectable()
class LooseService {
  tag = 'loose';
}

let booted = 0;

@Injectable()
@Singleton()
class BootedService implements OnInit {
  onInit() {
    booted++;
  }
}

@Controller('/strict')
@Injectable()
class StrictController {
  @Get()
  @Public()
  ping(c: Context) {
    return c.json({ ok: true });
  }
}

@Module({ controllers: [StrictController], providers: [BootedService] })
class StrictModule {}

afterEach(() => {
  container.strictDi = false;
});

describe('strict DI — per-class opt-in', () => {
  it('bare new on a strict @Injectable throws DI bypass error', () => {
    const dep = container.construct(StrictDep);
    expect(() => new StrictService(dep)).toThrow(/DI bypass: 'StrictService'/);
  });

  it('strict applies to injected dependencies too', () => {
    expect(() => new StrictDep()).toThrow(/DI bypass: 'StrictDep'/);
  });

  it('non-strict @Injectable still allows bare new', () => {
    const svc = new LooseService();
    expect(svc.tag).toBe('loose');
    expect(svc).toBeInstanceOf(LooseService);
  });

  it('container.resolve constructs strict classes with injected deps', () => {
    const svc = container.resolve(StrictService);
    expect(svc.dep).toBeInstanceOf(StrictDep);
    expect(svc.dep.tag).toBe('strict-dep');
  });

  it('container.construct is the official escape hatch', () => {
    const dep = container.construct(StrictDep);
    const svc = container.construct(StrictService, dep);
    expect(svc.dep.tag).toBe('strict-dep');
  });

  it('a bare new inside an approved factory is allowed', () => {
    container.registerFactory('strict-factory', () => new StrictDep());
    const dep = container.resolve<StrictDep>('strict-factory' as never);
    expect(dep.tag).toBe('strict-dep');
    container.remove('strict-factory' as never);
  });
});

describe('strict DI — createApp strictDi flag', () => {
  it('strictDi: true makes every @Injectable refuse bare new', async () => {
    await createApp(StrictModule, { strictDi: true, boot: false });
    expect(container.strictDi).toBe(true);
    expect(() => new LooseService()).toThrow(/DI bypass: 'LooseService'/);
  });
});

describe('createApp boot lifecycle', () => {
  it('auto-boots — onInit fires on resolved singletons', async () => {
    const before = booted;
    await createApp(StrictModule, {});
    expect(booted).toBe(before + 1);
  });

  it('boot: false skips onInit', async () => {
    container.clear(); // drop the cached singleton so boot() has nothing to call
    const before = booted;
    await createApp(StrictModule, { boot: false });
    expect(booted).toBe(before);
  });
});
