import assert from 'node:assert/strict';
import { test } from 'node:test';
import { btc, csv, number, percent, safeLabel, sats, utcDate, utcInput } from '../public/assets/ui/helpers.js';
import { nodeRowsCsv, NodeTable, sortNodeRows } from '../public/assets/ui/node-table.js';
import { NodePanel } from '../public/assets/ui/node-panel.js';

const source = 'https://docs.spark.money/learn/lightning#routing-nodes';
const rows = [
  { key: 'bc:b', node: 'b', network: 'bc', count: 3, amount: 2n ** 80n, amountless: 1, known: null },
  { key: 'bc:a', node: 'a', network: 'bc', count: 3, amount: 2n ** 80n + 1n, amountless: 0,
    known: { label: 'Spark routing node', source } },
  { key: 'tb:a', node: 'a', network: 'tb', count: 1, amount: 0n, amountless: 1, known: null },
];
const header = [
  'node_id', 'network', 'invoices', 'requested_amount_msat', 'amountless_invoices',
  'alias', 'current_public_channels', 'current_capacity_sat', 'known_node', 'known_node_source',
];

test('node sorting is exact, deterministic on ties, and never mutates source rows', () => {
  const before = structuredClone(rows);
  const keys = (key, descending) => sortNodeRows(rows, key, descending).map((row) => row.key);
  assert.deepEqual(keys('count', true), ['bc:a', 'bc:b', 'tb:a']);
  assert.deepEqual(keys('count', false), ['tb:a', 'bc:a', 'bc:b']);
  assert.deepEqual(keys('amount', true), ['bc:a', 'bc:b', 'tb:a']);
  assert.deepEqual(keys('amount', false), ['tb:a', 'bc:b', 'bc:a']);
  assert.deepEqual(keys('node', false), ['bc:a', 'bc:b', 'tb:a']);
  assert.deepEqual(keys('node', true), ['tb:a', 'bc:b', 'bc:a']);
  assert.deepEqual(keys('amountless', true), ['bc:b', 'tb:a', 'bc:a']);
  assert.deepEqual(rows, before);
});

test('CSV retains exact millisatoshis, primary sources, and mainnet-only enrichment', () => {
  const lookupResults = new Map([
    ['a', { status: 'public', node: { alias: '=evil\u202e\u0000', active_channel_count: 0, capacity: '9999999999999999' } }],
    ['b', { status: 'unknown' }],
  ]);
  assert.equal(nodeRowsCsv(rows, { limit: 'all', lookupResults }), csv([
    header,
    ['a', 'mainnet', 3, 2n ** 80n + 1n, 0, '=evil', 0, '9999999999999999', 'Spark routing node', source],
    ['b', 'mainnet', 3, 2n ** 80n, 1, '', '', '', '', ''],
    ['a', 'testnet', 1, 0n, 1, '', '', '', '', ''],
  ]));
});

test('CSV applies the requested sort before limiting and labels overlapping target amounts', () => {
  const result = nodeRowsCsv(rows, { limit: '1', sort: 'amount', descending: false, target: true });
  assert.equal(result, csv([
    header.map((name) => name === 'requested_amount_msat' ? 'attributed_amount_msat_non_additive' : name),
    ['a', 'testnet', 1, 0n, 1, '', '', '', '', ''],
  ]));
  assert.equal(nodeRowsCsv([], { limit: 'all' }), csv([header]));
  assert.equal(nodeRowsCsv(rows, { limit: 0 }), csv([header]));
});

test('NodeTable and NodePanel toCsv match nodeRowsCsv for the current sort', () => {
  const table = Object.assign(Object.create(NodeTable.prototype), {
    rows, sort: 'amount', descending: true, target: true, lookupResults: new Map(),
  });
  const panel = Object.assign(Object.create(NodePanel.prototype), {
    rows, sort: 'amount', descending: true, target: true,
  });
  const expected = nodeRowsCsv(rows, { limit: 'all', sort: 'amount', target: true });
  assert.equal(table.toCsv('all'), expected);
  assert.equal(panel.toCsv('all'), expected); // Supported without constructing a DOM table.
  panel.table = table;
  assert.equal(panel.toCsv('all'), table.toCsv('all'));
});

test('table updates clamp pagination and defer rendering closed nonempty tables', () => {
  let renders = 0;
  const table = Object.assign(Object.create(NodeTable.prototype), {
    page: 4, element: { open: false }, render() { renders++; },
  });
  table.update(Array(51).fill(rows[0]));
  assert.equal(table.page, 2);
  assert.equal(renders, 0);
  table.element.open = true;
  table.update(Array(25).fill(rows[0]));
  assert.equal(table.page, 0);
  assert.equal(renders, 1);
  table.element.open = false;
  table.update([]);
  assert.equal(table.page, 0);
  assert.equal(renders, 2); // Clearing must remove stale rows even in a closed table.
});

test('monetary display keeps fractional and very large values exact', () => {
  for (const [value, expected] of [
    [null, '—'], [undefined, '—'], [0n, '0'], [1n, '0.001'], [10n, '0.01'],
    [100n, '0.1'], [1000n, '1'], [1234560n, '1,234.56'],
    [9007199254740991001n, '9,007,199,254,740,991.001'],
  ]) assert.equal(sats(value), expected);
  for (const [value, expected] of [
    [0, '0.0 BTC'], [1, '0.00000001 BTC'], ['100000000', '1.0 BTC'],
    [123456789n, '1.23456789 BTC'], ['9999999999999999', '99,999,999.99999999 BTC'],
  ]) assert.equal(btc(value), expected);
  assert.equal(number(1234567n), '1,234,567');
  assert.equal(percent(1, 8), '12.5%');
  assert.equal(percent(0, 0), '0%');
  assert.equal(utcDate(0), '1970-01-01');
  assert.equal(utcInput(0), '1970-01-01T00:00:00');
});

test('CSV quoting covers all formula prefixes, whitespace, embedded quotes, and missing cells', () => {
  assert.equal(csv([['=x', '+x', '-x', '@x', ' \t=x', '"quoted",value', null, undefined, 0n]]),
    '"\'=x","\'+x","\'-x","\'@x","\' \t=x","""quoted"",value","","","0"');
  assert.equal(csv([['line\nbreak'], ['next']]), '"line\nbreak"\r\n"next"');
  assert.equal(csv([]), '');
});

test('display labels strip every supported control range before truncation', () => {
  const controls = '\u0000\u001f\u007f\u0080\u009f\u202a\u202e\u2066\u2069';
  assert.equal(safeLabel(`⚡${controls}<b>node</b>`), '⚡<b>node</b>');
  assert.equal(safeLabel(controls + 'a'.repeat(200)), 'a'.repeat(128));
  assert.equal(safeLabel(123), '123');
});
