const ALLOWED_PATH = /^\/api\/v1\/(health|graph|companies|companies\/[a-z0-9-]+(\/(dsa|hld|ai|behavioral))?|resources\/[0-9]+|sources|ping)$/;
const FORWARDED_PARAMS = ['q', 'page', 'limit', 'time_window', 'difficulty', 'topic', 'kind', 'company', 'category', 'status'];
const TIMEOUT_MS = 8000;

// Data changes rarely: keep it a day in the shared CDN cache (durable = one copy across edge nodes) and
// serve it stale for a week while refreshing, so most visitors never reach the backend.
const CDN_CACHE = 'public, durable, s-maxage=86400, stale-while-revalidate=604800';
const BROWSER_CACHE = 'public, max-age=300';

const fail = (status, code, message, headers = {}) =>
  Response.json({ error: { code, message } }, { status, headers });

// One JSON line per call that reaches the function (CDN hits never do): path and status only, no IPs or query values.
export default async function handler(request, context) {
  const started = Date.now();
  const response = await handle(request, context);
  console.log(JSON.stringify({ event: 'api', path: new URL(request.url).pathname, status: response.status, ms: Date.now() - started }));
  return response;
}

async function handle(request, context) {
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'only GET is allowed', { Allow: 'GET' });

  const url = new URL(request.url);
  if (!ALLOWED_PATH.test(url.pathname)) return fail(404, 'not_found', 'route not found');

  const upstream = new URL(process.env.API_BASE_URL.replace(/\/+$/, '') + url.pathname.slice('/api'.length));
  for (const name of FORWARDED_PARAMS) {
    const value = url.searchParams.get(name);
    if (value !== null) upstream.searchParams.set(name, value);
  }

  const headers = { Accept: 'application/json' };
  if (process.env.API_KEY) headers['x-api-key'] = process.env.API_KEY;
  if (context.ip) headers['x-client-ip'] = context.ip;

  let response, body;
  try {
    response = await fetch(upstream, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    body = await response.json();
  } catch {
    return fail(502, 'upstream_unavailable', 'the data service is unavailable', { 'Retry-After': '30' });
  }

  const out = {};
  if (url.pathname === '/api/v1/ping') {
    out['Cache-Control'] = 'no-store'; // every visit must reach the backend to be counted
  } else if (response.status === 200) {
    out['Cache-Control'] = BROWSER_CACHE;
    out['Netlify-CDN-Cache-Control'] = CDN_CACHE;
  }
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) out['Retry-After'] = retryAfter;
  return Response.json(body, { status: response.status, headers: out });
}

export const config = { path: '/api/*' };
