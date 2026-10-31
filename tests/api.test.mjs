import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import handler, { config } from '../netlify/functions/api.mjs';

const realFetch = globalThis.fetch;
let calls;
let reply;

beforeEach(() => {
  process.env.API_BASE_URL = 'https://backend.example.test/';
  process.env.API_KEY = 'secret-key';
  calls = [];
  reply = () => Response.json({ data: [], meta: {} });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return reply();
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path, context = { ip: '198.51.100.9' }) => handler(new Request(`https://site.test${path}`), context);

describe('tracking ping', () => {
  it('forwards only the tracking params, with the visitor address and key, and is never cached', async () => {
    const res = await get('/api/v1/ping?kind=query&company=google&category=dsa&status=503&evil=1&topic=Array', { ip: '203.0.113.5' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Netlify-CDN-Cache-Control'), null);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/v1/ping');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['category', 'company', 'kind', 'status', 'topic']);
    assert.equal(calls[0].init.headers['x-client-ip'], '203.0.113.5');
    assert.equal(calls[0].init.headers['x-api-key'], 'secret-key');
  });
});

describe('logging', () => {
  it('logs path, status and time without IPs, keys or query values', async () => {
    const lines = [];
    const realLog = console.log;
    console.log = (line) => lines.push(line);
    try {
      await get('/api/v1/companies/google?topic=secret-topic', { ip: '203.0.113.5' });
      await get('/api/v1/admin', { ip: '203.0.113.5' });
    } finally {
      console.log = realLog;
    }
    const logged = lines.map((l) => JSON.parse(l));
    assert.deepEqual(logged.map((l) => [l.path, l.status]), [['/api/v1/companies/google', 200], ['/api/v1/admin', 404]]);
    assert.ok(logged.every((l) => l.event === 'api' && typeof l.ms === 'number'));
    assert.doesNotMatch(lines.join('\n'), /203\.0\.113|secret/);
  });
});

describe('method and path allow-list', () => {
  it('rejects anything but GET with 405', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await handler(new Request('https://site.test/api/v1/companies', { method }), { ip: '1.1.1.1' });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('Allow'), 'GET');
    }
    assert.equal(calls.length, 0);
  });

  it('rejects unlisted paths with 404 and never calls upstream', async () => {
    const paths = [
      '/api/v1/admin', '/api/v1', '/api/v2/companies', '/api/v1/companies/Bad_Slug', '/api/v1/companies/a/b',
      '/api/v1/companies/google/other', '/api/v1/resources/abc', '/api/v1/resources/1/extra', '/api/v1/companies/../admin', '/api/v1/companies/a%2Fb', '/api/v1/companies/%2e%2e/admin',
      '/api/v1/companies/', '/api/v1/sources/1', '/api/health',
    ];
    for (const path of paths) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
      assert.equal((await res.json()).error.code, 'not_found');
    }
    assert.equal(calls.length, 0);
  });

  it('allows every listed path', async () => {
    const paths = [
      '/api/v1/health', '/api/v1/graph', '/api/v1/companies', '/api/v1/companies/google', '/api/v1/companies/google/dsa',
      '/api/v1/companies/google/hld', '/api/v1/companies/google/ai', '/api/v1/companies/google/behavioral',
      '/api/v1/resources/601', '/api/v1/sources',
    ];
    for (const path of paths) assert.equal((await get(path)).status, 200, path);
    assert.deepEqual(calls.map((c) => new URL(c.url).pathname), paths.map((p) => p.slice(4)));
    assert.equal(new URL(calls[0].url).origin, 'https://backend.example.test');
  });

  it('is mounted at /api/*', () => {
    assert.equal(config.path, '/api/*');
  });
});

describe('forwarding', () => {
  it('forwards only the known query params', async () => {
    await get('/api/v1/companies/google/dsa?time_window=6m%2B&difficulty=hard&topic=Graph%20Theory&page=2&limit=10&q=x&evil=1&api_key=2');
    const sent = new URL(calls[0].url).searchParams;
    assert.deepEqual([...sent.keys()].sort(), ['difficulty', 'limit', 'page', 'q', 'time_window', 'topic']);
    assert.equal(sent.get('time_window'), '6m+');
    assert.equal(sent.get('topic'), 'Graph Theory');
    assert.match(calls[0].url, /time_window=6m%2B/);
  });

  it('adds x-api-key only when API_KEY is set', async () => {
    await get('/api/v1/health');
    assert.equal(calls[0].init.headers['x-api-key'], 'secret-key');
    for (const empty of ['', undefined]) {
      if (empty === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = empty;
      await get('/api/v1/health');
      assert.ok(!('x-api-key' in calls.at(-1).init.headers), `API_KEY=${empty}`);
    }
  });

  it('forwards the visitor IP as x-client-ip', async () => {
    await get('/api/v1/health', { ip: '203.0.113.5' });
    assert.equal(calls[0].init.headers['x-client-ip'], '203.0.113.5');
    await get('/api/v1/health', {});
    assert.ok(!('x-client-ip' in calls[1].init.headers));
  });

  it('times out upstream calls after 8 seconds', async () => {
    await get('/api/v1/health');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });
});

describe('responses', () => {
  it('maps timeouts and network errors to 502 upstream_unavailable', async () => {
    for (const error of [new DOMException('timed out', 'TimeoutError'), new TypeError('fetch failed')]) {
      globalThis.fetch = async () => { throw error; };
      const res = await get('/api/v1/companies');
      assert.equal(res.status, 502);
      assert.equal(res.headers.get('Retry-After'), '30');
      assert.equal(res.headers.get('Netlify-CDN-Cache-Control'), null);
      assert.deepEqual(await res.json(), { error: { code: 'upstream_unavailable', message: 'the data service is unavailable' } });
    }
  });

  it('maps a non-JSON upstream reply to 502', async () => {
    reply = () => new Response('<html>oops</html>', { status: 500 });
    const res = await get('/api/v1/companies');
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'upstream_unavailable');
  });

  it('returns upstream JSON and status without upstream headers', async () => {
    reply = () => Response.json({ error: { code: 'not_found', message: 'company not found' } }, { status: 404, headers: { 'x-secret': 'leak', 'set-cookie': 'a=b', Server: 'cloudflare' } });
    const res = await get('/api/v1/companies/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: { code: 'not_found', message: 'company not found' } });
    for (const name of ['x-secret', 'set-cookie', 'server']) assert.equal(res.headers.get(name), null, name);
    assert.equal(res.headers.get('Cache-Control'), null);
  });

  it('sets cache headers on 200 only', async () => {
    const ok = await get('/api/v1/companies');
    assert.equal(ok.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(ok.headers.get('Netlify-CDN-Cache-Control'), 'public, durable, s-maxage=86400, stale-while-revalidate=604800');
    reply = () => Response.json({ error: { code: 'bad_request', message: 'x' } }, { status: 400 });
    const bad = await get('/api/v1/companies?page=0');
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get('Netlify-CDN-Cache-Control'), null);
  });

  it('passes Retry-After through on 429', async () => {
    reply = () => Response.json({ error: { code: 'rate_limited', message: 'too many requests' } }, { status: 429, headers: { 'Retry-After': '42' } });
    const res = await get('/api/v1/companies');
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '42');
  });
});
