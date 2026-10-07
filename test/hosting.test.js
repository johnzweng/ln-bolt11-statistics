import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('sample nginx config is generic and privacy preserving', () => {
  const config = read('deploy/nginx.conf');
  assert.match(config, /server_name _;/);
  assert.match(config, /root \/usr\/share\/nginx\/html;/);
  assert.match(config, /worker-src 'self'/);
  assert.match(config, /frame-ancestors 'none'/);
  assert.match(config, /Referrer-Policy "no-referrer" always/);
  assert.match(config, /X-Content-Type-Options "nosniff" always/);
  assert.match(config, /expires -1;/);
  assert.match(config, /try_files \$uri \$uri\/ =404;/);
  assert.doesNotMatch(config, /fastcgi_pass|proxy_pass/);
  const logFormat = config.slice(config.indexOf('log_format'), config.indexOf('server {'));
  assert.match(logFormat, /\$uri/);
  assert.doesNotMatch(logFormat, /\$request_uri|\$http_referer|"\$request"/);
});

test('HTML boot assets are local files covered by the static deployment', () => {
  const html = read('public/index.html');
  const localAssets = [...html.matchAll(/<(?:link|script)[^>]+(?:href|src)="([^"]+)"/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(localAssets, ['favicon.svg', 'assets/app.css', 'assets/app.js']);
  for (const asset of localAssets) {
    assert.equal(existsSync(join(root, 'public', asset)), true, `Missing public/${asset}`);
  }
  assert.doesNotMatch(html, /<(?:script|link)[^>]+https?:\/\//i);
});

test('static module imports and the worker entry point resolve within public/', () => {
  const publicRoot = join(root, 'public');
  const modules = readdirSync(publicRoot, { recursive: true }).filter((path) => path.endsWith('.js'));
  const dependencies = new Set();
  for (const module of modules) {
    const path = join(publicRoot, module);
    // Covers this project's literal imports, re-exports, and new URL(worker, import.meta.url).
    const specifiers = readFileSync(path, 'utf8').matchAll(
      /\b(?:from\s+|import(?:\s+|\s*\(\s*)|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g,
    );
    for (const [, specifier] of specifiers) {
      assert.ok(specifier.startsWith('.'), `${module}: nonlocal dependency ${specifier}`);
      const dependency = resolve(dirname(path), specifier);
      assert.ok(dependency.startsWith(publicRoot + sep), `${module}: outside public/`);
      assert.ok(existsSync(dependency), `${module}: missing ${specifier}`);
      dependencies.add(dependency);
    }
  }
  assert.ok(dependencies.has(join(publicRoot, 'assets', 'worker.js')), 'Worker entry point was checked');
});

test('deployment guide publishes only public files and calls out HTTPS and proxy logs', () => {
  const guide = read('deploy/README.md');
  assert.match(guide, /deploy only the contents of \[`public\/`\]/i);
  assert.match(guide, /HTTPS reverse proxy/i);
  assert.match(guide, /proxy or CDN.*logging sensitive query strings/is);
});
