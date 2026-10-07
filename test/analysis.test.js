import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeText,
  aggregate,
  compactInvoice,
  timeBounds,
  timeline,
} from '../public/assets/analysis.js';
import { decodeInvoice } from '../public/assets/bolt11/bolt11.js';
import {
  bech32Decode,
  bech32Encode,
  bytesToWords,
  CHARSET,
} from '../public/assets/bolt11/bech32.js';
import { encodeSparkAddress, SPARK_SCID_SENTINEL } from '../public/assets/bolt11/spark.js';
import { hexToBytes, concatBytes } from '../public/assets/bolt11/bytes.js';
import { createDemo } from '../public/assets/demo.js';
import { csv, sats, safeLabel } from '../public/assets/ui/helpers.js';
import { KNOWN_NODES, knownNode } from '../public/assets/bolt11/known-nodes.js';
import { REAL_PAYMENT, SPEC_VALID, SPEC_INVALID, SPEC_NODE_ID } from './fixtures.js';

const SPARK_ROUTING_NODE = '039174f846626c6053ba80f5443d0db33da384f1dde135bf7080ba1eec465019c3';
const OTHER_SPARK_ROUTING_NODE =
  '02a98e8c590a1b5602049d6b21d8f4c8861970aa310762f42eae1b2be88372e924';
const UNKNOWN_NODE = '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad';

function appendTag(invoice, tag, words) {
  const { hrp, words: data } = bech32Decode(invoice);
  return bech32Encode(hrp, [
    ...data.slice(0, -104),
    CHARSET.indexOf(tag),
    words.length >> 5,
    words.length & 31,
    ...words,
    ...data.slice(-104),
  ]);
}
function replaceSignature(invoice, signature = new Array(104).fill(0)) {
  const { hrp, words } = bech32Decode(invoice);
  return bech32Encode(hrp, [...words.slice(0, -104), ...signature]);
}

test('real-world invoice: amount, private destination, real route, Spark detection', () => {
  const invoice = decodeInvoice(REAL_PAYMENT.bolt11);
  assert.equal(invoice.nodeId, REAL_PAYMENT.nodeId);
  assert.equal(invoice.amountMsat, 28605000n);
  assert.equal(invoice.signature.nodeIdInInvoice, true);
  assert.equal(invoice.signature.valid, undefined);
  const compact = compactInvoice(invoice);
  assert.equal(compact.rawHints, 2);
  assert.equal(compact.hints, 1);
  assert.equal(compact.spark, 'routehint');
  assert.deepEqual(compact.targets, [
    '039174f846626c6053ba80f5443d0db33da384f1dde135bf7080ba1eec465019c3',
  ]);
  assert.equal(compact.bolt11, undefined);
  assert.equal(compact.description.includes('Spark'), false);
});
for (const [i, vector] of SPEC_VALID.entries())
  test(`BOLT11 official vector ${i}: recovery and exact amounts`, () => {
    const invoice = decodeInvoice(vector.bolt11);
    assert.equal(invoice.nodeId, SPEC_NODE_ID);
    assert.equal(invoice.amountMsat, vector.amountMsat);
    assert.equal(invoice.signature.nodeIdInInvoice, false);
    if (vector.description) assert.equal(invoice.description, vector.description);
  });
for (const vector of SPEC_INVALID)
  test(`reject ${vector.reason}`, () =>
    assert.throws(() => decodeInvoice(vector.bolt11), vector.error));

test('signature verification is deliberately skipped, recovery still required without n', () => {
  assert.equal(decodeInvoice(replaceSignature(REAL_PAYMENT.bolt11)).nodeId, REAL_PAYMENT.nodeId);
  assert.throws(() => decodeInvoice(replaceSignature(SPEC_VALID[0].bolt11)), /recover/);
});
test('Spark version-31 fallback recognized without route hint', () => {
  const address = encodeSparkAddress(SPEC_NODE_ID, 'bc');
  const invoice = appendTag(SPEC_VALID[0].bolt11, 'f', [
    31,
    ...bytesToWords(new TextEncoder().encode(address)),
  ]);
  assert.equal(decodeInvoice(invoice).spark.source, 'fallback');
});
test('bounded decoding, bad integer, invalid node key and route framing', () => {
  assert.throws(() => decodeInvoice('lnbc' + 'q'.repeat(40000)), /too long/);
  assert.throws(
    () => decodeInvoice(appendTag(SPEC_VALID[0].bolt11, 'x', new Array(15).fill(31))),
    /integer/,
  );
  assert.throws(
    () => decodeInvoice(appendTag(SPEC_VALID[0].bolt11, 'n', bytesToWords(new Uint8Array(33)))),
    /public key/,
  );
  assert.throws(
    () => decodeInvoice(appendTag(SPEC_VALID[0].bolt11, 'r', bytesToWords(new Uint8Array(50)))),
    /truncated/,
  );
});
test('duplicate normalization, mixed case does not bypass validation, errors have line numbers', async () => {
  const input =
    '\n' +
    REAL_PAYMENT.bolt11 +
    '\nlightning:' +
    REAL_PAYMENT.bolt11.toUpperCase() +
    '\n' +
    REAL_PAYMENT.bolt11.replace('lnbc', 'lNbc') +
    '\nnot-an-invoice\n';
  const result = await analyzeText(input);
  assert.equal(result.records.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected, 2);
  assert.deepEqual(
    result.issues.map((i) => i.line),
    [4, 5],
  );
  assert.equal(result.records[0].copies, 2);
  assert.equal(aggregate(result.records).count, 1);
  assert.equal(aggregate(result.records, { includeDuplicates: true }).count, 2);
});
test('compact records discard raw invoice details while retaining statistical signals', () => {
  const invoice = decodeInvoice(REAL_PAYMENT.bolt11);
  invoice.description = 'private-description-sentinel';
  invoice.paymentSecret = 'private-secret-sentinel';
  invoice.metadata = 'private-metadata-sentinel';
  const record = compactInvoice(invoice);
  const serialized = JSON.stringify(record, (_key, value) =>
    typeof value === 'bigint' ? String(value) : value,
  );

  assert.doesNotMatch(serialized, /private-.*-sentinel/);
  assert.equal(serialized.includes(REAL_PAYMENT.bolt11), false);
  assert.equal(record.description, 'Plain text');
  assert.equal(record.secret, true);
  assert.equal(record.metadata, true);
  for (const field of ['bolt11', 'fields', 'routeHints', 'paymentSecret', 'signature']) {
    assert.equal(Object.hasOwn(record, field), false);
  }
});

test('progress is reported and control yielded once the interval elapses, then a final exact report', async (t) => {
  let clock = 0;
  let yields = 0;
  const progress = [];
  // Each clock read advances far beyond the progress interval, so every line reports and yields.
  t.mock.method(performance, 'now', () => (clock += 1_000));
  const result = await analyzeText(
    ` \n${REAL_PAYMENT.bolt11}\n${REAL_PAYMENT.bolt11.toUpperCase()}\ninvalid\n`,
    (update) => progress.push(update),
    async () => { yields++; },
  );

  assert.equal(result.lines, 4);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.issues[0].line, 4);
  assert.equal(yields, 4);
  assert.equal(progress.length, yields + 1);
  assert.deepEqual(progress.at(-1), { fraction: 1, processed: 3, accepted: 1, rejected: 1 });
  assert.deepEqual(progress.map(({ processed }) => processed), [0, 1, 2, 3, 3]);
  assert.ok(progress.every(({ fraction }) => fraction >= 0 && fraction <= 1));
});

test('error samples are bounded but rejected count is exact', async () => {
  const result = await analyzeText(Array(120).fill('invalid').join('\n'));
  assert.equal(result.rejected, 120);
  assert.equal(result.issues.length, 100);
});
test('alternative targets deduplicate per invoice, never include Spark identity', () => {
  const decoded = decodeInvoice(REAL_PAYMENT.bolt11);
  decoded.routeHints.push(decoded.routeHints[0]);
  assert.equal(compactInvoice(decoded).targets.length, 1);
  const extraRoute = structuredClone(decoded.routeHints[0]);
  extraRoute[0].pubkey = SPEC_NODE_ID;
  decoded.routeHints.push(extraRoute);
  const row = compactInvoice(decoded);
  const stats = aggregate([row]);
  assert.equal(stats.destinations.length, 1);
  assert.equal(stats.targets.length, 2);
  assert.equal(stats.targetAssignments, 2);
  assert.equal(
    stats.targets.reduce((s, r) => s + r.amount, 0n),
    stats.total * 2n,
  );
});
test('Spark-only marker hints fall back to destination', () => {
  const invoice = decodeInvoice(REAL_PAYMENT.bolt11);
  invoice.routeHints = invoice.routeHints.filter((hops) =>
    hops.some((h) => h.shortChannelId.hex === SPARK_SCID_SENTINEL),
  );
  const record = compactInvoice(invoice);
  const stats = aggregate([record]);
  assert.equal(record.hints, 0);
  assert.equal(stats.targets[0].node, REAL_PAYMENT.nodeId);
});
test('known-nodes registry is authoritative, well-formed and only lists the documented Spark nodes', () => {
  const entries = Object.entries(KNOWN_NODES);
  assert.equal(entries.length, 2);
  for (const [key, info] of entries) {
    assert.match(key, /^0[23][0-9a-f]{64}$/);
    assert.equal(typeof info.label, 'string');
    assert.equal(typeof info.operator, 'string');
    assert.equal(info.source, 'https://docs.spark.money/learn/lightning#routing-nodes');
    assert.equal(info.network, 'bc');
  }
  assert.ok(KNOWN_NODES[SPARK_ROUTING_NODE]);
  assert.ok(KNOWN_NODES[OTHER_SPARK_ROUTING_NODE]);
  assert.equal(KNOWN_NODES[UNKNOWN_NODE], undefined);
  assert.equal(knownNode('bc', 'toString'), null);
});
test('mainnet known nodes carry a label, testnet and unknown nodes never do', () => {
  const decoded = decodeInvoice(REAL_PAYMENT.bolt11);
  const stats = aggregate([compactInvoice(decoded)]);
  // The real fixture's route hint enters through a documented Spark routing node.
  const target = stats.targets.find((r) => r.node === SPARK_ROUTING_NODE);
  assert.equal(target.known.label, 'Spark routing node');
  assert.equal(target.known.operator, 'Spark (developed by Lightspark)');
  // Its destination is not one of the documented nodes.
  assert.equal(stats.destinations[0].known, null);
  assert.ok(compactInvoice(decoded).spark); // Spark marker detection doesn't grant a node badge.
  // A valid, but undocumented, node key remains unknown.
  const unknown = { ...compactInvoice(decoded), node: UNKNOWN_NODE, targets: [UNKNOWN_NODE] };
  const unknownStats = aggregate([unknown]);
  assert.equal(unknownStats.destinations[0].known, null);
  const mainnetKnown = {
    ...unknown,
    node: OTHER_SPARK_ROUTING_NODE,
    targets: [SPARK_ROUTING_NODE],
  };
  assert.equal(aggregate([mainnetKnown]).destinations[0].known.label, 'Spark routing node');
  // The documented keys on a different network must never be attributed.
  for (const network of ['tb', 'tbs', 'bcrt', 'sb']) {
    const testnetStats = aggregate([{ ...mainnetKnown, network }]);
    assert.equal(testnetStats.destinations[0].known, null);
    assert.equal(testnetStats.targets[0].known, null);
  }
  const { hrp, words } = bech32Decode(REAL_PAYMENT.bolt11);
  const decodedTestnet = decodeInvoice(bech32Encode(hrp.replace(/^lnbc/, 'lntb'), words));
  assert.equal(decodedTestnet.routeHints[0][0].knownAs, null);
});
test('empty r tags remain visible without being mislabeled as Spark markers', () => {
  const invoice = decodeInvoice(appendTag(SPEC_VALID[0].bolt11, 'r', []));
  const record = compactInvoice(invoice);
  assert.equal(record.rawHints, 1);
  assert.equal(record.hints, 0);
  assert.equal(record.markerOnly, false);
  const stats = aggregate([record]);
  assert.equal(stats.categories.rawRoutes.get('r tag present'), 1);
  assert.equal(stats.categories.markerOnly, undefined);
  assert.equal(stats.targets[0].node, record.node);
});
test('empty input and no-data window return complete safe zero results', async () => {
  const empty = await analyzeText(' \n\r\n');
  assert.equal(empty.nonempty, 0);
  const stats = aggregate([]);
  assert.equal(stats.count, 0);
  assert.equal(stats.total, 0n);
  assert.equal(stats.median, null);
  assert.equal(
    aggregate([compactInvoice(decodeInvoice(REAL_PAYMENT.bolt11))], { from: 0, to: 1 }).count,
    0,
  );
});
test('time and network boundaries are inclusive and do not mix node networks', () => {
  const a = compactInvoice(decodeInvoice(REAL_PAYMENT.bolt11));
  const b = { ...a, timestamp: a.timestamp + 10, network: 'tb', copies: 2 };
  const records = [a, b];
  const bounds = timeBounds(records);
  assert.equal(aggregate(records, { from: a.timestamp, to: a.timestamp }).count, 1);
  assert.equal(aggregate(records, { network: 'tb', includeDuplicates: true }).count, 2);
  assert.equal(aggregate(records).destinations.length, 2);
  const bins = timeline(records, bounds, {
    from: a.timestamp,
    to: a.timestamp,
    network: 'all',
    includeDuplicates: true,
  });
  assert.equal(
    bins.reduce((s, v) => s + v.count, 0),
    3,
  );
  assert.equal(
    bins.reduce((s, v) => s + v.selected, 0),
    1,
  );
  assert.equal(
    timeline([a], timeBounds([a]), { from: a.timestamp, to: a.timestamp }).reduce(
      (s, v) => s + v.selected,
      0,
    ),
    1,
  );
});
test('BigInt totals, fractional sats, weighted median, p90 and logarithmic buckets', () => {
  const a = compactInvoice(decodeInvoice(REAL_PAYMENT.bolt11));
  const records = [null, 0n, 1n, 100_000n, 1_000_000n, 100_000_000n, 2n ** 80n].map(
    (amount, i) => ({ ...a, amount, copies: 1, paymentHash: String(i) }),
  );
  const stats = aggregate(records);
  assert.equal(stats.count, 7);
  assert.equal(stats.amountless, 1);
  assert.equal(stats.total, 2n ** 80n + 101_100_001n);
  assert.equal(stats.median, 550_000n);
  assert.equal(stats.p90, 2n ** 80n);
  assert.equal(
    stats.histogram.reduce((s, v) => s + v.count, 0),
    6,
  );
  assert.equal(stats.histogram[0].count, 1);
  assert.equal(stats.histogram[1].count, 1);
  assert.equal(sats(1001n), '1.001');
  assert.equal(sats(1234560n), '1,234.56');
  const weighted = aggregate(
    [
      { ...a, amount: 1000n, copies: 3 },
      { ...a, amount: 9000n },
    ],
    { includeDuplicates: true },
  );
  assert.equal(weighted.median, 1000n);
});
test('non-conforming d/h combinations and unknown tagged fields remain visible', () => {
  let invoice = appendTag(REAL_PAYMENT.bolt11, 'h', bytesToWords(new Uint8Array(32)));
  invoice = appendTag(invoice, 'j', [1, 2, 3]);
  const row = compactInvoice(decodeInvoice(invoice));
  assert.equal(row.description, 'Both (non-conforming)');
  assert.equal(row.extension, true);
});
test('secret/metadata/features/hint-hop categories count invoices rather than repeated paths', () => {
  const a = compactInvoice(decodeInvoice(SPEC_VALID[3].bolt11));
  a.hopLengths = [1, 1, 2];
  const stats = aggregate([a]);
  assert.equal(stats.categories.hops.get('1 hop'), 1);
  assert.equal(stats.categories.hops.get('2 hops'), 1);
  assert.equal(stats.categories.secret.get('Payment secret'), 1);
});
test('same hashes in different strings are flagged but not merged', async () => {
  const data = await analyzeText(
    SPEC_VALID.slice(0, 3)
      .map((v) => v.bolt11)
      .join('\n'),
  );
  const stats = aggregate(data.records);
  assert.equal(stats.count, 3);
  assert.equal(stats.repeatedHashes, 2);
});
test('default demo: 3,000 unique invoices across the past three years, plus two duplicates', async (t) => {
  const now = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now });
  const text = createDemo();
  assert.equal(text.split('\n').length, 3002);
  assert.equal(createDemo(), text);
  const result = await analyzeText(text);
  assert.equal(result.rejected, 0);
  assert.equal(result.records.length, 3000);
  assert.equal(result.duplicates, 2);

  const day = 86400;
  const end = now / 1000;
  const start = end - 3 * 365 * day;
  for (const record of result.records) {
    assert.ok(record.timestamp >= start && record.timestamp <= end);
  }
  const bounds = timeBounds(result.records);
  assert.ok(bounds.from < start + day, 'oldest invoice is within a day of the window start');
  assert.ok(bounds.to > end - day, 'newest invoice is within a day of the window end');
});
test('demo time windows change activity, rankings, amounts, and invoice mixes', async (t) => {
  const now = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now });
  const { records } = await analyzeText(createDemo());
  const span = 3 * 365 * 86400;
  const start = now / 1000 - span;
  const periods = Array.from({ length: 6 }, (_, index) => aggregate(records, {
    from: start + index * span / 6,
    to: start + (index + 1) * span / 6 - 1,
  }));
  const share = (stats, category, label) =>
    (stats.categories[category].get(label) ?? 0) / stats.count;
  const [launch, rush, large, lull, spark, recent] = periods;

  assert.equal(periods.reduce((sum, stats) => sum + stats.count, 0), 3000);
  assert.ok(periods.every((stats) => stats.count > 100));
  assert.ok(rush.count > launch.count * 3);
  assert.ok(spark.count > lull.count * 3);
  assert.equal(new Set(periods.map((stats) => stats.destinations[0].key)).size, 6);
  assert.ok(new Set(periods.map((stats) => stats.targets[0].key)).size >= 3);
  assert.ok(large.median > rush.median * 100n);
  assert.ok(recent.median > spark.median * 100n);
  assert.ok(lull.amountless / lull.count > recent.amountless / recent.count + 0.15);
  assert.ok(share(spark, 'spark', 'Spark detected') - share(launch, 'spark', 'Spark detected') > 0.5);
  assert.ok(share(recent, 'routes', 'Real route hints') - share(launch, 'routes', 'Real route hints') > 0.6);
  assert.ok(share(recent, 'expiry', '> 1 day') - share(launch, 'expiry', '> 1 day') > 0.5);
  assert.ok(share(recent, 'cltv', '80 blocks') - share(launch, 'cltv', '80 blocks') > 0.5);
  assert.ok(share(recent, 'description', 'Hash') - share(launch, 'description', 'Hash') > 0.5);

  const bins = timeline(records, timeBounds(records));
  // Each half-year contains both bursts and background activity, not flat blocks.
  for (let index = 0; index < 6; index++) {
    const counts = bins.slice(index * 8, (index + 1) * 8).map((bin) => bin.count);
    assert.ok(Math.min(...counts) > 0);
    assert.ok(Math.max(...counts) > Math.min(...counts) * 3);
  }
});
test('synthetic demo: diverse destinations, real route targets, Spark and amountless invoices', async () => {
  const result = await analyzeText(createDemo(200));
  assert.equal(result.rejected, 0);
  assert.equal(result.records.length, 200);
  assert.equal(result.duplicates, 2);
  const stats = aggregate(result.records);
  assert.ok(stats.destinations.length >= 10);
  assert.ok(stats.categories.spark.get('Spark detected') > 0);
  assert.ok(stats.amountless > 0);
  assert.ok(stats.targets.length > 1);
});
test('CSV escaping and aliases cannot produce spreadsheet formulas or bidi spoofing', () => {
  assert.equal(
    csv([['=HYPERLINK("evil")', 'a,b', '@x', 'line\nbreak']]),
    '"\'=HYPERLINK(""evil"")","a,b","\'@x","line\nbreak"',
  );
  assert.equal(safeLabel('node\u202espoof\u0000'), 'nodespoof');
});
