import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import electron from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The developer's key remains outside the staged/packaged application.
if (existsSync(join(root, '.env.local'))) process.loadEnvFile(join(root, '.env.local'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, '.desktop-build/app')], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
