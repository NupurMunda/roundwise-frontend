import { $, REDUCED_MOTION, api, el, errorMessage, initTheme, plural, showStatus } from './common.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_SIZE = 50;
const state = { companies: [], nodes: [], edges: [], query: '', showAll: false };
const companyPath = (slug) => `/c/${encodeURIComponent(slug)}`;

const home = $('home');
const web = $('web');
const edgesEl = $('edges');
const listEl = $('list');
const search = $('q');
const toggle = $('toggle');

const questionCount = (c) => c.counts.dsa + c.counts.hld + c.counts.ai;

function layout(nodes, edges, width, height) {
  const maxSize = Math.max(1, ...nodes.map((n) => n.size));
  for (const n of nodes) {
    n.f = 12 + 9 * Math.sqrt(n.size / maxSize);
    n.w = n.name.length * n.f * 0.6 + 30;
    n.h = n.f + 18;
  }
  const cx = width / 2;
  const cy = height / 2;
  nodes.forEach((n, i) => {
    const t = Math.sqrt((i + 0.5) / nodes.length);
    const angle = i * 2.39996;
    n.x = cx + Math.cos(angle) * t * width * 0.42;
    n.y = cy + Math.sin(angle) * t * height * 0.42;
    n.vx = 0;
    n.vy = 0;
  });
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const links = edges
    .filter((e) => bySlug.has(e.a) && bySlug.has(e.b))
    .map((e) => ({ a: bySlug.get(e.a), b: bySlug.get(e.b), w: e.weight }));

  const steps = 420;
  for (let step = 0; step < steps; step++) {
    const cool = 1 - (step / steps) * 0.7;
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.0022;
      n.vy += (cy - n.y) * 0.0045;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + 1;
        const d = Math.sqrt(d2);
        const force = 14000 / d2;
        dx /= d;
        dy /= d;
        a.vx -= dx * force;
        a.vy -= dy * force;
        b.vx += dx * force;
        b.vy += dy * force;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = (l.a.w + l.b.w) * 0.4 + 30;
      const force = ((d - rest) * 0.003 * Math.min(l.w, 4)) / d;
      l.a.vx += dx * force;
      l.a.vy += dy * force;
      l.b.vx -= dx * force;
      l.b.vy -= dy * force;
    }
    for (const n of nodes) {
      n.vx *= 0.78;
      n.vy *= 0.78;
      n.x += n.vx * cool;
      n.y += n.vy * cool;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const p = nodes[i];
          const q = nodes[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const ox = (p.w + q.w) / 2 + 10 - Math.abs(dx);
          const oy = (p.h + q.h) / 2 + 8 - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (ox < oy) {
              const s = dx < 0 ? -1 : 1;
              p.x -= (s * ox) / 2;
              q.x += (s * ox) / 2;
            } else {
              const s = dy < 0 ? -1 : 1;
              p.y -= (s * oy) / 2;
              q.y += (s * oy) / 2;
            }
          }
        }
      }
    }
    for (const n of nodes) {
      n.x = Math.min(width - n.w / 2 - 8, Math.max(n.w / 2 + 8, n.x));
      n.y = Math.min(height - n.h / 2 - 8, Math.max(n.h / 2 + 8, n.y));
    }
  }
  return links;
}

let frame = 0;
let clock = 0;
let lastTick = 0;
let floaters = [];
let lineRefs = [];
let lines = [];
let nodeEls = new Map();

const stopFloat = () => {
  cancelAnimationFrame(frame);
  frame = 0;
};

function tick(now) {
  frame = requestAnimationFrame(tick);
  const dt = lastTick ? Math.min(now - lastTick, 60) : 0;
  lastTick = now;
  if (web.classList.contains('focus')) return;
  clock += dt;
  for (const f of floaters) {
    f.ox = f.ax * Math.sin(clock * f.sx + f.px);
    f.oy = f.ay * Math.cos(clock * f.sy + f.py);
    f.el.style.translate = `${f.ox.toFixed(2)}px ${f.oy.toFixed(2)}px`;
  }
  for (const r of lineRefs) {
    r.line.setAttribute('x1', (r.a.x + r.a.ox).toFixed(1));
    r.line.setAttribute('y1', (r.a.y + r.a.oy).toFixed(1));
    r.line.setAttribute('x2', (r.b.x + r.b.ox).toFixed(1));
    r.line.setAttribute('y2', (r.b.y + r.b.oy).toFixed(1));
  }
}

function openCompany(event, slug, pill) {
  if (REDUCED_MOTION || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  pill.classList.add('pop');
  setTimeout(() => location.assign(companyPath(slug)), 180);
}

function focusNode(slug) {
  const near = new Set([slug]);
  for (const line of lines) {
    const hot = line.dataset.a === slug || line.dataset.b === slug;
    line.classList.toggle('hot', hot);
    if (hot) {
      near.add(line.dataset.a);
      near.add(line.dataset.b);
    }
  }
  for (const [key, node] of nodeEls) node.classList.toggle('on', near.has(key));
  web.classList.add('focus');
}

function clearFocus() {
  web.classList.remove('focus');
  for (const line of lines) line.classList.remove('hot');
  for (const node of nodeEls.values()) node.classList.remove('on');
}

function drawWeb() {
  stopFloat();
  const width = web.clientWidth;
  const height = web.clientHeight;
  if (!width || !height || !state.nodes.length) return;

  const nodes = state.nodes.map((n) => ({ ...n }));
  const links = layout(nodes, state.edges, width, height);

  for (const node of web.querySelectorAll('.node')) node.remove();
  edgesEl.replaceChildren();
  edgesEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  floaters = [];
  lineRefs = [];
  lines = [];
  nodeEls = new Map();
  lastTick = 0;

  for (const l of links) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', l.a.x.toFixed(1));
    line.setAttribute('y1', l.a.y.toFixed(1));
    line.setAttribute('x2', l.b.x.toFixed(1));
    line.setAttribute('y2', l.b.y.toFixed(1));
    line.setAttribute('stroke-width', (0.8 + Math.min(l.w, 4) * 0.5).toFixed(1));
    line.setAttribute('opacity', l.w > 1 ? '0.4' : '0.2');
    line.dataset.a = l.a.slug;
    line.dataset.b = l.b.slug;
    edgesEl.append(line);
    lines.push(line);
  }

  const float = new Map();
  for (const n of nodes) {
    const anchor = el('a', 'node');
    anchor.href = companyPath(n.slug);
    anchor.style.left = `${n.x.toFixed(1)}px`;
    anchor.style.top = `${n.y.toFixed(1)}px`;
    anchor.setAttribute('aria-label', `${n.name}, ${plural(n.size, 'question')}`);
    const pill = el('span', 'pill', n.name);
    pill.style.fontSize = `${n.f.toFixed(1)}px`;
    pill.style.padding = `${Math.round(n.f * 0.5)}px ${Math.round(n.f)}px`;
    anchor.append(pill);
    anchor.addEventListener('mouseenter', () => focusNode(n.slug));
    anchor.addEventListener('mouseleave', clearFocus);
    anchor.addEventListener('focus', () => focusNode(n.slug));
    anchor.addEventListener('blur', clearFocus);
    anchor.addEventListener('click', (event) => openCompany(event, n.slug, pill));
    web.append(anchor);
    nodeEls.set(n.slug, anchor);
    const f = {
      el: anchor, x: n.x, y: n.y, ox: 0, oy: 0,
      ax: 3 + Math.random() * 5, ay: 3 + Math.random() * 5,
      sx: 0.0005 + Math.random() * 0.0006, sy: 0.0005 + Math.random() * 0.0006,
      px: Math.random() * 6.28, py: Math.random() * 6.28,
    };
    float.set(n.slug, f);
    floaters.push(f);
  }
  links.forEach((l, i) => lineRefs.push({ line: lines[i], a: float.get(l.a.slug), b: float.get(l.b.slug) }));
  if (!REDUCED_MOTION) frame = requestAnimationFrame(tick);
  applySearch();
}

const matches = () => {
  const term = state.query.trim().toLowerCase();
  return term ? state.companies.filter((c) => c.name.toLowerCase().includes(term)) : state.companies;
};

function setView(showAll) {
  state.showAll = showAll;
  home.classList.toggle('show-all', showAll);
  toggle.textContent = showAll ? 'Show company web' : `Show all ${state.companies.length} companies`;
  if (showAll) stopFloat();
  else requestAnimationFrame(drawWeb);
}

function applySearch() {
  const found = matches();
  const slugs = new Set(found.map((c) => c.slug));
  const searching = state.query.trim() !== '';
  for (const [slug, node] of nodeEls) node.classList.toggle('dim', searching && !slugs.has(slug));
  $('none').hidden = found.length > 0;
  listEl.replaceChildren(
    ...found.map((c) => {
      const item = el('li');
      const anchor = el('a');
      anchor.href = companyPath(c.slug);
      anchor.append(el('strong', null, c.name), el('span', 'mono muted', plural(questionCount(c), 'question')));
      item.append(anchor);
      return item;
    }),
  );
}

search.addEventListener('input', () => {
  state.query = search.value;
  const shown = new Set(state.nodes.map((n) => n.slug));
  if (state.query.trim() && !state.showAll && matches().some((c) => !shown.has(c.slug))) setView(true);
  applySearch();
});
search.addEventListener('keydown', (event) => {
  const first = event.key === 'Enter' && state.query.trim() ? matches()[0] : null;
  if (first) location.assign(companyPath(first.slug));
});
toggle.addEventListener('click', () => setView(!state.showAll));

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (web.offsetParent) drawWeb();
    else stopFloat();
  }, 160);
});

async function load() {
  showStatus($('message'), 'Loading companies…');
  try {
    const [graph, first] = await Promise.all([api('graph', { limit: 60 }), api('companies', { limit: PAGE_SIZE })]);
    const rest = await Promise.all(
      Array.from({ length: Math.ceil(first.meta.total / PAGE_SIZE) - 1 }, (_, i) => api('companies', { limit: PAGE_SIZE, page: i + 2 })),
    );
    state.companies = [first, ...rest].flatMap((r) => r.data);
    state.nodes = graph.data.nodes;
    state.edges = graph.data.edges;
  } catch (error) {
    showStatus($('message'), errorMessage(error), load);
    return;
  }
  $('message').replaceChildren();
  if (!state.companies.length) {
    showStatus($('message'), 'No companies yet.');
    return;
  }
  search.disabled = false;
  toggle.hidden = false;
  setView(false);
  applySearch();
}

initTheme();
load();
