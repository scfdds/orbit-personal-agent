import { build } from 'esbuild';
import { mkdir, chmod, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}dist`, { recursive: true });
const built = await build({ absWorkingDir: root, entryPoints: [`${root}src/cli.mjs`], outfile: `${root}dist/cli.mjs`, bundle: true,
  platform: 'node', target: 'node24', format: 'esm', sourcemap: false,
  metafile: true,
  banner: { js: "import { createRequire as orbitCreateRequire } from 'node:module'; const require = orbitCreateRequire(import.meta.url);" },
  legalComments: 'eof' });
await chmod(`${root}dist/cli.mjs`, 0o755);
// Include licenses for every third-party package actually included in the bundle.
const packages = new Map();
for (const input of Object.keys(built.metafile.inputs).filter(input => input.includes('node_modules/'))) {
  let base = dirname(resolve(root, input));
  while (base.startsWith(root) && base !== root.slice(0, -1)) {
    try {
      const pkg = JSON.parse(await readFile(`${base}/package.json`, 'utf8'));
      if (pkg.name && pkg.version) { packages.set(base, pkg); break; }
    } catch { /* ascend to the package root */ }
    base = dirname(base);
  }
}
const licenses = await Promise.all([...packages.entries()].map(async ([base, pkg]) => {
  let license = '';
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(`${base}/${filename}`, 'utf8'); break; } catch { /* try next conventional filename */ }
  }
  if (!license) throw new Error(`Missing dependency license: ${pkg.name}`);
  return `${pkg.name} ${pkg.version}\n${license}`;
}));
await writeFile(`${root}dist/THIRD-PARTY-LICENSES.txt`, licenses.join('\n\n---\n\n'));
console.log('Built dist/cli.mjs. No notification database was read.');
