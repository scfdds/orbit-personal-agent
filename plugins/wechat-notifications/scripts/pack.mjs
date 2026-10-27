import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('Build a macOS plugin on macOS.');
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts/build-native.mjs')], { stdio: 'inherit' });

// An explicit allowlist prevents caches, configuration, logs or personal data from entering a release.
const files = [
  'README.md', 'plugin.json', 'mcp.json', '.mcp.json',
  '.codex-plugin/plugin.json', '.claude-plugin/plugin.json',
  'skills/wechat-notifications/SKILL.md', 'dist/cli.mjs', 'dist/THIRD-PARTY-LICENSES.txt',
  'native/bin/wechat-notification-db-reader',
];
const temporary = await mkdtemp(join(tmpdir(), 'orbit-wechat-release-'));
const stage = join(temporary, 'wechat-notifications');
const artifacts = join(root, 'artifacts');
const name = `orbit-wechat-notifications-macos-${process.arch}-${pkg.version}.zip`;
try {
  for (const file of files) {
    const target = join(stage, file);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(root, file), target);
  }
  const native = join(stage, 'native/bin/wechat-notification-db-reader');
  await chmod(native, 0o755);
  await chmod(join(stage, 'dist/cli.mjs'), 0o755);
  // Ad hoc signing seals this artifact; it is not Developer ID signing or notarization.
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'org.orbit.wechat.notifications.reader', native], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', native], { stdio: 'inherit' });
  execFileSync(native, ['--self-test'], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(stage, 'dist/cli.mjs'), '--help'], { stdio: 'ignore' });
  await mkdir(artifacts, { recursive: true });
  const temporaryZip = join(temporary, name);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', stage, temporaryZip]);
  const bytes = await readFile(temporaryZip);
  await copyFile(temporaryZip, join(artifacts, name));
  await writeFile(join(artifacts, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  console.log(`Packaged artifacts/${name} (${(bytes.length / 1024 / 1024).toFixed(2)} MB). Synthetic validation only.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
