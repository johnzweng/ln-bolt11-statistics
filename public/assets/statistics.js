// Pure aggregation and time-series calculations over compact invoice records.
import { knownNode } from './bolt11/known-nodes.js';

export const AMOUNT_BUCKETS = [
  ['0 sats', 0n, 1n],
  ['< 100 sats', 1n, 100_000n],
  ['100–1k', 100_000n, 1_000_000n],
  ['1k–10k', 1_000_000n, 10_000_000n],
  ['10k–100k', 10_000_000n, 100_000_000n],
  ['100k–1M', 100_000_000n, 1_000_000_000n],
  ['≥ 1M sats', 1_000_000_000n, null],
];

const increment = (map, key, count) => map.set(key, (map.get(key) ?? 0) + count);

export function nodeKey(network, node) {
  return `${network}:${node}`;
}

function createAggregation() {
  return {
    count: 0,
    total: 0n,
    amountless: 0,
    repeatedHashes: 0,
    targetAssignments: 0,
    destinations: new Map(),
    targets: new Map(),
    categories: {},
    amounts: [],
    hashes: new Set(),
    histogram: AMOUNT_BUCKETS.map(([label]) => ({ label, count: 0, amount: 0n })),
  };
}

function addCategory(result, name, label, weight) {
  result.categories[name] ??= new Map();
  increment(result.categories[name], label, weight);
}

function addNode(nodes, record, node, weight) {
  const key = nodeKey(record.network, node);
  if (!nodes.has(key)) {
    nodes.set(key, {
      key,
      node,
      network: record.network,
      count: 0,
      amount: 0n,
      amountless: 0,
      known: knownNode(record.network, node),
    });
  }

  const row = nodes.get(key);
  row.count += weight;
  if (record.amount === null) row.amountless += weight;
  else row.amount += record.amount * BigInt(weight);
}

// 3,600 → "1 hour (default)".
function expiryBucket(seconds) {
  if (seconds < 3600) return '< 1 hour';
  if (seconds === 3600) return '1 hour (default)';
  if (seconds <= 86400) return '> 1 hour–1 day';
  return '> 1 day';
}

function addAmount(result, record, weight) {
  if (record.amount === null) {
    result.amountless += weight;
    return;
  }

  const weightedAmount = record.amount * BigInt(weight);
  result.total += weightedAmount;
  result.amounts.push({ value: record.amount, weight });
  const bucketIndex = AMOUNT_BUCKETS.findIndex(
    ([, min, max]) => record.amount >= min && (max === null || record.amount < max),
  );
  result.histogram[bucketIndex].count += weight;
  result.histogram[bucketIndex].amount += weightedAmount;
}

function addCategories(result, record, weight) {
  addCategory(result, 'routes', record.hints ? 'Real route hints' : 'No real route hints', weight);
  addCategory(result, 'rawRoutes', record.rawHints ? 'r tag present' : 'No r tag', weight);
  addCategory(result, 'spark', record.spark ? 'Spark detected' : 'No Spark marker', weight);
  if (record.markerOnly) {
    addCategory(result, 'markerOnly', 'Spark marker hints only', weight);
  }
  addCategory(result, 'description', record.description, weight);
  addCategory(
    result,
    'key',
    record.explicitKey ? 'Explicit n tag' : 'Recovered from signature',
    weight,
  );
  addCategory(result, 'expiry', expiryBucket(record.expiry), weight);
  addCategory(result, 'cltv', `${record.cltv} blocks`, weight);
  addCategory(
    result,
    'hintCount',
    record.hints > 3 ? '4+ routes' : `${record.hints} routes`,
    weight,
  );
  addCategory(result, 'network', record.network, weight);
  addCategory(result, 'secret', record.secret ? 'Payment secret' : 'No payment secret', weight);
  addCategory(result, 'metadata', record.metadata ? 'Metadata' : 'No metadata', weight);
  addCategory(
    result,
    'fallback',
    record.fallback ? 'On-chain fallback' : 'No on-chain fallback',
    weight,
  );
  if (record.extension) {
    addCategory(result, 'extensions', 'Unknown tagged fields', weight);
  }
  for (const feature of record.features) {
    addCategory(result, 'features', feature, weight);
  }
  for (const hops of new Set(record.hopLengths)) {
    addCategory(result, 'hops', `${hops} hop${hops === 1 ? '' : 's'}`, weight);
  }
}

function addRecord(result, record, includeDuplicates) {
  const weight = includeDuplicates ? record.copies : 1;
  result.count += weight;
  addAmount(result, record, weight);

  const hashKey = `${record.network}:${record.paymentHash}`;
  if (result.hashes.has(hashKey)) result.repeatedHashes++;
  result.hashes.add(hashKey);

  addNode(result.destinations, record, record.node, weight);
  const effectiveTargets = record.targets.length ? record.targets : [record.node];
  for (const node of effectiveTargets) {
    addNode(result.targets, record, node, weight);
    result.targetAssignments += weight;
  }

  addCategories(result, record, weight);
}

function valueAtRank(amounts, rank) {
  let accumulated = 0;
  for (const entry of amounts) {
    accumulated += entry.weight;
    if (accumulated > rank) return entry.value;
  }
  return null;
}

function sortedNodes(nodes) {
  return [...nodes.values()].sort(
    (a, b) =>
      b.count - a.count ||
      (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.key.localeCompare(b.key)),
  );
}

function finishAggregation(result, unique) {
  result.amounts.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const amountCount = result.count - result.amountless;
  const rankedValue = (rank) => valueAtRank(result.amounts, rank);
  const median = amountCount
    ? (rankedValue(Math.floor((amountCount - 1) / 2)) + rankedValue(Math.floor(amountCount / 2))) /
      2n
    : null;

  return {
    count: result.count,
    total: result.total,
    amountless: result.amountless,
    amountCount,
    median,
    p90: amountCount ? rankedValue(Math.ceil(amountCount * 0.9) - 1) : null,
    destinations: sortedNodes(result.destinations),
    targets: sortedNodes(result.targets),
    categories: result.categories,
    histogram: result.histogram,
    repeatedHashes: result.repeatedHashes,
    targetAssignments: result.targetAssignments,
    unique,
  };
}

/** Aggregate the selected time/network window into all dashboard statistics. */
export function aggregate(
  records,
  { from = -Infinity, to = Infinity, network = 'all', includeDuplicates = false } = {},
) {
  const selected = records.filter(
    (record) =>
      record.timestamp >= from &&
      record.timestamp <= to &&
      (network === 'all' || record.network === network),
  );
  const result = createAggregation();
  for (const record of selected) addRecord(result, record, includeDuplicates);
  return finishAggregation(result, selected.length);
}

export function timeBounds(records) {
  let from = Infinity;
  let to = -Infinity;
  for (const record of records) {
    from = Math.min(from, record.timestamp);
    to = Math.max(to, record.timestamp);
  }
  return { from, to };
}

export function timeline(records, bounds, options = {}, bins = 48) {
  const values = Array.from({ length: bins }, (_, index) => ({
    from: bounds.from + ((bounds.to - bounds.from + 1) * index) / bins,
    to: bounds.from + ((bounds.to - bounds.from + 1) * (index + 1)) / bins,
    count: 0,
    selected: 0,
  }));

  for (const record of records) {
    if (options.network !== 'all' && options.network && record.network !== options.network) {
      continue;
    }
    const index = Math.min(
      bins - 1,
      Math.floor(((record.timestamp - bounds.from) / (bounds.to - bounds.from + 1)) * bins),
    );
    const weight = options.includeDuplicates ? record.copies : 1;
    values[index].count += weight;
    if (record.timestamp >= options.from && record.timestamp <= options.to) {
      values[index].selected += weight;
    }
  }
  return values;
}
