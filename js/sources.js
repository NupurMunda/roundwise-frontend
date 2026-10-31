import { $, api, el, errorMessage, initTheme, link, showStatus, track } from './common.js';

const root = $('sources');

function textBlock(summary, text) {
  const details = el('details');
  details.append(el('summary', null, summary), el('pre', null, text));
  return details;
}

function sourceCard(source) {
  const card = el('section', 'card');
  const heading = el('h2', null, source.name);
  heading.append(el('span', 'badge', source.license));
  card.append(heading);
  const meta = el('div', 'chips');
  if (source.author) meta.append(el('span', 'mono muted', `Author: ${source.author}`));
  meta.append(link(source.repo_url, 'Repository', 'chip'));
  card.append(meta);
  if (source.adapted) card.append(el('p', 'muted', source.adaptation_note ? `Adapted: ${source.adaptation_note}` : 'Adapted from the original.'));
  if (source.license_text) card.append(textBlock('License text', source.license_text));
  if (source.notice_text) card.append(textBlock('Notice', source.notice_text));
  return card;
}

async function load() {
  showStatus(root, 'Loading…');
  try {
    const { data } = await api('sources');
    if (!data.length) {
      showStatus(root, 'No sources listed.');
      return;
    }
    root.replaceChildren(...data.map(sourceCard));
  } catch (error) {
    showStatus(root, errorMessage(error), load);
  }
}

initTheme();
track({ kind: 'view', page: 'sources' });
load();
