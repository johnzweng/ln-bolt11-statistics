// Sortable, paginated node table and CSV serialization used by node rankings.
import { btc, copy, csv, download, el, external, number, safeLabel, sats } from './helpers.js';

export const NETWORK_LABELS = {
  bc: 'mainnet',
  tb: 'testnet',
  tbs: 'signet',
  bcrt: 'regtest',
  sb: 'simnet',
};

const TABLE_COLUMNS = ['node', 'count', 'amount', 'amountless'];
const PAGE_SIZE = 25;

/** Source links are user-opened; rendering this badge never performs a lookup. */
export function knownBadge(known) {
  if (!known) return null;
  return el(
    'a',
    {
      class: 'badge badge-known',
      href: known.source,
      target: '_blank',
      rel: 'noopener noreferrer',
      referrerpolicy: 'no-referrer',
      title:
        `${known.label} · ${known.operator}. Listed in the official routing-node ` +
        'documentation; not proof of the route used.',
      'aria-label': `${known.label} — view official source`,
    },
    known.label,
  );
}

export function sortNodeRows(rows, key, descending) {
  return [...rows].sort((a, b) => {
    const left = key === 'node' ? a.key : a[key];
    const right = key === 'node' ? b.key : b[key];
    const comparison = left < right ? -1 : left > right ? 1 : 0;
    return (descending ? -comparison : comparison) || a.key.localeCompare(b.key);
  });
}

function lookupFacts(lookup) {
  if (!lookup?.node) {
    if (!lookup) return '';
    return lookup.status === 'unknown'
      ? 'Not in public map (not proof of privacy)'
      : 'Lookup unavailable / session limit reached';
  }
  return [
    lookup.node.active_channel_count === null
      ? ''
      : `${number(lookup.node.active_channel_count)} active channels`,
    lookup.node.capacity === null ? '' : btc(lookup.node.capacity),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function nodeRowsCsv(
  rows,
  { limit, sort = 'count', descending = true, target = false, lookupResults },
) {
  const selected = sortNodeRows(rows, sort, descending).slice(
    0,
    limit === 'all' ? rows.length : Number(limit),
  );
  return csv([
    [
      'node_id',
      'network',
      'invoices',
      target ? 'attributed_amount_msat_non_additive' : 'requested_amount_msat',
      'amountless_invoices',
      'alias',
      'current_public_channels',
      'current_capacity_sat',
      'known_node',
      'known_node_source',
    ],
    ...selected.map((row) => {
      const info = row.network === 'bc' ? lookupResults?.get(row.node)?.node : null;
      return [
        row.node,
        NETWORK_LABELS[row.network],
        row.count,
        row.amount,
        row.amountless,
        info ? safeLabel(info.alias) : '',
        info?.active_channel_count,
        info?.capacity,
        row.known?.label ?? '',
        row.known?.source ?? '',
      ];
    }),
  ]);
}

export class NodeTable {
  constructor({ title, target, lookupResults }) {
    this.target = target;
    this.lookupResults = lookupResults;
    this.rows = [];
    this.sort = 'count';
    this.descending = true;
    this.page = 0;
    this.copyCount = this.createCopyCountSelector(title);
    this.tbody = el('tbody');
    this.headers = TABLE_COLUMNS.map((key) => this.createHeader(key));
    this.pagination = el('div', { class: 'pagination' });
    this.element = this.createDetails();
  }

  filename() {
    return `lightning-lens-${this.target ? 'routing-targets' : 'destinations'}.csv`;
  }

  columnLabel(key) {
    return {
      node: 'Node ID / network',
      count: 'Invoices',
      amount: this.target ? 'Attributed sats' : 'Requested sats',
      amountless: 'No amount',
    }[key];
  }

  createCopyCountSelector(title) {
    return el(
      'select',
      { 'aria-label': `Number of ${title.toLowerCase()} to copy` },
      el('option', { value: 10 }, 'Top 10'),
      el('option', { value: 25 }, 'Top 25'),
      el('option', { value: 'all' }, 'All rows'),
    );
  }

  createHeader(key) {
    return el(
      'th',
      { scope: 'col' },
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            if (this.sort === key) this.descending = !this.descending;
            else {
              this.sort = key;
              this.descending = key !== 'node';
            }
            this.page = 0;
            this.render();
          },
        },
        this.columnLabel(key),
      ),
    );
  }

  createDetails() {
    const table = el('table', {}, el('thead', {}, el('tr', {}, this.headers)), this.tbody);
    const details = el(
      'details',
      { class: 'table-details' },
      el('summary', {}, 'Sortable table · full node IDs · copy / CSV'),
      el(
        'div',
        { class: 'table-controls' },
        this.copyCount,
        el(
          'button',
          {
            class: 'button subtle',
            onclick: () => copy(this.toCsv(this.copyCount.value), this.filename()),
          },
          'Copy CSV',
        ),
        el(
          'button',
          {
            class: 'button subtle',
            onclick: () => download(this.toCsv('all'), this.filename()),
          },
          'Export all CSV',
        ),
      ),
      el('div', { class: 'table-scroll' }, table),
      this.pagination,
    );
    details.addEventListener('toggle', () => {
      if (details.open) this.render();
    });
    return details;
  }

  update(rows) {
    this.rows = rows;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
    if (this.element.open || !rows.length) this.render();
  }

  renderRow(row) {
    const lookup = row.network === 'bc' ? this.lookupResults.get(row.node) : null;
    const label = lookup?.node?.alias ? safeLabel(lookup.node.alias) : null;
    const facts = lookupFacts(lookup);

    return el(
      'tr',
      {},
      el(
        'td',
        {},
        label ? el('span', { class: 'alias', dir: 'auto' }, label) : null,
        knownBadge(row.known),
        el(
          'button',
          {
            class: 'key-copy',
            title: 'Copy full node public key',
            onclick: () => copy(row.node, 'node-id.txt'),
          },
          el('code', {}, row.node),
        ),
        el(
          'span',
          { class: 'node-facts' },
          NETWORK_LABELS[row.network],
          facts ? ` · ${facts}` : '',
        ),
        row.network === 'bc'
          ? el(
              'div',
              { class: 'rank-links' },
              external(`https://terminal.lightning.engineering/explore/${row.node}`, 'Terminal ↗'),
              external(`https://mempool.space/lightning/node/${row.node}`, 'mempool ↗'),
              external(`https://amboss.space/node/${row.node}`, 'Amboss ↗'),
            )
          : null,
      ),
      el('td', {}, number(row.count)),
      el('td', {}, sats(row.amount)),
      el('td', {}, number(row.amountless)),
    );
  }

  render() {
    const sorted = sortNodeRows(this.rows, this.sort, this.descending);
    this.headers.forEach((header, index) => {
      const key = TABLE_COLUMNS[index];
      header.setAttribute(
        'aria-sort',
        key === this.sort ? (this.descending ? 'descending' : 'ascending') : 'none',
      );
      const arrow = key === this.sort ? (this.descending ? ' ↓' : ' ↑') : '';
      header.firstChild.textContent = this.columnLabel(key) + arrow;
    });

    const start = this.page * PAGE_SIZE;
    const displayed = sorted.slice(start, start + PAGE_SIZE);
    this.tbody.replaceChildren(...displayed.map((row) => this.renderRow(row)));

    const previous = el(
      'button',
      {
        class: 'button subtle',
        onclick: () => {
          this.page--;
          this.render();
        },
      },
      '← Previous',
    );
    previous.disabled = this.page === 0;
    const next = el(
      'button',
      {
        class: 'button subtle',
        onclick: () => {
          this.page++;
          this.render();
        },
      },
      'Next →',
    );
    next.disabled = start + PAGE_SIZE >= sorted.length;

    const pageLabel = sorted.length
      ? `${start + 1}–${Math.min(start + PAGE_SIZE, sorted.length)} of ${number(sorted.length)}`
      : '0 rows';
    this.pagination.replaceChildren(previous, el('span', {}, pageLabel), next);
  }

  toCsv(limit) {
    return nodeRowsCsv(this.rows, {
      limit,
      sort: this.sort,
      descending: this.descending,
      target: this.target,
      lookupResults: this.lookupResults,
    });
  }
}
