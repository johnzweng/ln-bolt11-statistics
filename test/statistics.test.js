import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, timeBounds, timeline } from '../public/assets/statistics.js';

// Compact records keep these tests independent of decoding and signature recovery.
const baseRecord = {
  timestamp: 100,
  network: 'bc',
  amount: 1000n,
  node: 'destination',
  explicitKey: true,
  paymentHash: 'hash',
  targets: [],
  rawHints: 0,
  hints: 0,
  hopLengths: [],
  spark: null,
  markerOnly: false,
  description: 'Plain text',
  expiry: 3600,
  cltv: 18,
  secret: true,
  metadata: false,
  fallback: false,
  features: [],
  extension: false,
  copies: 1,
};

test('weighted statistics keep unique strings and repeated hashes separate from copies', () => {
  const records = [
    { ...baseRecord, amount: 1001n, copies: 3, targets: ['entry-a', 'entry-b'] },
    { ...baseRecord, timestamp: 101, amount: 9000n },
    { ...baseRecord, network: 'tb', amount: null, copies: 2 },
  ];
  const before = structuredClone(records);
  const stats = aggregate(records, { includeDuplicates: true });

  assert.equal(stats.unique, 3);
  assert.equal(stats.count, 6);
  assert.equal(stats.amountCount, 4);
  assert.equal(stats.amountless, 2);
  assert.equal(stats.total, 12003n);
  assert.equal(stats.median, 1001n);
  assert.equal(stats.p90, 9000n);
  // Copies of one string do not create extra repeated-hash warnings.
  // The same hash on testnet is independent of its mainnet counterpart.
  assert.equal(stats.repeatedHashes, 1);
  assert.equal(stats.targetAssignments, 9);
  assert.equal(stats.categories.description.get('Plain text'), 6);
  assert.deepEqual(
    stats.targets.map(({ key, count, amount }) => ({ key, count, amount })),
    [
      { key: 'bc:entry-a', count: 3, amount: 3003n },
      { key: 'bc:entry-b', count: 3, amount: 3003n },
      { key: 'tb:destination', count: 2, amount: 0n },
      { key: 'bc:destination', count: 1, amount: 9000n },
    ],
  );
  assert.deepEqual(records, before);
});

test('window aggregation matches explicit selection, including invalid and empty windows', () => {
  const records = Array.from({ length: 120 }, (_, index) => ({
    ...baseRecord,
    timestamp: index,
    network: ['bc', 'tb', 'tbs', 'bcrt', 'sb'][index % 5],
    amount: index % 7 ? BigInt(index) * 100001n : null,
    paymentHash: String(index % 11),
    node: `destination-${index % 3}`,
    copies: 1 + (index % 4),
    targets: index % 2 ? ['entry-a', 'entry-b'] : [],
  }));
  const before = structuredClone(records);
  const windows = [
    {},
    { from: 0, to: 119 },
    { from: 12, to: 12 },
    { from: 17, to: 80, network: 'tb' },
    { from: 80, to: 17 },
    { from: NaN },
    { to: NaN },
    { network: 'unknown' },
  ];
  for (const window of windows) {
    for (const includeDuplicates of [false, true]) {
      const { from = -Infinity, to = Infinity, network = 'all' } = window;
      const selected = records.filter(
        (record) =>
          record.timestamp >= from &&
          record.timestamp <= to &&
          (network === 'all' || record.network === network),
      );
      assert.deepEqual(
        aggregate(records, { ...window, includeDuplicates }),
        aggregate(selected, { includeDuplicates }),
      );
    }
  }
  assert.deepEqual(records, before);
});

test('timeline bins use inclusive endpoints, network isolation, and duplicate weights', () => {
  const records = [
    { ...baseRecord, timestamp: 10, copies: 2 },
    { ...baseRecord, timestamp: 11 },
    { ...baseRecord, timestamp: 12, copies: 3 },
    { ...baseRecord, timestamp: 13, copies: 4 },
    { ...baseRecord, timestamp: 13, network: 'tb', copies: 8 },
  ];
  assert.deepEqual(
    timeline(records, timeBounds(records), {
      from: 11, to: 12, network: 'bc', includeDuplicates: true,
    }, 2),
    [
      { from: 10, to: 12, count: 3, selected: 1 },
      { from: 12, to: 14, count: 7, selected: 3 },
    ],
  );
  assert.deepEqual(timeBounds([]), { from: Infinity, to: -Infinity });
  assert.deepEqual(
    timeline([baseRecord], timeBounds([baseRecord]), { from: 100, to: 100 }, 1),
    [{ from: 100, to: 101, count: 1, selected: 1 }],
  );
});
