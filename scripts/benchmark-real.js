// Optional private-data regression. Never prints invoice strings or preimages.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { analyzeText, aggregate } from '../public/assets/analysis.js';
const path = process.argv[2] || '../ln-payment-proof/test/data/test_data_pre-images.csv';
let csv;
try {
  csv = await readFile(path, 'utf8');
} catch {
  console.error(
    'Provide a path to the private CSV: npm run test:real -- /path/to/test_data_pre-images.csv',
  );
  process.exit(1);
}
const lines = csv.trim().split(/\r?\n/);
const header = lines.shift().split(',');
const column = header.indexOf('bolt11');
assert.ok(column >= 0, 'Expected a bolt11 CSV column');
// This fixture format has simple, unquoted columns. Only the bolt11 column is retained.
const invoices = lines.map((line) => line.split(',')[column].replace(/^"|"$/g, ''));
const started = performance.now();
let reported = -1;
const result = await analyzeText(invoices.join('\n'), (p) => {
  const pct = Math.floor(p.fraction * 10) * 10;
  if (pct !== reported) {
    console.log(`${pct}% · ${p.processed} lines · ${p.rejected} rejected`);
    reported = pct;
  }
});
assert.equal(result.nonempty, invoices.length);
assert.equal(
  result.rejected,
  0,
  result.issues.map((i) => `Line ${i.line}: ${i.message}`).join('\n'),
);
const options = { includeDuplicates: true };
const before = performance.now();
const stats = aggregate(result.records, options);
const aggregateMs = performance.now() - before;
assert.equal(stats.count, invoices.length);
assert.equal(
  stats.destinations.reduce((s, r) => s + r.count, 0),
  stats.count,
);
assert.equal(
  stats.destinations.reduce((s, r) => s + r.amount, 0n),
  stats.total,
);
assert.equal(stats.histogram.reduce((s, b) => s + b.count, 0) + stats.amountless, stats.count);
assert.ok(stats.targetAssignments >= stats.count);
console.log(
  JSON.stringify(
    {
      inputLines: invoices.length,
      uniqueInvoices: result.records.length,
      duplicateLines: result.duplicates,
      rejected: result.rejected,
      destinations: stats.destinations.length,
      routingTargets: stats.targets.length,
      recoveredKeys: stats.categories.key.get('Recovered from signature') ?? 0,
      sparkInvoices: stats.categories.spark.get('Spark detected') ?? 0,
      elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      aggregateMs: Number(aggregateMs.toFixed(1)),
    },
    null,
    2,
  ),
);
console.log('All conservation checks passed. No private fixture data was copied into public/.');
