import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Controller,
  Get,
  Public,
  Ip,
  Device,
  UserAgent,
  HonoRouteBuilder,
  container,
} from '../src';
import {
  extractIp,
  detectDevice,
} from '../src';
import type { RequestLogEntry } from '../src';

/* ================= HELPERS ================= */

function makeRequest(
  path: string,
  headers?: Record<string, string>,
  init?: RequestInit
): Request {
  return new Request(`http://test.local${path}`, {
    ...init,
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 11) Mobile Safari/537.36', ...headers },
  });
}

/* ================= CONTROLLER ================= */

@Controller('/log-test')
class LogController {
  @Get('/info')
  @Public()
  info(
    @Ip() ip: string,
    @Device() device: string,
    @UserAgent() ua: string
  ) {
    return { ip, device, ua };
  }
}

/* ================= TESTS ================= */

describe('detectDevice', () => {
  it('detects mobile from Android UA', () => {
    expect(detectDevice('Mozilla/5.0 (Linux; Android 11) Mobile Safari/537.36')).toBe('mobile');
  });

  it('detects mobile from iPhone UA', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0) AppleWebKit/605.1.15')).toBe('mobile');
  });

  it('detects tablet from iPad UA', () => {
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('tablet');
  });

  it('detects desktop from Chrome UA', () => {
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')).toBe('desktop');
  });

  it('detects bot from Googlebot UA', () => {
    expect(detectDevice('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
  });

  it('detects bot from generic crawler', () => {
    expect(detectDevice('MySpider/1.0 (crawler)')).toBe('bot');
  });

  it('returns desktop for empty UA', () => {
    expect(detectDevice('')).toBe('desktop');
  });
});

describe('extractIp', () => {
  async function getIp(headers: Record<string, string>): Promise<string> {
    const { Hono } = await import('hono');
    const app = new Hono();
    let captured = '';
    app.get('/ip', (c) => {
      captured = extractIp(c);
      return c.text('ok');
    });
    await app.fetch(new Request('http://test.local/ip', { headers }));
    return captured;
  }

  it('reads CF-Connecting-IP first', async () => {
    const ip = await getIp({ 'CF-Connecting-IP': '1.2.3.4', 'X-Real-IP': '5.6.7.8' });
    expect(ip).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP', async () => {
    const ip = await getIp({ 'X-Real-IP': '5.6.7.8' });
    expect(ip).toBe('5.6.7.8');
  });

  it('takes first IP from X-Forwarded-For', async () => {
    const ip = await getIp({ 'X-Forwarded-For': '10.0.0.1, 10.0.0.2, 10.0.0.3' });
    expect(ip).toBe('10.0.0.1');
  });

  it('returns "unknown" when no IP headers present', async () => {
    const ip = await getIp({});
    expect(ip).toBe('unknown');
  });
});

describe('@Ip / @Device / @UserAgent param decorators', () => {
  beforeEach(() => {
    HonoRouteBuilder.configure({});
    container.clear();
  });

  it('injects IP from X-Forwarded-For', async () => {
    const app = HonoRouteBuilder.build(LogController);
    const res = await app.fetch(makeRequest('/log-test/info', { 'X-Forwarded-For': '99.1.2.3' }));
    const body = await res.json() as { ip: string };
    expect(body.ip).toBe('99.1.2.3');
  });

  it('injects device type', async () => {
    const app = HonoRouteBuilder.build(LogController);
    const res = await app.fetch(makeRequest('/log-test/info'));
    const body = await res.json() as { device: string };
    expect(body.device).toBe('mobile');
  });

  it('injects user-agent string', async () => {
    const app = HonoRouteBuilder.build(LogController);
    const res = await app.fetch(makeRequest('/log-test/info'));
    const body = await res.json() as { ua: string };
    expect(body.ua).toContain('Mobile');
  });
});

describe('requestLogger', () => {
  beforeEach(() => {
    container.clear();
  });

  it('calls requestLogger after handler', async () => {
    const entries: RequestLogEntry[] = [];
    HonoRouteBuilder.configure({
      requestLogger: (e) => { entries.push(e); },
    });
    const app = HonoRouteBuilder.build(LogController);
    await app.fetch(makeRequest('/log-test/info', { 'X-Real-IP': '42.0.0.1' }));
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/log-test/info');
    expect(e.ip).toBe('42.0.0.1');
    expect(e.device).toBe('mobile');
    expect(e.statusCode).toBe(200);
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('still calls logger when handler returns undefined (null body)', async () => {
    @Controller('/void-log')
    class VoidLogController {
      @Get()
      @Public()
      handle() { /* void */ }
    }

    const entries: RequestLogEntry[] = [];
    HonoRouteBuilder.configure({ requestLogger: (e) => { entries.push(e); } });
    const app = HonoRouteBuilder.build(VoidLogController);
    await app.fetch(new Request('http://test.local/void-log'));
    expect(entries[0]?.statusCode).toBe(200);
  });

  it('does not call logger when not configured', async () => {
    HonoRouteBuilder.configure({});
    let called = false;
    const app = HonoRouteBuilder.build(LogController);
    await app.fetch(makeRequest('/log-test/info'));
    expect(called).toBe(false);
  });
});
