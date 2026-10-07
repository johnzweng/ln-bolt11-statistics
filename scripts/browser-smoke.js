// Optional real-browser regression, using Node's built-in WebSocket (no dependencies).
// Start an isolated Chrome with --remote-debugging-port=9333 and npm run dev first.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { REAL_PAYMENT } from '../test/fixtures.js';
const port = process.env.BROWSER_DEBUG_PORT || 9333;
const base = process.env.APP_URL || 'http://127.0.0.1:4173';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.startsWith(base));
assert.ok(target, `Open ${base} in the isolated debug browser first`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let id = 0;
const pending = new Map(),
  remote = [],
  errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error
      ? request.reject(new Error(message.error.message))
      : request.resolve(message.result);
  } else if (message.method === 'Network.requestWillBeSent') {
    if (/^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith(base))
      remote.push(message.params.request.url);
  } else if (message.method === 'Runtime.exceptionThrown')
    errors.push(message.params.exceptionDetails.text);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression, timeout = 15000) {
  const start = Date.now();
  while (!(await evaluate(expression))) {
    if (Date.now() - start > timeout) throw new Error('Timed out: ' + expression);
    await new Promise((r) => setTimeout(r, 80));
  }
}
const q = (id) => `document.getElementById(${JSON.stringify(id)})`;
const click = (id) => evaluate(`${q(id)}.click()`);
const metricCount = () =>
  evaluate(`Number(document.querySelector('.metric-value').textContent.replaceAll(',', ''))`);
async function change(id, value, type = 'change') {
  await evaluate(
    `(() => { const e = ${q(id)}; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(type)})); })()`,
  );
  await new Promise((r) => setTimeout(r, 100));
}
try {
  await send('Page.bringToFront');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await send('Page.reload', { ignoreCache: true });
  await wait(`${q('demo')} && ${q('demo')}.onclick === null && document.readyState === 'complete'`);
  await wait(`${q('export-code')}.textContent.includes('SELECT DISTINCT')`);
  assert.equal(await evaluate(`${q('export-help')}.open`), false);
  await click('open-export-help');
  assert.equal(await evaluate(`${q('export-help')}.open`), true);
  assert.equal(await evaluate(`document.activeElement.id`), 'close-export-help');
  await change('export-months', '12');
  assert.ok((await evaluate(`${q('export-code')}.textContent`)).includes("interval '12 months'"));
  await evaluate(`document.querySelector('[data-outcome="failed"]').click()`);
  assert.ok((await evaluate(`${q('export-code')}.textContent`)).includes('NOT EXISTS'));
  await evaluate(`document.querySelector('[data-node="lnd"]').click()`);
  assert.ok((await evaluate(`${q('export-code')}.textContent`)).includes('.status == "FAILED"'));
  assert.equal(await evaluate(`${q('export-cln-tip')}.hidden`), true);
  assert.equal(await evaluate(`${q('export-pagination')}.hidden`), false);
  assert.ok((await evaluate(`${q('export-pagination-code')}.textContent`)).includes('date -v-12m'));
  await evaluate(
    `window.savedClipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async text => { window.exportCopied = text; }`,
  );
  await click('export-copy');
  assert.equal(
    await evaluate('window.exportCopied'),
    await evaluate(`${q('export-code')}.textContent`),
  );
  await evaluate(`document.querySelector('.export-details').open = true`);
  await click('export-pagination-copy');
  assert.equal(
    await evaluate('window.exportCopied'),
    await evaluate(`${q('export-pagination-code')}.textContent`),
  );
  await evaluate(`navigator.clipboard.writeText = async () => { throw new Error('Unavailable'); }`);
  await click('export-copy');
  assert.equal(
    await evaluate('window.getSelection().toString()'),
    await evaluate(`${q('export-code')}.textContent`),
  );
  await evaluate(
    `navigator.clipboard.writeText = window.savedClipboardWrite; document.querySelector('.export-details').open = false; window.getSelection().removeAllRanges()`,
  );
  await mkdir('artifacts', { recursive: true });
  await evaluate(`${q('export-copy-status')}.textContent = ''`);
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    await new Promise((r) => setTimeout(r, 150));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`artifacts/export-${scheme}.png`, Buffer.from(shot.data, 'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  assert.equal(
    await evaluate(`${q('export-help')}.getBoundingClientRect().right <= innerWidth`),
    true,
  );
  const mobileHelp = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('artifacts/export-mobile.png', Buffer.from(mobileHelp.data, 'base64'));
  // Real keyboard Escape closes the native dialog and restores opener focus.
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await wait(`!${q('export-help')}.open && document.activeElement.id === 'open-export-help'`);
  assert.equal(await evaluate('document.activeElement.id'), 'open-export-help');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  console.log(
    '✓ Export guide: node/outcome/months, copy/fallback, mobile/dark, Escape and focus restoration',
  );
  await click('demo');
  await wait(`!${q('results')}.hidden`);
  assert.equal(await metricCount(), 3000);
  assert.equal(await evaluate(`document.querySelectorAll('.rank-row').length`), 14);
  assert.equal(
    await evaluate(
      `Math.round(document.querySelector('.rank-bar').getBoundingClientRect().height)`,
    ),
    6,
  );
  assert.equal(
    await evaluate(`document.querySelector('#destinations .lookup-controls button').disabled`),
    true,
  );
  for (const panel of ['destinations', 'targets']) {
    const selector = `#${panel} .lookup-controls select`;
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), '10');
    assert.deepEqual(
      await evaluate(
        `[...document.querySelector(${JSON.stringify(selector)}).options].map(o => ({ value: o.value, label: o.textContent }))`,
      ),
      [5, 10, 20, 50].map((n) => ({ value: String(n), label: `First ${n}` })),
    );
  }
  assert.ok((await evaluate(`${q('input-status')}.textContent`)).includes('0 rejected'));
  console.log('✓ Demo decoded off-main-thread; bounded rankings and no automatic lookups');
  await evaluate(
    `(() => { ${q('duplicates')}.checked = true; ${q('duplicates')}.dispatchEvent(new Event('change')); })()`,
  );
  await wait(`document.querySelector('.metric-value').textContent.replaceAll(',', '') === '3002'`);
  await evaluate(
    `(() => { ${q('duplicates')}.checked = false; ${q('duplicates')}.dispatchEvent(new Event('change')); })()`,
  );
  await change('to-slider', 500, 'input');
  const filtered = await metricCount();
  assert.ok(filtered > 0 && filtered < 3000);
  assert.ok(
    (await evaluate(`${q('window-label')}.textContent`)).replaceAll(',', '').startsWith(filtered + ' invoices'),
  );
  assert.equal(await evaluate(`${q('floating-to-slider')}.value`), '500');
  await evaluate(`scrollTo(0, scrollY + document.querySelector('.time-panel .sliders').getBoundingClientRect().bottom + 20)`);
  await wait(`${q('floating-time-controls')}.classList.contains('is-visible')`);
  assert.equal(
    await evaluate(`${q('floating-window-label')}.textContent`),
    await evaluate(`${q('window-label')}.textContent`),
  );
  await change('floating-to-slider', 400, 'input');
  assert.equal(await evaluate(`${q('to-slider')}.value`), '400');
  await evaluate(`${q('results-end')}.scrollIntoView()`);
  await wait(`!${q('floating-time-controls')}.classList.contains('is-visible')`);
  console.log('✓ Floating time controls appear within results, synchronize, and clear the footer');
  await evaluate(`document.querySelector('#destinations details').open = true`);
  await wait(`document.querySelector('#destinations tbody tr') !== null`);
  assert.ok(await evaluate(`document.querySelectorAll('#destinations tbody tr').length <= 25`));
  await evaluate(`document.querySelectorAll('#destinations th button')[2].click()`);
  assert.equal(
    await evaluate(`document.querySelectorAll('#destinations th')[2].getAttribute('aria-sort')`),
    'descending',
  );
  console.log('✓ Sliders update statistics, tables preserve sorting and render ≤25 rows');
  await change('network', 'bcrt');
  assert.equal(await metricCount(), 0);
  assert.equal(await evaluate(`${q('empty-window')}.hidden`), false);
  assert.equal(await evaluate(`document.querySelectorAll('#destinations tbody tr').length`), 0);
  await change('network', 'all');
  await click('reset-time');
  await wait(`document.querySelector('.metric-value').textContent.replaceAll(',', '') === '3000'`);
  assert.equal(await evaluate(`${q('from-slider')}.value`), '0');
  assert.equal(await evaluate(`${q('to-slider')}.value`), '1000');
  console.log('✓ Empty windows, network isolation, reset and duplicate toggle');
  await evaluate(`document.querySelector('#destinations details').open = false`);
  // Keep generated documentation screenshots free of transient keyboard focus rings.
  await evaluate(`document.activeElement?.blur()`);
  await mkdir('artifacts', { recursive: true });
  const layout = await send('Page.getLayoutMetrics');
  const desktop = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: layout.cssContentSize.height, scale: 1 },
  });
  await writeFile('artifacts/demo-desktop.png', Buffer.from(desktop.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  const mobileLayout = await send('Page.getLayoutMetrics');
  const mobile = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 390, height: mobileLayout.cssContentSize.height, scale: 1 },
  });
  await writeFile('artifacts/demo-mobile.png', Buffer.from(mobile.data, 'base64'));
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  console.log('✓ Responsive light/dark layouts; demo screenshots saved in ignored artifacts/');
  assert.deepEqual(remote, []);
  // Reanalyze real signed fixture, never making an actual external API request.
  await click('clear');
  await evaluate(
    `(() => { ${q('invoices')}.value = ${JSON.stringify(REAL_PAYMENT.bolt11 + '\ninvalid')}; ${q('invoices')}.dispatchEvent(new Event('input')); })()`,
  );
  await click('analyze');
  await wait(`!${q('results')}.hidden`);
  assert.equal(await metricCount(), 1);
  assert.ok((await evaluate(`${q('input-status')}.textContent`)).includes('1 rejected'));
  // The fixture's route hint enters through a documented Spark routing node.
  const knownBadges = await evaluate(
    `({ total: document.querySelectorAll('#targets .badge-known').length, text: document.querySelector('#targets .badge-known')?.textContent, source: document.querySelector('#targets .badge-known')?.href })`,
  );
  assert.ok(knownBadges.total >= 1);
  assert.equal(knownBadges.text, 'Spark routing node');
  assert.equal(knownBadges.source, 'https://docs.spark.money/learn/lightning#routing-nodes');
  assert.equal(await evaluate(`document.querySelectorAll('#destinations .badge-known').length`), 0);
  await evaluate(`document.querySelector('#targets details').open = true`);
  await wait(`document.querySelector('#targets tbody .badge-known') !== null`);
  assert.equal(
    await evaluate(
      `document.querySelector('#targets tbody .badge-known').getAttribute('referrerpolicy')`,
    ),
    'no-referrer',
  );
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  const exported = await evaluate(`(async () => {
    const { NodePanel } = await import('./assets/ui/node-panel.js');
    const { aggregate, analyzeText } = await import('./assets/analysis.js');
    const { records } = await analyzeText(${JSON.stringify(REAL_PAYMENT.bolt11)});
    const panel = Object.create(NodePanel.prototype);
    Object.assign(panel, { rows: aggregate(records).targets, sort: 'count', descending: true, target: true });
    return panel.toCsv('all');
  })()`);
  assert.ok(exported.includes('"known_node_source"'));
  assert.ok(exported.includes('"Spark routing node"'));
  assert.ok(exported.includes('"https://docs.spark.money/learn/lightning#routing-nodes"'));
  console.log('✓ Source-cited Spark badges in rankings/tables and CSV, without automatic requests');
  assert.equal(
    await evaluate(`document.querySelector('#destinations .lookup-controls button').disabled`),
    false,
  );
  await evaluate(`(() => {
    window.lookupCalls = []; window.confirm = () => true;
    window.fetch = async (url, options) => { window.lookupCalls.push({ url, credentials: options.credentials, referrer: options.referrerPolicy });
      return new Response(JSON.stringify({ public_key: ${JSON.stringify(REAL_PAYMENT.nodeId)}, alias: '<img src=x onerror=alert(1)>\u202e', active_channel_count: 7, capacity: 100000000 })); };
    document.querySelector('#destinations .lookup-controls button').click();
  })()`);
  await wait(
    `document.querySelector('#destinations .lookup-note').textContent.startsWith('Fetched 1 / 1')`,
  );
  const calls = await evaluate('window.lookupCalls');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith(REAL_PAYMENT.nodeId));
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].referrer, 'no-referrer');
  await evaluate(`document.querySelector('#destinations details').open = true`);
  await wait(`document.querySelector('#destinations .alias') !== null`);
  assert.equal(
    await evaluate(`document.querySelector('#destinations .alias').textContent`),
    '<img src=x onerror=alert(1)>',
  );
  assert.equal(await evaluate(`document.querySelector('#destinations img') !== null`), false);
  assert.equal(
    await evaluate(
      `document.querySelector('#destinations .node-facts').textContent.includes('7 active channels')`,
    ),
    true,
  );
  console.log('✓ Only confirmed manual enrichment; hostile alias remains inert text');
  await click('clear');
  assert.equal(await evaluate(`document.querySelectorAll('#destinations tbody tr').length`), 0);
  assert.equal(await evaluate(`${q('invoices')}.value`), '');
  assert.equal(await evaluate(`${q('results')}.hidden`), true);
  assert.deepEqual(remote, []);
  if (process.argv.includes('--real')) {
    // The preimage column never enters the browser.
    const csv = await readFile('../ln-payment-proof/test/data/test_data_pre-images.csv', 'utf8');
    const lines = csv
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(',')[1]);
    await evaluate(
      `(() => { ${q('invoices')}.value = ${JSON.stringify(lines.join('\n'))}; return ${q('invoices')}.value.length; })()`,
    );
    await click('analyze');
    await wait(`!${q('progress-area')}.hidden && ${q('progress')}.value > 0`, 15000);
    await click('cancel');
    assert.equal(await evaluate(`${q('analyze')}.disabled`), false);
    console.log('✓ Large-batch progress and cancellation');
    const started = performance.now();
    await click('analyze');
    await wait(`!${q('results')}.hidden`, 180000);
    assert.equal(await metricCount(), lines.length);
    assert.ok((await evaluate(`${q('input-status')}.textContent`)).includes('0 rejected'));
    const before = performance.now();
    await change('to-slider', 500, 'input');
    assert.ok((await metricCount()) < lines.length);
    console.log(
      `✓ ${lines.length} real invoices in browser: ${((performance.now() - started) / 1000).toFixed(1)}s; filter interaction ${Math.round(performance.now() - before)}ms including 100ms test wait`,
    );
    await click('clear');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log('All browser checks passed. Zero external network requests.');
} finally {
  socket.close();
}
