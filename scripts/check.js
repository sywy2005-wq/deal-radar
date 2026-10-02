import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'public', 'test', 'scripts']) {
  for (const file of await readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const path = new URL(`../${directory}/${file}`, import.meta.url);
    const result = spawnSync(process.execPath, ['--check', path.pathname], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
