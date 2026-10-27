import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archive = process.argv[2] ?? join(root, 'artifacts', `orbit-wechat-notifications-macos-${process.arch}-${pkg.version}.zip`);
const allowed = new Set(['README.md', 'plugin.json', 'mcp.json', '.mcp.json', '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json', 'skills/wechat-notifications/SKILL.md', 'dist/cli.mjs',
  'dist/THIRD-PARTY-LICENSES.txt', 'native/bin/wechat-notification-db-reader']);
const entries = execFileSync('/usr/bin/unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').filter(entry => !entry.endsWith('/'));
assert.equal(entries.length, allowed.size);
for (const entry of entries) {
  assert.ok(entry.startsWith('wechat-notifications/'));
  assert.ok(allowed.has(entry.slice('wechat-notifications/'.length)), 'Unexpected file in public package.');
}
const temporary = await mkdtemp(join(tmpdir(), 'orbit-plugin-unpack-test-'));
let client;
try {
  execFileSync('/usr/bin/unzip', ['-q', archive, '-d', temporary]);
  const unpacked = join(temporary, 'wechat-notifications');
  for (const name of allowed) {
    if (name.startsWith('native/bin/')) continue;
    const text = await readFile(join(unpacked, name), 'utf8');
    assert.ok(!/\/Users\/[^/]+\//.test(text), 'Private machine path in package.');
    assert.ok(!/(?:sk-[A-Za-z0-9_-]{24,}|gh[opusr]_[A-Za-z0-9]{25,}|-----BEGIN .*PRIVATE KEY-----)/.test(text), 'Possible credential in package.');
  }
  const dataDir = join(temporary, 'must-not-exist');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(unpacked, 'dist/cli.mjs'), 'demo', '--data-dir', dataDir], stderr: 'pipe', cwd: temporary });
  client = new Client({ name: 'release-test', version: '1.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 5);
  const response = await client.callTool({ name: 'wechat_search', arguments: { query: '下单' } });
  const value = JSON.parse(response.content[0].text);
  assert.equal(value.synthetic, true);
  assert.equal(value.messages.length, 1);
  assert.equal(value.capture.reason, 'DEMO_MODE');
  assert.deepEqual(await readdir(temporary), ['wechat-notifications']);
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', join(unpacked, 'native/bin/wechat-notification-db-reader')]);
  console.log('Release verified: allowlisted files, no credential/local-path matches, standalone MCP demo, no personal data writes, native signature.');
} finally {
  await client?.close();
  await rm(temporary, { recursive: true, force: true });
}
