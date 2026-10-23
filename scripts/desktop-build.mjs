import { readdir, readFile, writeFile, mkdir, cp, rm, symlink } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { execFileSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const stage = join(root, '.desktop-build', 'app');
// A strict staging allowlist keeps .env, data, archives and local MCP config out of the app.
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
async function compile(folder) {
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { await compile(path); continue; }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || /\.(?:test|d)\.ts$/.test(entry.name)) continue;
    const source = await readFile(join(root, path), 'utf8');
    const result = await transform(source, { loader: 'ts', format: 'esm', target: 'node24', sourcefile: path, sourcemap: false });
    // Static relative imports and app-registry dynamic index lookup retain the source layout.
    const code = result.code.replace(/\.ts(["'`])/g, '.js$1');
    const output = join(stage, path.replace(/\.ts$/, '.js'));
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, code);
  }
}
for (const folder of ['src/server', 'src/shared', 'src/apps']) await compile(folder);
for (const folder of ['desktop', 'dist', 'skills', 'scripts/native']) await cp(join(root, folder), join(stage, folder), { recursive: true });
// Ship a native reader so enabling the Beta does not require developer tools.
// Compilation never runs either reader or requests OS permissions.
if (process.platform === 'darwin') {
  execFileSync('/usr/bin/swiftc', [join(root, 'scripts/native/wechat-notifications.swift'), '-o', join(stage, 'scripts/native/orbit-wechat-reader')], { stdio: 'inherit', timeout: 120000 });
  execFileSync('/usr/bin/swiftc', [join(root, 'scripts/native/wechat-notification-db.swift'), '-o', join(stage, 'scripts/native/orbit-wechat-db-reader')], { stdio: 'inherit', timeout: 120000 });
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(stage, 'package.json'), JSON.stringify({ ...pkg, main: 'desktop/main.cjs', scripts: {} }, null, 2) + '\n');
await cp(join(root, 'package-lock.json'), join(stage, 'package-lock.json'));
await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
console.log(`Desktop runtime prepared: ${relative(root, stage)}`);
