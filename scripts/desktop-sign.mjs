import { open, readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundleExtensions = new Set(['.app', '.framework', '.xpc', '.appex', '.bundle']);
const machoMagic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${file} failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

async function isMachO(file) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    return bytesRead === 4 && machoMagic.has(header.toString('hex'));
  } finally { await handle.close(); }
}

async function bundleInfo(bundle) {
  // Electron ships single-version frameworks. Their Current symlink resolves
  // to the real executable, which is sealed when signing the framework.
  const framework = extname(bundle) === '.framework';
  const candidates = framework
    ? [join(bundle, 'Versions/Current/Resources/Info.plist'), join(bundle, 'Resources/Info.plist')]
    : [join(bundle, 'Contents/Info.plist'), join(bundle, 'Resources/Info.plist')];
  for (const plist of candidates) {
    if (!(await stat(plist).catch(() => null))?.isFile()) continue;
    const executable = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]);
    const executablePath = framework ? join(bundle, executable)
      : plist.endsWith('/Contents/Info.plist') ? join(bundle, 'Contents/MacOS', executable)
      : join(bundle, executable);
    return { executable: await realpath(executablePath) };
  }
  return null;
}

export async function collectSigningTargets(app) {
  const files = [];
  const bundles = [];
  const mainExecutables = new Set();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // Framework symlinks must remain untouched; their real files are visited once.
      if (entry.isSymbolicLink() || entry.name === '_CodeSignature') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && await isMachO(path)) files.push(path);
    }
    if (bundleExtensions.has(extname(directory))) {
      const info = await bundleInfo(directory);
      if (info) {
        mainExecutables.add(info.executable);
        bundles.push(directory);
      }
    }
  }
  await walk(await realpath(app));
  // Signing a bundle's main executable also seals that bundle. Defer it until
  // all nested binaries/bundles are signed, including native tools in Resources.
  const binaries = files.filter(file => !mainExecutables.has(file));
  bundles.sort((a, b) => b.split(sep).length - a.split(sep).length);
  return [...binaries, ...bundles];
}

/** Local demo signing only. Ad hoc signatures do not promise stable TCC grants
 * across rebuilds, nor Developer ID distribution / notarization. No custom DR:
 * an identifier-only requirement would weaken identity checks, not fix them.
 */
export async function signLocalMacApp(app, identifier = 'app.orbit.workspace') {
  if (process.platform !== 'darwin') throw new Error('macOS signing requires macOS');
  app = await realpath(resolve(app));
  const targets = await collectSigningTargets(app);
  if (targets.at(-1) !== app) throw new Error('A valid outer application bundle is required');
  // Replacing an app already shown in Finder can retain FinderInfo on the
  // outer bundle. Remove only that non-code metadata in this build output;
  // never clear quarantine/provenance attributes or alter system grants.
  const finderInfo = spawnSync('/usr/bin/xattr', ['-p', 'com.apple.FinderInfo', app], { encoding: 'utf8' });
  if (finderInfo.status === 0) command('/usr/bin/xattr', ['-d', 'com.apple.FinderInfo', app]);
  for (const target of targets) {
    const args = ['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements'];
    if (target === app) args.push('--identifier', identifier);
    command('/usr/bin/codesign', [...args, target]);
  }
  // --deep is for verification, never signing (Apple TN2206).
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  return { signedTargets: targets.length, identifier };
}
