import { $, api, el, errorMessage, initTheme, link, plural, showStatus, track } from './common.js';

const PAGE_SIZE = 20;
const slug = location.pathname.split('/')[2] ?? '';
const root = $('company');

const CATEGORIES = [
  { key: 'dsa', label: 'DSA' },
  { key: 'hld', label: 'HLD' },
  { key: 'ai', label: 'AI' },
  { key: 'behavioral', label: 'Behavioral' },
];
const WINDOWS = [['30d', 'Last 30 days'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['all', 'All time']];
const DIFFICULTIES = [['', 'Any difficulty'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

function field(labelText, options, value, onChange) {
  const wrapper = el('label', 'field', labelText);
  const select = el('select', 'select');
  for (const [optionValue, text] of options) {
    const option = el('option', null, text);
    option.value = optionValue;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function chips(items) {
  const row = el('div', 'chips');
  for (const item of items) row.append(el('span', 'chip', item));
  return row;
}

// Fetches page after page into a list that `build` creates on the first rows.
function pager(host, { fetchPage, build, emptyText, onMeta }) {
  const view = el('div');
  const status = el('div');
  const more = el('button', 'btn', 'Load more');
  more.type = 'button';
  more.hidden = true;
  host.replaceChildren(view, status, more);
  let page = 0;
  let loaded = 0;
  let run = 0;
  let append = null;

  async function next() {
    const mine = run;
    more.disabled = true;
    showStatus(status, 'Loading…');
    try {
      const result = await fetchPage(page + 1);
      if (mine !== run) return;
      page += 1;
      status.replaceChildren();
      if (!append && !result.data.length) {
        showStatus(status, emptyText);
        more.hidden = true;
        onMeta?.(result.meta, 0);
        return;
      }
      append ??= build(view);
      append(result.data);
      loaded += result.data.length;
      onMeta?.(result.meta, loaded);
      more.textContent = 'Load more';
      more.hidden = loaded >= result.meta.total;
    } catch (error) {
      if (mine !== run) return;
      showStatus(status, errorMessage(error));
      more.textContent = 'Try again';
      more.hidden = false;
    } finally {
      if (mine === run) more.disabled = false;
    }
  }

  more.addEventListener('click', next);
  return {
    restart() {
      run += 1;
      page = 0;
      loaded = 0;
      append = null;
      view.replaceChildren();
      more.hidden = true;
      next();
    },
  };
}

function dsaPanel(host) {
  const filters = { time_window: '6m', difficulty: '' };
  const note = el('p', 'note');
  const count = el('p', 'muted mono');
  const results = el('div');
  note.hidden = true;
  const windowLabel = () => WINDOWS.find(([value]) => value === filters.time_window)[1].toLowerCase();

  const list = pager(results, {
    fetchPage: (page) => api(`companies/${encodeURIComponent(slug)}/dsa`, { ...filters, page, limit: PAGE_SIZE }),
    emptyText: 'No problems match these filters.',
    build(view) {
      const wrap = el('div', 'table-wrap');
      const table = el('table');
      const head = el('tr');
      for (const name of ['Problem', 'Difficulty', 'Topics']) head.append(el('th', null, name));
      const body = el('tbody');
      table.append(el('thead'), body);
      table.tHead.append(head);
      wrap.append(table);
      view.append(wrap);
      return (rows) => {
        for (const row of rows) {
          const tr = el('tr');
          const title = el('td');
          title.append(link(row.url, row.title));
          tr.append(title, el('td', row.difficulty ?? '', row.difficulty ?? '—'));
          const topics = el('td');
          topics.append(chips(row.topics));
          tr.append(topics);
          body.append(tr);
        }
      };
    },
    onMeta(meta, loaded) {
      note.hidden = !meta.fallback;
      note.textContent = meta.fallback ? `Fewer than 5 problems in the ${windowLabel()}, so these are all-time results.` : '';
      count.textContent = meta.total ? `Showing ${loaded} of ${meta.total}` : '';
    },
  });

  const controls = el('div', 'controls');
  controls.append(
    field('Time window', WINDOWS, filters.time_window, (value) => { filters.time_window = value; list.restart(); }),
    field('Difficulty', DIFFICULTIES, filters.difficulty, (value) => { filters.difficulty = value; list.restart(); }),
  );
  host.replaceChildren(controls, note, count, results);
  list.restart();
}

function hldPanel(host) {
  pager(host, {
    fetchPage: (page) => api(`companies/${encodeURIComponent(slug)}/hld`, { page, limit: PAGE_SIZE }),
    emptyText: 'No system design questions yet.',
    build(view) {
      const ul = el('ul', 'qs');
      view.append(ul);
      return (rows) => {
        for (const row of rows) {
          const li = el('li');
          li.append(el('strong', null, row.title));
          const solutions = el('div', 'chips');
          if (row.solutions.length) {
            solutions.append(el('span', 'mono muted', 'Solutions'));
            for (const s of row.solutions) solutions.append(link(s.url, s.title, 'chip'));
          } else {
            solutions.append(el('span', 'mono muted', 'No solution links yet'));
          }
          li.append(solutions);
          ul.append(li);
        }
      };
    },
  }).restart();
}

function aiPanel(host) {
  pager(host, {
    fetchPage: (page) => api(`companies/${encodeURIComponent(slug)}/ai`, { page, limit: PAGE_SIZE }),
    emptyText: 'No AI questions yet.',
    build(view) {
      const ul = el('ul', 'qs');
      view.append(ul);
      return (rows) => {
        for (const row of rows) {
          const li = el('li');
          li.append(link(row.url, row.title));
          if (row.topics.length) li.append(chips(row.topics));
          ul.append(li);
        }
      };
    },
  }).restart();
}

async function behavioralPanel(host) {
  showStatus(host, 'Loading…');
  try {
    const { data } = await api(`companies/${encodeURIComponent(slug)}/behavioral`);
    if (!data.values.length && !data.topics.length) {
      showStatus(host, 'No behavioral data yet.');
      return;
    }
    const parts = [];
    if (data.values.length) {
      const ul = el('ul', 'qs');
      for (const value of data.values) {
        const li = el('li');
        li.append(el('strong', null, value.name));
        if (value.blurb) li.append(el('span', 'muted', value.blurb));
        if (value.official_source_url) li.append(link(value.official_source_url, 'Official source', 'chip'));
        ul.append(li);
      }
      parts.push(el('h2', null, 'Company values'), ul);
    }
    if (data.topics.length) {
      const cards = el('div', 'cards');
      for (const topic of data.topics) {
        const card = el('div', 'topic');
        card.append(el('strong', null, topic.name));
        if (topic.question_types) card.append(el('span', 'muted', topic.question_types));
        if (topic.typical_round && topic.typical_round !== 'unknown') card.append(el('span', 'mono muted', topic.typical_round));
        cards.append(card);
      }
      parts.push(el('h2', null, 'Common topics'), cards);
    }
    host.replaceChildren(...parts);
  } catch (error) {
    showStatus(host, errorMessage(error), () => behavioralPanel(host));
  }
}

const PANELS = { dsa: dsaPanel, hld: hldPanel, ai: aiPanel, behavioral: behavioralPanel };

function profileCard(profile) {
  const card = el('section', 'card');
  const heading = el('h2', null, 'Interview rounds');
  if (!profile) {
    card.append(heading, el('p', 'muted', 'No rounds summary yet.'));
    return card;
  }
  card.append(heading);
  if (profile.summary) card.append(el('p', null, profile.summary));
  if (profile.rounds.length) {
    const steps = el('ol', 'steps');
    for (const round of profile.rounds) {
      const li = el('li');
      if (round.stage) li.append(el('strong', null, `${round.stage}: `));
      li.append(document.createTextNode(round.text));
      steps.append(li);
    }
    card.append(steps);
  }
  if (profile.other_steps.length) {
    const other = el('ul', 'steps');
    for (const step of profile.other_steps) other.append(el('li', null, step));
    card.append(el('strong', null, 'Other steps'), other);
  }
  if (profile.notes) card.append(el('p', 'muted', profile.notes));
  const foot = el('div', 'chips');
  foot.append(el('span', 'mono muted', `Last checked ${profile.last_reviewed}`));
  profile.source_urls.forEach((url, i) => foot.append(link(url, `Source ${i + 1}`, 'chip')));
  card.append(foot);
  return card;
}

function render(company) {
  document.title = `${company.name} · Lurivo`;
  const back = el('a', 'back', '← All companies');
  back.href = '/';
  root.replaceChildren(back, el('h1', null, company.name), profileCard(company.profile));

  const available = CATEGORIES.filter((c) => company.categories[c.key] > 0);
  const card = el('section', 'card');
  if (!available.length) {
    card.append(el('p', 'muted', 'No questions for this company yet.'));
    root.append(card);
    return;
  }
  const panel = el('div');
  const options = available.map((c) => [c.key, `${c.label} (${company.categories[c.key]})`]);
  const initial = available.find((c) => c.key === location.hash.slice(1))?.key ?? available[0].key;
  const show = (key) => {
    history.replaceState(null, '', `#${key}`);
    track({ kind: 'query', company: slug, category: key });
    PANELS[key](panel);
  };
  card.append(field('Category', options, initial, show), panel);
  root.append(card);
  track({ kind: 'query', company: slug, category: initial });
  PANELS[initial](panel);
}

async function load() {
  showStatus(root, 'Loading…');
  try {
    const { data } = await api(`companies/${encodeURIComponent(slug)}`);
    track({ kind: 'view', page: 'company', company: slug });
    render(data);
  } catch (error) {
    const back = el('a', 'back', '← All companies');
    back.href = '/';
    const message = el('div');
    showStatus(message, errorMessage(error), error.status === 404 ? undefined : load);
    root.replaceChildren(back, message);
  }
}

initTheme();
if (/^[a-z0-9-]+$/.test(slug)) {
  load();
} else {
  showStatus(root, 'Not found.');
}
