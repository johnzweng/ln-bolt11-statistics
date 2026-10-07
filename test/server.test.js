import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createStaticServer } from '../scripts/static-server.js';

let server;
let port;

before(async () => {
  server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

// Use raw HTTP paths: fetch would normalize dot segments before sending the request.
function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('local server serves the dashboard with revalidation and privacy headers', async () => {
  const response = await request('/?ignored=query');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-cache');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.deepEqual(response.body, await readFile(new URL('../public/index.html', import.meta.url)));
});

test('local server serves module-worker assets, CSS, and SVG with their configured MIME types', async () => {
  for (const [path, type] of [
    ['/assets/worker.js', 'text/javascript'],
    ['/assets/app.css', 'text/css'],
    ['/favicon.svg', 'image/svg+xml'],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['content-type'], type + '; charset=utf-8');
    assert.ok(response.body.length > 0);
    const head = await request(path, 'HEAD');
    assert.equal(head.status, response.status);
    assert.equal(head.headers['content-type'], response.headers['content-type']);
    assert.equal(head.body.length, 0);
  }
});

test('missing files, directories, and malformed URL encodings return 404', async () => {
  for (const path of ['/missing', '/assets/', '/%ZZ', '/%E0%A4%A']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.toString(), 'Not found');
  }
  const head = await request('/missing', 'HEAD');
  assert.equal(head.status, 404);
  assert.equal(head.body.length, 0);
});

test('development server never serves repository files or decoded paths outside public/', async () => {
  for (const path of ['/README.md', '/package.json', '/.git/config']) {
    assert.equal((await request(path)).status, 404, path);
  }
  for (const path of ['/..%2fREADME.md', '/%2e%2e%2fpackage.json', '/..%2fpublic-other%2ffile']) {
    const response = await request(path);
    assert.equal(response.status, 403, path);
    assert.equal(response.body.length, 0);
  }
});

test('unsupported HTTP methods return an empty 405 without reading an asset', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await request('/assets/app.js', method);
    assert.equal(response.status, 405, method);
    assert.equal(response.body.length, 0);
  }
});
