import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from './api.ts';
import { setWorkspaceMode, setWorkspaceSwitching } from './workspace-mode.ts';

const json = (value: unknown, revision: string) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'x-orbit-workspace': revision } });

test('requests carry the captured workspace revision and reject late responses after switching', async () => {
  const original = globalThis.fetch;
  let respond!: (value: Response) => void;
  setWorkspaceMode({ demo: false, revision: 'real-1' });
  globalThis.fetch = async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('x-orbit-workspace'), 'real-1');
    return new Promise<Response>(resolve => { respond = resolve; });
  };
  try {
    const pending = request('/projects', 'POST', { name: 'Original' });
    setWorkspaceMode({ demo: true, revision: 'demo-2' });
    respond(json({ id: 'real-project' }, 'real-1'));
    await assert.rejects(pending, /工作空间已切换/);
  } finally { globalThis.fetch = original; }
});

test('switching blocks ordinary API calls but permits mode reconciliation', async () => {
  const original = globalThis.fetch;
  setWorkspaceMode({ demo: false, revision: 'real-3' });
  setWorkspaceSwitching(true);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ demo: false, revision: 'real-3' }, 'real-3'); };
  try {
    await assert.rejects(request('/conversations/main/messages', 'POST', { content: 'late' }), /正在切换/);
    assert.equal(calls, 0);
    assert.deepEqual(await request('/workspace-mode'), { demo: false, revision: 'real-3' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; setWorkspaceSwitching(false); }
});
