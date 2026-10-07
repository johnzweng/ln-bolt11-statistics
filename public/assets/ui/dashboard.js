// Dashboard rendering. Domain calculations stay in statistics.js; this module owns the DOM views.
import {
  MAX_FIELDS,
  MAX_INVOICE_LENGTH,
  MAX_ISSUE_SAMPLES,
  MAX_ROUTE_HOPS,
} from '../bolt11/input.js';
import { aggregate, timeline } from '../statistics.js';
import { amountHistogram, donut, miniBars, timelineChart } from './charts.js';
import { el, number, percent, sats, utcInput } from './helpers.js';

const $ = (id) => document.getElementById(id);

function metric(label, value, unit, detail) {
  return el(
    'div',
    { class: 'metric' },
    el('div', { class: 'metric-label' }, label),
    el('div', { class: 'metric-value' }, value, unit ? el('span', { class: 'unit' }, unit) : null),
    el('div', { class: 'metric-detail' }, detail),
  );
}

function contextRow(label, value) {
  return el('div', { class: 'context-item' }, label, el('b', {}, value));
}

export function renderInputQuality(dataset) {
  $('quality-summary').textContent =
    `Input quality · ${number(dataset.rejected)} rejected · ` +
    `${number(dataset.duplicates)} duplicate lines excluded by default`;

  $('quality-details').replaceChildren(
    el(
      'p',
      {},
      `${number(dataset.nonempty)} non-empty input lines. ` +
        `${number(dataset.records.length)} distinct decoded invoice strings. ` +
        'Exact invoice duplicates (case and lightning: prefix normalized) are excluded unless enabled above. ' +
        'Different invoices with the same payment hash are not merged.',
    ),
    el(
      'p',
      {},
      'Decoding checks checksums, framing, and usable node keys. It is not a full BOLT11 validity check. ' +
        'Non-conforming descriptions and missing secrets remain visible in the statistics. ' +
        `Resource safeguards per invoice: ${number(MAX_INVOICE_LENGTH)} normalized characters, ` +
        `${number(MAX_FIELDS)} tags, ${number(MAX_ROUTE_HOPS)} route hops. ` +
        'There is no batch-count cap.',
    ),
    dataset.issues.length
      ? el(
          'ul',
          {},
          dataset.issues.map((issue) =>
            el('li', {}, `Line ${number(issue.line)}: ${issue.message}`),
          ),
        )
      : el('p', {}, 'All non-empty lines decoded.'),
    dataset.rejected > MAX_ISSUE_SAMPLES
      ? el(
          'p',
          {},
          `Only the first ${number(MAX_ISSUE_SAMPLES)} errors are shown; all rejected lines are counted.`,
        )
      : null,
  );
}

function renderMetrics(stats, includeDuplicates) {
  const topDestination = stats.destinations[0];
  $('metrics').replaceChildren(
    metric(
      'Invoices in view',
      number(stats.count),
      '',
      `${number(stats.unique)} unique invoice strings` +
        (includeDuplicates ? ' · duplicates included' : ' · duplicates excluded'),
    ),
    metric(
      'Requested amount',
      sats(stats.total),
      'sats',
      `${number(stats.amountless)} amountless invoices not included`,
    ),
    metric(
      'Unique destinations',
      number(stats.destinations.length),
      '',
      topDestination
        ? `Top destination: ${percent(topDestination.count, stats.count)} of invoices`
        : 'No destinations in this window',
    ),
    metric(
      'Median requested amount',
      sats(stats.median),
      stats.median === null ? '' : 'sats',
      'Fixed-amount invoices only · not actual payments',
    ),
  );
}

function renderAmounts(stats) {
  $('amount-chart').replaceChildren(amountHistogram(stats.histogram, stats.amountless));
  const summaries = [
    [sats(stats.amountCount ? stats.total / BigInt(stats.amountCount) : null), 'Mean · sats'],
    [sats(stats.p90), '90th percentile · sats'],
    [number(stats.amountless), 'Amountless invoices'],
  ];
  $('amount-summary').replaceChildren(
    ...summaries.map(([value, label]) => el('div', {}, el('b', {}, value), label)),
  );
}

function renderAnatomy(stats) {
  const categories = stats.categories;
  $('anatomy').replaceChildren(
    donut('Usable route hints', categories.routes, stats.count, 'Real route hints'),
    donut('Spark markers', categories.spark, stats.count, 'Spark detected'),
    donut('Description type', categories.description, stats.count, 'Plain text'),
    donut('Receiver key source', categories.key, stats.count, 'Explicit n tag'),
  );
  $('expiry-chart').replaceChildren(miniBars(categories.expiry, { denominator: stats.count }));
  $('cltv-chart').replaceChildren(
    miniBars(categories.cltv, {
      numeric: true,
      denominator: stats.count,
      color: 'var(--teal)',
    }),
  );
  $('hints-chart').replaceChildren(
    miniBars(categories.hintCount, {
      numeric: true,
      denominator: stats.count,
      color: 'var(--orange)',
    }),
  );
  $('features-chart').replaceChildren(
    el('div', { class: 'context-title' }, 'Advertised feature bits · share of invoices'),
    miniBars(categories.features, { maxItems: 12, denominator: stats.count }),
    el(
      'p',
      { class: 'fine-print' },
      'Features can overlap. Required / optional refers to the advertised feature bit; ' +
        'unsupported extensions are not interpreted. “Other” aggregates feature occurrences, ' +
        'not distinct invoices.',
    ),
  );
}

function renderContext(stats) {
  const categories = stats.categories;
  const rawHints = categories.rawRoutes?.get('r tag present') ?? 0;
  const topFiveCount = stats.destinations.slice(0, 5).reduce((sum, row) => sum + row.count, 0);

  $('context').replaceChildren(
    el('div', { class: 'context-title' }, 'Additional signals'),
    contextRow(
      'r tag present (including Spark markers)',
      `${number(rawHints)} / ${number(stats.count)}`,
    ),
    contextRow('No r tag', `${number(stats.count - rawHints)} / ${number(stats.count)}`),
    contextRow(
      'Only Spark marker hints',
      number(categories.markerOnly?.get('Spark marker hints only') ?? 0),
    ),
    contextRow('Top 5 destinations · share of invoices', percent(topFiveCount, stats.count)),
    contextRow('Networks represented', number(categories.network?.size ?? 0)),
    contextRow(
      'Payment secret present',
      `${number(categories.secret?.get('Payment secret') ?? 0)} / ${number(stats.count)}`,
    ),
    contextRow('Payment metadata present', number(categories.metadata?.get('Metadata') ?? 0)),
    contextRow(
      'On-chain fallback present',
      number(categories.fallback?.get('On-chain fallback') ?? 0),
    ),
    contextRow('Same hash in different invoice strings', number(stats.repeatedHashes)),
    contextRow(
      'Unknown tagged fields present',
      number(categories.extensions?.get('Unknown tagged fields') ?? 0),
    ),
    contextRow('Routing target attributions (non-additive)', number(stats.targetAssignments)),
    el(
      'p',
      { class: 'fine-print' },
      'No Spark marker means “not detected,” not proof a wallet is unrelated to Spark. ' +
        'A hash description cannot reveal its original text. Public channel capacity is not ' +
        'spendable liquidity.',
    ),
  );
}

/** Recompute the selected window and update every linked dashboard view. */
export function renderDashboard({
  dataset,
  bounds,
  options,
  datasetIsDemo,
  destinations,
  targets,
}) {
  const stats = aggregate(dataset.records, options);

  $('timeline').replaceChildren(timelineChart(timeline(dataset.records, bounds, options)));
  $('window-label').textContent =
    `${number(stats.count)} invoices selected · ` +
    `${utcInput(options.from).replace('T', ' ')} — ` +
    `${utcInput(options.to).replace('T', ' ')} UTC`;
  $('empty-window').hidden = stats.count !== 0;

  renderMetrics(stats, options.includeDuplicates);
  destinations.update(stats.destinations, datasetIsDemo);
  targets.update(stats.targets, datasetIsDemo);
  renderAmounts(stats);
  renderAnatomy(stats);
  renderContext(stats);
  return stats;
}
