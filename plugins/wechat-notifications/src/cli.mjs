#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config.mjs';
import { NotificationStore } from './store.mjs';
import { NotificationCollector } from './collector.mjs';
import { demoNotifications } from './demo.mjs';
import { createNotificationServer } from './server.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const helperPath = join(packageRoot, 'native/bin/wechat-notification-db-reader');
const output = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
const usage = `Orbit 微信通知插件

  node src/cli.mjs serve                    启动本地 MCP（默认真实采集关闭）
  node src/cli.mjs demo                     启动仅含虚构数据的 MCP
  node src/cli.mjs enable --all              允许读取全部微信通知来源
  node src/cli.mjs enable --source "群标题"   只允许指定标题；--source 可重复
  node src/cli.mjs disable                  停止采集，并禁止 Agent 读取缓存
  node src/cli.mjs status                   查看持久化的开关与来源范围
  node src/cli.mjs collect                  持续采集到本地，Ctrl+C 结束
  node src/cli.mjs doctor [--probe]          检查环境；--probe 检查已授权的真实读取
  node src/cli.mjs clear --yes              关闭采集并清空插件缓存
  node src/cli.mjs config --format json     输出 MCP 配置；也支持 codex

通用参数：--data-dir /绝对路径；或 ORBIT_WECHAT_DATA_DIR。
enable 可加 --retention-days 7（1–90）；config 可加 --demo。
安装不会自动授权。通知片段不等于完整聊天；不会发送微信消息。`;

function argumentsFor(args) {
  const parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, all: { type: 'boolean' },
    source: { type: 'string', multiple: true }, 'retention-days': { type: 'string' },
    'data-dir': { type: 'string' }, format: { type: 'string' }, demo: { type: 'boolean' },
    yes: { type: 'boolean' }, probe: { type: 'boolean' },
  } });
  if (parsed.positionals.length > 1) throw new Error('Only one command is supported.');
  const command = parsed.positionals[0] ?? 'serve';
  const allowed = {
    serve: [], demo: [], enable: ['all', 'source', 'retention-days'], disable: [], status: [],
    collect: [], doctor: ['probe'], clear: ['yes'], config: ['format', 'demo'],
  };
  if (parsed.values.help) return { command: 'help', values: parsed.values };
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command.');
  for (const key of Object.keys(parsed.values)) {
    if (!['help', 'data-dir', ...allowed[command]].includes(key)) throw new Error('Unsupported option for command.');
  }
  return { command, values: parsed.values };
}

export async function main(args = process.argv.slice(2)) {
  const { command, values } = argumentsFor(args);
  if (command === 'help') { output(usage); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  process.umask(0o077);
  const dataDir = values['data-dir'] ?? process.env.ORBIT_WECHAT_DATA_DIR ?? join(homedir(), 'Library/Application Support/Orbit WeChat Notifications');
  if (!isAbsolute(dataDir)) throw new Error('Data directory must be absolute.');
  if (command === 'config') {
    const format = values.format ?? 'json';
    if (!['json', 'codex'].includes(format)) throw new Error('Unknown configuration format.');
    const entry = join(packageRoot, existsSync(join(packageRoot, 'dist/cli.mjs')) ? 'dist/cli.mjs' : 'src/cli.mjs');
    const params = [entry, values.demo ? 'demo' : 'serve', '--data-dir', dataDir];
    if (format === 'json') output({ mcpServers: { 'orbit-wechat-notifications': { command: process.execPath, args: params } } });
    else output(`[mcp_servers.orbit_wechat_notifications]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(params)}\nstartup_timeout_sec = 20`);
    return;
  }
  if (command === 'enable') {
    if ((!values.all && !values.source?.length) || (values.all && values.source?.length)) {
      throw new Error('Choose --all or one or more --source titles.');
    }
    const retentionDays = values['retention-days'] === undefined ? loadConfig(dataDir).retentionDays : Number(values['retention-days']);
    const config = saveConfig(dataDir, { enabled: true, allowAll: Boolean(values.all), allowedTitles: values.source ?? [], retentionDays });
    output({ ...config, note: '已保存允许范围。请启动或重连 MCP，或运行 collect；系统完全磁盘访问权限需另行授权。被工具读取的片段会进入宿主 Agent 的上下文。' });
    return;
  }
  if (command === 'disable') { output(saveConfig(dataDir, { enabled: false })); return; }
  if (command === 'status') {
    output({ config: loadConfig(dataDir), note: '这是本机持久化配置，不表示其他进程正在运行或已经获得系统权限。运行状态请查看 wechat_status。' });
    return;
  }
  if (command === 'clear') {
    if (!values.yes) throw new Error('Use clear --yes to disable capture and erase the plugin cache.');
    saveConfig(dataDir, { enabled: false });
    const store = new NotificationStore({ dataDir });
    try { output({ ...store.clear(), enabled: false, note: '仅清理插件缓存；不删除系统通知。重新开启后，系统保留的通知可能再次读入。' }); }
    finally { store.close(); }
    return;
  }
  if (command === 'doctor') {
    let nativeReady = false;
    try { await access(helperPath, constants.X_OK); nativeReady = true; } catch { /* known missing helper */ }
    const config = loadConfig(dataDir);
    const checks = { platform: process.platform, supported: process.platform === 'darwin', node: process.versions.node,
      nativeReady, enabled: config.enabled, allowedSourceCount: config.allowedTitles.length, allowAll: config.allowAll,
      note: '默认仅检查环境，不读取系统通知。--probe 会启动一次已开启的采集检查，仅打印计数。' };
    if (values.probe) {
      const store = new NotificationStore({ dataDir });
      const collector = new NotificationCollector({ store, dataDir, helperPath });
      try { checks.capture = await collector.start(); }
      finally { collector.stop(); store.close(); }
    }
    output(checks);
    if (!checks.supported || !nativeReady || (values.probe && checks.capture?.status !== 'listening')) process.exitCode = 1;
    return;
  }

  const demo = command === 'demo';
  const getConfig = demo ? () => ({ ...DEFAULT_CONFIG, enabled: true, allowAll: true }) : () => loadConfig(dataDir);
  const store = new NotificationStore({ dataDir: demo ? null : dataDir, memory: demo, config: getConfig });
  const collector = new NotificationCollector({ store, dataDir, config: getConfig, helperPath, demo });
  if (demo) store.ingest(demoNotifications());
  const ready = collector.start();
  let server;
  let stateMonitor;
  let closed = false;
  let resolveClosed;
  const done = new Promise(resolve => { resolveClosed = resolve; });
  const cleanup = () => {
    if (closed) return;
    closed = true; clearInterval(stateMonitor); collector.stop(); store.close(); resolveClosed();
  };
  const stop = () => { cleanup(); void server?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'collect') {
      const state = await ready;
      output({ capture: state });
      if (!['listening', 'starting', 'retrying'].includes(state.status)) { process.exitCode = 1; cleanup(); }
      else {
        let signature = JSON.stringify([state.status, state.reason, state.permission]);
        stateMonitor = setInterval(() => {
          const current = collector.status();
          const next = JSON.stringify([current.status, current.reason, current.permission]);
          if (next !== signature) { output({ capture: current }); signature = next; }
          if (['error', 'blocked', 'stopped'].includes(current.status)) {
            if (current.reason !== 'DISABLED') process.exitCode = 1;
            cleanup();
          }
        }, 1000);
      }
    } else {
      server = createNotificationServer({ store, collector, getConfig, demo, ready });
      server.onclose = cleanup;
      await server.connect(new StdioServerTransport());
    }
    await done;
  } finally {
    cleanup(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

// Also works after esbuild bundles this entry to dist/cli.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(error => {
    // Never print raw exceptions: they can contain paths, payloads or SQL parameters.
    const code = typeof error?.code === 'string' && /^[A-Z_]{2,40}$/.test(error.code) ? error.code : 'COMMAND_FAILED';
    process.stderr.write(`Orbit WeChat: ${code}. Use --help or doctor for setup.\n`);
    process.exitCode = 1;
  });
}
