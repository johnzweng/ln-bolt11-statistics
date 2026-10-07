import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportQuery, paginatedLndExport } from '../public/assets/ui/export-queries.js';

const jqAvailable = spawnSync('jq', ['--version']).status === 0;

test('Export generators validate inputs; retain month selection and read-only SQL', () => {
  assert.throws(() => exportQuery('other', 'success'));
  assert.throws(() => exportQuery('cln', 'pending'));
  for (const months of [0, 25, 1.5, "6'; DROP TABLE payments;"])
    assert.throws(() => exportQuery('cln', 'success', months));
  for (const months of [1, 3, 6, 12, 24]) {
    assert.ok(exportQuery('cln', 'success', months).includes(`interval '${months} months'`));
    assert.ok(exportQuery('lnd', 'failed', months).includes(`date -v-${months}m`));
    assert.ok(paginatedLndExport('success', months).includes(`date -v-${months}m`));
  }
  assert.doesNotMatch(exportQuery('cln', 'success'), /payment_preimage|completed_at|DISTINCT ON/);
  assert.match(exportQuery('cln', 'failed'), /NOT EXISTS/);
  assert.match(
    exportQuery('lnd', 'failed'),
    /--include_incomplete --max_payments=18446744073709551615/,
  );
});

test('short and paginated LND recipes share validation and exact error messages', () => {
  for (const [outcome, months, message] of [
    ['pending', 6, 'Unknown export'],
    ['success', 0, 'Invalid month window'],
    ['failed', 25, 'Invalid month window'],
    ['success', '6', 'Invalid month window'],
    ['failed', NaN, 'Invalid month window'],
    ['pending', 0, 'Unknown export'],
  ]) {
    for (const generate of [
      () => exportQuery('lnd', outcome, months),
      () => paginatedLndExport(outcome, months),
    ]) {
      assert.throws(generate, { name: 'Error', message });
    }
  }
});

test('CLN SQL semantics: failed groups, retries, pending, old parts, BOLT12, and deduplication', () => {
  // Execute the real generated query with only PostgreSQL syntax/clock adapted.
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE payments (payment_hash TEXT, groupid INTEGER, status INTEGER, bolt11 TEXT, timestamp INTEGER)',
  );
  db.function('regexp', (pattern, text) =>
    text !== null && new RegExp(pattern, 'i').test(text) ? 1 : 0,
  );
  const insert = db.prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)');
  const rows = [
    ['success', 1, 1, 'lnbc-success', 200],
    ['success', 1, 2, 'lnbc-success', 201],
    ['pending', 1, 2, 'lnbc-pending', 200],
    ['pending', 1, 0, null, 50],
    ['old-success', 1, 2, 'lnbc-old-success', 200],
    ['old-success', 1, 1, null, 50],
    ['failed', 1, 2, 'lnbc-failed', 200],
    ['failed', 1, 2, 'lnbc-failed', 201],
    ['retry', 1, 2, 'lnbc-retry', 200],
    ['retry', 2, 1, 'lnbc-retry', 201],
    ['old', 1, 2, 'lnbc-old', 50],
    ['edge', 1, 2, 'lnbc-edge', 100],
    ['bolt12', 1, 1, 'lni1something', 200],
    ['missing', 1, 2, null, 200],
    ['empty', 1, 2, '', 200],
    ['testnet', 1, 2, 'LNTB-testnet', 200],
  ];
  for (const row of rows) insert.run(...row);
  const run = (outcome) =>
    db
      .prepare(
        exportQuery('cln', outcome)
          .replaceAll('public.payments', 'payments')
          .replace(
            "p.bolt11 ~* '^ln(bc|tb|tbs|bcrt|sb)'",
            "p.bolt11 REGEXP '^ln(bc|tb|tbs|bcrt|sb)'",
          )
          .replace("extract(epoch FROM now() - interval '6 months')", '100'),
      )
      .all()
      .map((r) => r.bolt11);
  try {
    assert.deepEqual(run('success'), ['lnbc-retry', 'lnbc-success']);
    assert.deepEqual(run('failed'), ['LNTB-testnet', 'lnbc-failed', 'lnbc-retry']);
  } finally {
    db.close();
  }
});

function mockNode(run) {
  const dir = mkdtempSync(join(tmpdir(), 'lens-export-'));
  const payment = (status, request, seconds = 200) => ({
    status,
    payment_request: request,
    creation_time_ns: String(seconds * 1e9),
  });
  const pages = [
    {
      payments: [
        payment('SUCCEEDED', 'lnbc-old', 50),
        payment('IN_FLIGHT', 'lnbc-pending'),
        payment('INITIATED', 'lnbc-init'),
      ],
      last_index_offset: '3',
    },
    {
      payments: [
        payment('SUCCEEDED', 'lnbc-good'),
        payment('FAILED', 'LNTB-failed'),
        payment('SUCCEEDED', ''),
        payment('FAILED', null),
        payment('FAILED', 'lni1bolt12'),
      ],
      last_index_offset: '8',
    },
    { payments: [], last_index_offset: '0' },
  ];
  writeFileSync(join(dir, 'date'), '#!/bin/bash\nprintf 100\n', { mode: 0o755 });
  writeFileSync(
    join(dir, 'lncli'),
    `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (process.env.FAIL_CLI) { console.error('RPC unavailable'); process.exit(1); }
const pages = ${JSON.stringify(pages)};
const offset = args.find(a => a.startsWith('--index_offset='))?.split('=')[1];
const result = offset === undefined ? { payments: pages.flatMap(p => p.payments).filter(p => BigInt(p.creation_time_ns) >= 100000000000n) }
  : pages[offset === '0' ? 0 : offset === '3' ? 1 : 2];
if (process.env.STUCK_CURSOR && offset !== undefined) result.last_index_offset = offset;
console.log(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  const env = { ...process.env, PATH: dir + ':' + process.env.PATH };
  try {
    run({ dir, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const outcome of ['success', 'failed'])
  test(
    `LND ${outcome}: execute short and paginated recipes against mock lncli`,
    { skip: !jqAvailable },
    () => {
      mockNode(({ dir, env }) => {
        for (const query of [exportQuery('lnd', outcome), paginatedLndExport(outcome)]) {
          const result = spawnSync('bash', ['-c', query], { cwd: dir, env, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(
            readFileSync(
              join(dir, `${outcome === 'success' ? 'successful' : 'failed'}-invoices.txt`),
              'utf8',
            ),
            outcome === 'success' ? 'lnbc-good\n' : 'LNTB-failed\n',
          );
        }
        const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert.equal(calls.length, 4); // Maximum-size call + all 3 pages, including first page with zero matches.
        assert.ok(calls[0].includes('--creation_date_start=100'));
        assert.ok(calls[1].includes('--paginate_forwards'));
        assert.ok(calls[2].includes('--index_offset=3'));
        assert.ok(calls[3].includes('--index_offset=8'));
        assert.ok(calls.every((args) => args.includes('--include_incomplete')));
      });
    },
  );

test(
  'LND command failures propagate and pagination rejects a stuck cursor',
  { skip: !jqAvailable },
  () => {
    mockNode(({ dir, env }) => {
      for (const query of [exportQuery('lnd', 'success'), paginatedLndExport('success')]) {
        assert.notEqual(
          spawnSync('bash', ['-c', query], { cwd: dir, env: { ...env, FAIL_CLI: '1' } }).status,
          0,
        );
      }
      const result = spawnSync('bash', ['-c', paginatedLndExport('success')], {
        cwd: dir,
        env: { ...env, STUCK_CURSOR: '1' },
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /cursor did not advance/);
    });
  },
);
