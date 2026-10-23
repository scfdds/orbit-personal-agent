import { readFile, writeFile, unlink, lstat, readdir, rm, mkdir, mkdtemp, rename } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { signLocalMacApp } from './desktop-sign.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, '.desktop-build/app');
const modules = join(stage, 'node_modules');
if ((await lstat(modules).catch(() => null))?.isSymbolicLink()) await unlink(modules);
const install = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
if (install.status !== 0) throw new Error('Production dependency installation failed');
// The renderer bundle already contains these libraries; no server module imports them.
const runtimePackage = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
for (const name of ['lucide-react', 'react', 'react-dom', 'react-markdown', 'remark-gfm']) delete runtimePackage.dependencies[name];
await writeFile(join(stage, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
const prune = spawnSync('npm', ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
if (prune.status !== 0) throw new Error('Desktop runtime dependency pruning failed');
// Pi's published shrinkwrap includes esbuild binaries for every OS. Keep only the
// current macOS architecture in this disposable stage, never in source dependencies.
async function trimPlatformBinaries(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (entry.name === '@esbuild') {
      for (const binary of await readdir(path, { withFileTypes: true })) {
        if (binary.isDirectory() && binary.name !== `darwin-${process.arch}`) await rm(join(path, binary.name), { recursive: true, force: true });
      }
    } else if (entry.name.startsWith('@')) await trimPlatformBinaries(path);
    else {
      const nested = join(path, 'node_modules');
      if ((await lstat(nested).catch(() => null))?.isDirectory()) await trimPlatformBinaries(nested);
    }
  }
}
await trimPlatformBinaries(modules);
async function trimBuildMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await trimBuildMetadata(path);
    else if (entry.isFile() && (/\.(?:d\.)?(?:ts|cts|mts)\.map$/.test(entry.name) || entry.name.endsWith('.js.map') || entry.name.endsWith('.mjs.map') || entry.name.endsWith('.cjs.map') || /\.d\.(?:ts|cts|mts)$/.test(entry.name))) await rm(path);
  }
}
await trimBuildMetadata(modules);
if (process.argv.includes('--stage-only')) {
  console.log(`Production desktop runtime ready: ${stage}`);
  process.exit(0);
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'desktop-dist');
// Documents/File Provider may reattach FinderInfo while signing. Keep both the
// working bundle and Packager's intermediate directories outside the workspace.
const temporary = await mkdtemp(join(tmpdir(), 'orbit-desktop-pack-'));
let completed = false;
let pendingArchive;
try {
  const paths = await packager({ dir: stage, name: 'Orbit', appBundleId: 'app.orbit.workspace',
    icon: join(root, 'desktop/assets/orbit.icns'),
    appVersion: pkg.version, platform: 'darwin', arch: process.arch, electronVersion: pkg.devDependencies.electron,
    out: join(temporary, 'packaged'), tmpdir: join(temporary, 'work'), overwrite: true, asar: false, prune: false,
    osxSign: false, osxNotarize: false, darwinDarkModeSupport: true,
    extendInfo: { NSHighResolutionCapable: true, NSMicrophoneUsageDescription: '按下麦克风后，Orbit 使用语音识别将你的话转换为输入内容。录音由你开始和结束。' },
  });
  await mkdir(dist, { recursive: true });
  for (const path of paths) {
    const app = join(path, 'Orbit.app');
    // Sign only after every copy/prune step; archive this verified bundle before
    // copying anything back to a potentially File Provider-managed directory.
    const signed = await signLocalMacApp(app);
    console.log(`Local ad hoc signature verified (${signed.signedTargets} code objects). Rebuilds may require granting system permissions again; this is not a notarized distribution signature.`);
    const archive = join(dist, `Orbit-macOS-${process.arch}.zip`);
    pendingArchive = `${archive}.${process.pid}.partial`;
    const zipped = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, pendingArchive], { stdio: 'inherit' });
    if (zipped.status !== 0) throw new Error('macOS application archive creation failed');
    // Preserve the previous complete ZIP if creating its replacement fails.
    await rename(pendingArchive, archive); pendingArchive = undefined;
    console.log(`Desktop archive (install from this ZIP): ${archive}`);

    const convenience = join(dist, basename(path), 'Orbit.app');
    await mkdir(dirname(convenience), { recursive: true });
    await rm(convenience, { recursive: true, force: true });
    const copied = spawnSync('/usr/bin/ditto', [app, convenience], { stdio: 'inherit' });
    if (copied.status !== 0) throw new Error(`Workspace application copy failed; the verified ZIP is available at ${archive}`);
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', convenience], { encoding: 'utf8' });
    if (verified.status !== 0) {
      console.warn(`Workspace convenience copy did not pass strict verification: ${convenience}`);
      console.warn(verified.error?.message || verified.stderr?.trim() || `codesign exit ${verified.status}`);
      console.warn('FinderInfo may have been reattached by Finder/File Provider. Do not re-sign this copy; extract the verified ZIP and install Orbit.app at ~/Applications/Orbit.app. The ZIP was created before this workspace copy.');
    } else {
      console.log(`Workspace convenience copy: ${convenience} (File Provider may add metadata later; use the ZIP for installation).`);
    }
  }
  completed = true;
} finally {
  if (pendingArchive) await rm(pendingArchive, { force: true });
  if (completed) await rm(temporary, { recursive: true, force: true });
  else console.warn(`Packaging failed; temporary files retained for diagnosis: ${temporary}`);
}
