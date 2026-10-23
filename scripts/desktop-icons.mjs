import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// macOS's native converters preserve the generated source's alpha channel.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'desktop/assets/orbit-icon.png');
const iconset = join(root, 'desktop/assets/Orbit.iconset');
mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const output = join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
    execFileSync('sips', ['-z', String(size * scale), String(size * scale), source, '--out', output], { stdio: 'pipe' });
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'desktop/assets/orbit.icns')], { stdio: 'inherit' });
execFileSync('sips', ['-z', '128', '128', source, '--out', join(root, 'public/orbit-icon.png')], { stdio: 'pipe' });
console.log('Orbit cloud icon: complete macOS iconset, ICNS, and browser PNG generated.');
