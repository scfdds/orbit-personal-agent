import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  process.stderr.write('The notification reader is built on macOS only.\n');
  process.exitCode = 1;
} else {
  const directory = fileURLToPath(new URL('../native/bin/', import.meta.url));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  execFileSync('/usr/bin/swiftc', [fileURLToPath(new URL('../native/wechat-notification-db.swift', import.meta.url)),
    '-lsqlite3', '-o', `${directory}wechat-notification-db-reader`], { stdio: 'inherit', timeout: 120000 });
  process.stdout.write('Built the local notification reader. No notifications were read.\n');
}
