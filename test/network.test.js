import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_RESPONSE_BYTES, parseNode } from '../public/assets/ui/node-lookup.js';
// Tests that call lookupNode import the module with a unique query string, such as ?timeout.
// Each import gets fresh module state: an empty result cache and an unused lookup budget.
const key = '02' + 'ab'.repeat(32);
const node = {
  public_key: key,
  alias: '<img src=x onerror=alert(1)>',
  active_channel_count: 7,
  capacity: 123456789,
};

test('node boundary keeps only bounded, typed, matching fields', () => {
  assert.equal(parseNode({ ...node, public_key: 'another' }, key), null);
  assert.equal(parseNode([], key), null);
  assert.deepEqual(parseNode(node, key), {
    alias: node.alias,
    active_channel_count: 7,
    capacity: '123456789',
  });
  const result = parseNode(
    { ...node, alias: 'a'.repeat(200), active_channel_count: -1, capacity: 'NaN' },
    key,
  );
  assert.equal(result.alias.length, 128);
  assert.equal(result.active_channel_count, null);
  assert.equal(result.capacity, null);
});
test('capacity and channel-count boundaries preserve exact values without coercion', () => {
  for (const [capacity, expected] of [
    [0, '0'],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
    ['9999999999999999', '9999999999999999'],
    ['000123', '000123'],
    [Number.MAX_SAFE_INTEGER + 1, null],
    ['10000000000000000', null],
    ['', null],
    ['1.5', null],
    [' 123', null],
    [-1, null],
    [1.5, null],
    [null, null],
  ]) {
    assert.equal(parseNode({ ...node, capacity }, key).capacity, expected);
  }
  for (const [active_channel_count, expected] of [
    [0, 0], [1_000_000_000, 1_000_000_000],
    [1_000_000_001, null], ['7', null], [1.5, null], [null, null],
  ]) {
    assert.equal(parseNode({ ...node, active_channel_count }, key).active_channel_count, expected);
  }
  assert.equal(parseNode({ ...node, alias: 123 }, key).alias, '');
});

test('streamed JSON is bounded by bytes and decoded across chunk boundaries', async (t) => {
  const encoder = new TextEncoder();
  const payload = encoder.encode(JSON.stringify({ ...node, alias: '⚡ node' }));
  const bytes = new Uint8Array(MAX_RESPONSE_BYTES).fill(32); // Legal JSON whitespace.
  bytes.set(payload);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      // Single-byte chunks split the multibyte alias; decoding must wait for assembly.
      for (const byte of payload) controller.enqueue(Uint8Array.of(byte));
      controller.enqueue(bytes.subarray(payload.length));
      controller.close();
    },
  })));
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?byte-boundary');
  assert.deepEqual(await lookupNode(key), {
    status: 'public',
    node: { alias: '⚡ node', active_channel_count: 7, capacity: '123456789' },
  });
});

test('an oversized open stream is cancelled and its failure is cached', async (t) => {
  let cancelled = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        controller.enqueue(Uint8Array.of(32));
      },
      cancel() { cancelled = true; },
    }));
  });
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?cancel-stream');
  assert.equal((await lookupNode(key)).status, 'unavailable');
  assert.equal(cancelled, true);
  await lookupNode(key);
  assert.equal(calls, 1);
});

test('malformed JSON, mismatched keys, missing bodies, and HTTP failures stay best-effort', async (t) => {
  const cases = [
    { response: new Response('not JSON'), expected: 'unavailable' },
    { response: new Response(JSON.stringify({ ...node, public_key: 'different' })), expected: 'unavailable' },
    { response: new Response(null), expected: 'unavailable' },
    { response: new Response('', { status: 404 }), expected: 'unknown' },
    { response: new Response('', { status: 500 }), expected: 'unknown' },
    { response: new Response('', { status: 429 }), expected: 'unavailable' },
    { response: new Response('', { status: 503 }), expected: 'unavailable' },
  ];
  let nextResponse;
  t.mock.method(globalThis, 'fetch', async () => nextResponse);
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?failure-statuses');
  for (const [index, { response, expected }] of cases.entries()) {
    nextResponse = response;
    // Results are cached per key, so each case needs its own key.
    const pubkey = '02' + index.toString(16).padStart(64, '0');
    assert.equal((await lookupNode(pubkey)).status, expected, `case ${index}`);
  }
});

test('timeout aborts the request and resolves to an unavailable result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  });
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?timeout');
  const result = lookupNode(key);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(9000);
  assert.equal((await result).status, 'unavailable');
  assert.equal(signal.aborted, true);
});

test('import is inert; only lookupNode triggers a privacy-minimized request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://mempool.space/api/v1/lightning/nodes/' + key);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify(node));
  });
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?inert');
  assert.equal(calls, 0);
  assert.equal((await lookupNode(key)).status, 'public');
  await lookupNode(key);
  assert.equal(calls, 1);
  await lookupNode('invalid');
  assert.equal(calls, 1);
});
test('oversized and redirected / failed responses degrade gracefully', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(70000)));
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?huge');
  assert.equal((await lookupNode(key)).status, 'unavailable');
  globalThis.fetch = async () => new Response('', { status: 404 });
  const missing = await import('../public/assets/ui/node-lookup.js?missing');
  assert.equal((await missing.lookupNode(key)).status, 'unknown');
});
test('global lookup cap and four-request concurrency enforced, failures cached', async (t) => {
  let active = 0,
    maximum = 0,
    calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    active++;
    calls++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return new Response('', { status: 429 });
  });
  const { lookupNode } = await import('../public/assets/ui/node-lookup.js?limits');
  const keys = Array.from({ length: 70 }, (_, i) => '02' + i.toString(16).padStart(64, '0'));
  const results = await Promise.all(keys.map(lookupNode));
  assert.equal(calls, 64);
  assert.ok(maximum <= 4);
  assert.ok(results.every((r) => r.status === 'unavailable'));
  await lookupNode(keys[0]);
  assert.equal(calls, 64);
});
