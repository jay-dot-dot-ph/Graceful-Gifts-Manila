import { spawnSync } from 'node:child_process';
import { imageCommand } from './image-tools.mjs';

let selected;
for (const command of imageCommand()) {
  const version = spawnSync(command, ['-version'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') continue;
  if (version.status !== 0) throw new Error(`${command} -version failed: ${version.stderr || version.stdout}`);
  const formats = spawnSync(command, ['-list', 'format'], { encoding: 'utf8' });
  if (formats.status !== 0 || !/\bWEBP\b.*\brw[+]?/im.test(formats.stdout)) {
    throw new Error(`${command} does not have a readable and writable WebP delegate.`);
  }
  selected = { command, version: version.stdout.split('\n')[0].trim() };
  break;
}

if (!selected) throw new Error('ImageMagick with WebP support is required for image export.');
console.log(`Verified ${selected.command} with WebP support: ${selected.version}`);
