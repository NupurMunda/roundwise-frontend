export const $ = (id) => document.getElementById(id);
export const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class ApiError extends Error {
  constructor(status, code, retryAfter) {
    super(code);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function api(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  let response;
  try {
    response = await fetch(`/api/v1/${path}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'network');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'error', Number(response.headers.get('Retry-After')) || 60);
  return body;
}

export function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.status === 429) return `Too many requests, try again in ${plural(error.retryAfter, 'second')}.`;
    if (error.status === 404) return 'Not found.';
  }
  return 'Something went wrong. Please try again.';
}

export function showStatus(container, text, onRetry) {
  const note = el('p', 'note', text);
  note.setAttribute('role', 'status');
  container.replaceChildren(note);
  if (onRetry) {
    const retry = el('button', 'btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    container.append(retry);
  }
}

export function safeUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

export function link(url, text, className) {
  const href = safeUrl(url);
  if (!href) return el('span', className, text);
  const anchor = el('a', className, text);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

export function initTheme() {
  const button = $('theme');
  const dark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const label = () => { button.textContent = dark() ? 'Light mode' : 'Dark mode'; };
  button.addEventListener('click', () => {
    const next = dark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    label();
  });
  label();
}
