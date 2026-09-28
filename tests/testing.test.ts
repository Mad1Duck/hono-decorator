import { describe, it, expect } from 'bun:test';
import {
  Controller, Get, Post, Public, Injectable, Singleton,
  createTestingModule, container, HonoRouteBuilder,
} from '../src';
import type { Context } from 'hono';

@Injectable()
@Singleton()
class RealService {
  greet() { return 'real'; }
}

@Controller('/tm')
@Injectable([RealService])
class TmController {
  constructor(private svc: RealService) { }
  @Get() @Public() hi() { return { msg: this.svc.greet() }; }
}

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://test.local${path}`, init);
}

describe('createTestingModule', () => {
  it('overrideProvider().useValue injects the mock into controllers', async () => {
    const mod = createTestingModule({ controllers: [TmController] })
      .overrideProvider(RealService).useValue({ greet: () => 'mocked' })
      .compile();

    const res = await mod.createApp().fetch(makeRequest('/tm'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ msg: 'mocked' });
    mod.cleanup();
  });

  it('get() resolves providers from the overridden container', () => {
    const mod = createTestingModule()
      .overrideProvider(RealService).useValue({ greet: () => 'direct' })
      .compile();

    expect(mod.get(RealService).greet()).toBe('direct');
    mod.cleanup();
  });

  it('cleanup() restores the original container state', async () => {
    const mod = createTestingModule()
      .overrideProvider(RealService).useValue({ greet: () => 'leak?' })
      .compile();
    expect(mod.get(RealService).greet()).toBe('leak?');

    mod.cleanup();

    // resolve post-cleanup should create/return a real instance, not the mock
    const inst = container.resolve(RealService);
    expect(inst.greet()).toBe('real');
  });

  it('useFactory provides a custom provider factory', () => {
    const mod = createTestingModule()
      .overrideProvider(RealService).useFactory(() => ({ greet: () => 'factory' }) as RealService)
      .compile();

    expect(mod.get(RealService).greet()).toBe('factory');
    mod.cleanup();
  });

  it('createApp() with no controllers returns an empty app', async () => {
    const mod = createTestingModule().compile();
    const res = await mod.createApp().fetch(makeRequest('/tm'));
    expect(res.status).toBe(404);
    mod.cleanup();
  });
});
