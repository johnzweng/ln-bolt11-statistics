// Ranked destination/target chart with explicit, bounded public-node enrichment.
import { bar } from './charts.js';
import { el, number, safeLabel, sats, shortKey, toast } from './helpers.js';
import { lookupNode, MAX_CONCURRENT_LOOKUPS, MAX_LOOKUPS } from './node-lookup.js';
import { knownBadge, NETWORK_LABELS, nodeRowsCsv, NodeTable, sortNodeRows } from './node-table.js';

const lookupResults = new Map();
const METRICS = ['count', 'amount'];

export class NodePanel {
  constructor(root, { title, subtitle, target = false }) {
    this.root = root;
    this.target = target;
    this.rows = [];
    this.metric = 'count';
    this.sort = 'count';
    this.descending = true;
    this.demo = false;
    this.fetching = false;

    if (target) root.classList.add('target');
    this.badge = el('span', { class: 'count-tag' });
    this.chart = el('div', { class: 'node-ranking' });
    this.metricButtons = METRICS.map((key) => this.createMetricButton(key));
    this.fetchCount = this.createCountSelector(title);
    this.fetchCount.value = '10';
    this.fetchButton = el(
      'button',
      { class: 'button subtle', onclick: () => this.fetch() },
      'Fetch from mempool.space',
    );
    this.lookupStatus = el(
      'p',
      { class: 'lookup-note', role: 'status' },
      `Manual only · mainnet keys only · max ${MAX_LOOKUPS} distinct lookups per tab. ` +
        'This shares those keys with mempool.space.',
    );
    this.table = new NodeTable({ title, target, lookupResults });
    this.details = this.table.element;

    root.append(
      el(
        'div',
        { class: 'section-head' },
        el(
          'div',
          {},
          el(
            'div',
            { class: 'eyebrow' },
            target ? 'WHERE YOU COULD ROUTE' : 'WHO THE INVOICE IS FOR',
          ),
          el('h3', {}, title),
        ),
        this.badge,
      ),
      el('p', { class: 'panel-description' }, subtitle),
      el(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': `${title} ranking` },
        this.metricButtons,
      ),
      this.chart,
      el(
        'div',
        { class: 'node-lookup' },
        el('div', { class: 'lookup-controls' }, this.fetchCount, this.fetchButton),
        this.lookupStatus,
      ),
      this.details,
    );
  }

  createMetricButton(key) {
    return el(
      'button',
      {
        type: 'button',
        class: key === 'count' ? 'active' : '',
        'aria-pressed': key === 'count',
        onclick: () => {
          this.metric = key;
          for (const [index, button] of this.metricButtons.entries()) {
            const active = METRICS[index] === key;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active);
          }
          this.renderChart();
        },
      },
      key === 'count' ? 'By invoice count' : 'By requested amount',
    );
  }

  createCountSelector(title) {
    return el(
      'select',
      { 'aria-label': `Number of ${title.toLowerCase()} to look up` },
      [5, 10, 20, 50].map((count) => el('option', { value: count }, `First ${count}`)),
    );
  }

  update(rows, demo) {
    this.rows = rows;
    this.demo = demo;
    this.badge.textContent = `${number(rows.length)} nodes`;
    this.fetchButton.disabled = demo || this.fetching || !rows.some((row) => row.network === 'bc');
    this.renderChart();
    this.table.update(rows);
  }

  sorted(key = this.sort, descending = this.descending) {
    return sortNodeRows(this.rows, key, descending);
  }

  metricRatio(row, maximum) {
    if (!maximum) return 0;
    if (this.metric === 'amount') {
      // Fixed-point BigInt ratio keeps very large invoice totals exact.
      return Number((row.amount * 10000n) / maximum) / 10000;
    }
    return row.count / maximum;
  }

  renderRankRow(row, index, maximum) {
    const lookup = row.network === 'bc' ? lookupResults.get(row.node) : null;
    const alias = lookup?.node?.alias ? safeLabel(lookup.node.alias) : null;
    const mainnet = row.network === 'bc';
    const identityTitle =
      `${row.node} · ${NETWORK_LABELS[row.network]}` + (alias ? ` · ${alias}` : '');

    return el(
      'div',
      { class: 'rank-row' },
      el('span', { class: 'rank-number' }, String(index + 1).padStart(2, '0')),
      el(
        'div',
        {},
        el(
          'div',
          { class: 'rank-name' },
          el(
            'span',
            { class: 'rank-identity' },
            el(
              'span',
              { class: 'name', title: identityTitle },
              alias || shortKey(row.node),
              mainnet ? '' : ` · ${NETWORK_LABELS[row.network]}`,
            ),
            knownBadge(row.known),
          ),
          el(
            'span',
            { class: 'value' },
            this.metric === 'count' ? `${number(row.count)} inv.` : `${sats(row.amount)} sats`,
          ),
        ),
        bar(this.metricRatio(row, maximum), this.target ? 'var(--teal)' : 'var(--violet)'),
      ),
      el(
        'div',
        { class: 'rank-links' },
        mainnet
          ? el(
              'a',
              {
                href: `https://terminal.lightning.engineering/explore/${row.node}`,
                target: '_blank',
                rel: 'noopener noreferrer',
                referrerpolicy: 'no-referrer',
                'aria-label': `View node ${row.node} on Lightning Terminal`,
              },
              '↗',
            )
          : el('span', { class: 'muted' }, 'test'),
      ),
    );
  }

  renderChart() {
    const rows = this.sorted(this.metric, true).slice(0, 7);
    const maximum = rows[0]?.[this.metric] ?? 0;
    this.chart.replaceChildren(
      ...(rows.length
        ? rows.map((row, index) => this.renderRankRow(row, index, maximum))
        : [el('div', { class: 'empty-chart' }, 'No invoices in this window')]),
    );
  }

  // Public so scripts can export a panel's CSV without rendering it.
  toCsv(limit) {
    if (this.table) return this.table.toCsv(limit);
    return nodeRowsCsv(this.rows, {
      limit,
      sort: this.sort,
      descending: this.descending,
      target: this.target,
      lookupResults,
    });
  }

  async fetch() {
    if (this.demo || this.fetching) return;
    const rows = this.sorted(this.metric, true)
      .slice(0, Number(this.fetchCount.value))
      .filter((row) => row.network === 'bc');
    const nodes = [...new Set(rows.map((row) => row.node))];
    if (!nodes.length) {
      toast('No mainnet nodes in the selected top entries');
      return;
    }

    const confirmed = window.confirm(
      `Look up ${nodes.length} mainnet node IDs on mempool.space?\n\n` +
        'This reveals these public keys and your IP address to that service. No invoices, ' +
        'amounts, descriptions, or preimages are sent. Results describe today’s public network, ' +
        'not historical payment activity.\n\n' +
        `Up to ${MAX_LOOKUPS} distinct keys per tab; ${MAX_CONCURRENT_LOOKUPS} concurrent requests.`,
    );
    if (!confirmed) return;

    this.fetching = true;
    this.fetchButton.disabled = true;
    let done = 0;
    this.lookupStatus.textContent = `Fetching 0 / ${nodes.length}…`;
    await Promise.all(
      nodes.map(async (node) => {
        const result = await lookupNode(node);
        lookupResults.set(node, result);
        done++;
        this.lookupStatus.textContent =
          `Fetched ${done} / ${nodes.length}. Public-map data is current, not historical. ` +
          'Missing nodes may be private, offline, or absent from the map.';
      }),
    );
    this.fetching = false;
    this.update(this.rows, this.demo);
    window.dispatchEvent(new Event('node-info-updated'));
  }
}
