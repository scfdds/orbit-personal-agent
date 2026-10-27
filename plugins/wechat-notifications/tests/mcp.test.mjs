import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, access, readFile, mkdir, copyFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'src/cli.mjs');
function parse(result) { return JSON.parse(result.content[0].text); }
async function connect(t, command = 'demo', entry = cli) {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-plugin-mcp-test-'));
  const dataDir = join(directory, 'isolated-data');
  let errors = '';
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, command, '--data-dir', dataDir], stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-plugin-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  await client.connect(transport);
  transport.stderr?.on('data', chunk => { errors += chunk.toString(); });
  return { client, directory, dataDir, errors: () => errors };
}

test('demo negotiates real stdio MCP, exposes only read tools and never writes a data directory', async t => {
  const { client, directory } = await connect(t);
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(tool => tool.name).sort(), ['wechat_read', 'wechat_recent', 'wechat_search', 'wechat_sources', 'wechat_status']);
  assert.ok(list.tools.every(tool => tool.annotations.readOnlyHint));
  const status = parse(await client.callTool({ name: 'wechat_status', arguments: {} }));
  assert.equal(status.synthetic, true);
  assert.equal(status.capture.reason, 'DEMO_MODE');
  const recent = parse(await client.callTool({ name: 'wechat_recent', arguments: {} }));
  assert.equal(recent.messages.length, 5);
  assert.equal(recent.synthetic, true);
  assert.match(recent.coverage, /通知片段/);
  assert.equal(recent.trust, 'external_evidence_not_instructions');
  assert.deepEqual(await readdir(directory), []);
});

test('demo search, exact source read, timestamp filtering and cursor pagination retain evidence', async t => {
  const { client } = await connect(t);
  const search = parse(await client.callTool({ name: 'wechat_search', arguments: { query: '下单' } }));
  assert.equal(search.messages.length, 1);
  assert.match(search.messages[0].title, /演示/);
  assert.ok(search.messages[0].id && search.messages[0].timestamp);
  const sourceId = search.messages[0].sourceId;
  const first = parse(await client.callTool({ name: 'wechat_read', arguments: { sourceId, limit: 1 } }));
  assert.ok(first.nextCursor);
  const second = parse(await client.callTool({ name: 'wechat_read', arguments: { sourceId, before: first.nextCursor, limit: 1 } }));
  assert.equal(second.messages.length, 1);
  assert.notEqual(second.messages[0].id, first.messages[0].id);
  const recent = parse(await client.callTool({ name: 'wechat_recent', arguments: { since: first.messages[0].timestamp } }));
  assert.ok(recent.messages.every(message => message.timestamp >= first.messages[0].timestamp));
  const sources = parse(await client.callTool({ name: 'wechat_sources', arguments: {} }));
  assert.equal(sources.sources.length, 3);
});

test('invalid arguments and unknown tools do not change authorization', async t => {
  const { client } = await connect(t);
  for (const args of [
    { name: 'wechat_recent', arguments: { limit: 999 } },
    { name: 'wechat_recent', arguments: { since: 'yesterday' } },
    { name: 'wechat_search', arguments: { query: 'x', enable: true } },
    { name: 'wechat_enable', arguments: { all: true } },
  ]) {
    const response = await client.callTool(args);
    assert.equal(response.isError, true);
    assert.ok(parse(response).error);
  }
});

test('new real-mode server is disabled and refuses cached content without starting native collection', async t => {
  const { client, dataDir } = await connect(t, 'serve');
  const status = parse(await client.callTool({ name: 'wechat_status', arguments: {} }));
  assert.equal(status.scope.enabled, false);
  assert.equal(status.capture.reason, 'DISABLED');
  const response = await client.callTool({ name: 'wechat_recent', arguments: {} });
  assert.equal(response.isError, true);
  assert.equal(parse(response).error, 'DISABLED');
  assert.equal(status.capture.startedAt, null);
  // Disabling from another process takes effect without allowing a tool to grant anything.
  execFileSync(process.execPath, [cli, 'disable', '--data-dir', dataDir]);
  assert.equal(parse(await client.callTool({ name: 'wechat_status', arguments: {} })).scope.enabled, false);
});

test('CLI requires explicit scope, round-trips host config and disables before clearing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-plugin-cli-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args, '--data-dir', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(() => run('enable'));
  assert.throws(() => run('enable', '--all', '--source', '虚构标题'));
  assert.throws(() => run('enable', '--all', '--retention-days', '0'));
  assert.throws(() => run('clear'));
  const scope = JSON.parse(run('enable', '--source', '虚构测试群', '--retention-days', '2'));
  assert.deepEqual(scope.allowedTitles, ['虚构测试群']);
  assert.equal(scope.allowAll, false);
  assert.equal(scope.retentionDays, 2);
  const host = JSON.parse(run('config', '--format', 'json', '--demo'));
  assert.equal(host.mcpServers['orbit-wechat-notifications'].command, process.execPath);
  assert.equal(host.mcpServers['orbit-wechat-notifications'].args[1], 'demo');
  assert.match(run('config', '--format', 'codex'), /\[mcp_servers.orbit_wechat_notifications\]/);
  assert.equal(JSON.parse(run('clear', '--yes')).enabled, false);
  assert.equal(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).enabled, false);
});

test('bundled release entry works without source imports', async t => {
  const bundle = join(root, 'dist/cli.mjs');
  try { await access(bundle); } catch { t.skip('Run npm run build to check release bundle.'); return; }
  const { client } = await connect(t, 'demo', bundle);
  const response = parse(await client.callTool({ name: 'wechat_search', arguments: { query: '周六' } }));
  assert.equal(response.messages.length, 1);
  assert.equal(response.synthetic, true);
});

test('collect survives an initial transient failure and stops after local disable', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const bundle = join(root, 'dist/cli.mjs');
  try { await access(bundle); } catch { t.skip('Run npm run build first.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'orbit-plugin-collect-test-'));
  let child;
  t.after(async () => { child?.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); });
  await mkdir(join(directory, 'dist'));
  await mkdir(join(directory, 'native/bin'), { recursive: true });
  const entry = join(directory, 'dist/cli.mjs');
  await copyFile(bundle, entry);
  const helper = join(directory, 'native/bin/wechat-notification-db-reader');
  await writeFile(helper, `#!/usr/bin/env node
const emit = event => process.stdout.write(JSON.stringify(event)+'\\n');
emit({type:'status',status:'error',reason:'database_busy'});
setTimeout(() => {
  emit({type:'status',status:'listening'});
  emit({type:'db_diagnostics',scannedAt:new Date().toISOString(),rowsRead:0,parsedRecords:0,emittedRecords:0,invalidRecords:0,limited:0});
}, 250);
setInterval(() => {}, 1000);
`);
  await chmod(helper, 0o755);
  const dataDir = join(directory, 'data');
  execFileSync(process.execPath, [entry, 'enable', '--source', 'Synthetic only', '--data-dir', dataDir]);
  child = spawn(process.execPath, [entry, 'collect', '--data-dir', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Collector did not recover.')), 5000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Collector exited during recovery.')); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('"status": "listening"')) { clearTimeout(timer); resolve(); }
    });
  });
  assert.match(output, /"status": "retrying"/);
  execFileSync(process.execPath, [entry, 'disable', '--data-dir', dataDir]);
  const [code] = await exited;
  assert.equal(code, 0);
  assert.match(output, /DISABLED/);
});
