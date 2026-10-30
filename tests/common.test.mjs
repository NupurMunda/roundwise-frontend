import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const store = new Map();
let inserted = [];
globalThis.matchMedia = () => ({ matches: false });
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};
Object.defineProperty(globalThis.localStorage, Symbol.iterator, { value: undefined });
globalThis.document = {
  getElementById: (id) => inserted.find((n) => n.id === id) ?? null,
  createElement: () => ({ setAttribute() {}, append() {}, replaceChildren() {} }),
  querySelector: () => ({ before: (node) => inserted.push(node) }),
};

const { api, errorMessage, ApiError } = await import('../js/common.js');
const realFetch = globalThis.fetch;
let reply;

beforeEach(() => {
  store.clear();
  inserted = [];
  reply = () => Response.json({ data: ['fresh'], meta: {} });
  globalThis.fetch = async () => reply();
});

const down = (status, headers = {}) => () => Response.json({ error: { code: 'x', message: 'y' } }, { status, headers });

describe('saved data fallback', () => {
  it('returns fresh data and saves it', async () => {
    assert.deepEqual((await api('companies', { limit: 5 })).data, ['fresh']);
    assert.equal(inserted.length, 0);
    assert.ok([...store.keys()].some((k) => k.endsWith('/api/v1/companies?limit=5')));
  });

  it('serves the saved copy with a notice on 5xx, 429 and network errors', async () => {
    await api('companies');
    for (const failure of [down(503), down(500), down(429, { 'Retry-After': '30' }), () => { throw new TypeError('offline'); }]) {
      inserted = [];
      reply = failure;
      assert.deepEqual((await api('companies')).data, ['fresh']);
      assert.equal(inserted.length, 1);
      assert.match(inserted[0].textContent ?? '', /saved data/i);
    }
  });

  it('does not fall back on 404 or 400', async () => {
    await api('companies/acme');
    for (const status of [404, 400]) {
      reply = down(status);
      await assert.rejects(api('companies/acme'), (error) => error.status === status);
    }
  });

  it('throws when nothing is saved for that exact request', async () => {
    await api('companies', { page: 1 });
    reply = down(503);
    await assert.rejects(api('companies', { page: 2 }), (error) => error instanceof ApiError && error.status === 503);
  });

  it('ignores a saved copy older than a week', async () => {
    await api('companies');
    const [key] = [...store.keys()];
    store.set(key, JSON.stringify({ savedAt: Date.now() - 8 * 24 * 3600 * 1000, body: { data: ['old'] } }));
    reply = down(503);
    await assert.rejects(api('companies'));
  });
});

describe('error messages', () => {
  it('explain outages, rate limits and missing pages', () => {
    assert.match(errorMessage(new ApiError(503, 'x', 60)), /temporarily unavailable/);
    assert.match(errorMessage(new ApiError(0, 'network')), /temporarily unavailable/);
    assert.equal(errorMessage(new ApiError(429, 'x', 42)), 'Too many requests, try again in 42 seconds.');
    assert.equal(errorMessage(new ApiError(404, 'x', 60)), 'Not found.');
    assert.match(errorMessage(new Error('?')), /Something went wrong/);
  });
});

globalThis.fetch ??= realFetch;
