// Parse every JavaScript file without executing browser modules or requiring dependencies.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
let failed = false;

for (const directory of ['public', 'scripts', 'test']) {
  const entries = readdirSync(join(root, directory), { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const path = join(entry.parentPath, entry.name);
    const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) failed = true;
    checked++;
  }
}

console.log(`${checked} JavaScript files checked${failed ? ' (errors found)' : ''}.`);
process.exitCode = failed ? 1 : 0;
