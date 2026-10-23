// Runs in Electron's Node utility process, not in the renderer.
let backend;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (backend) {
      await backend.server.closeWorkspaces();
      await backend.runtime.close();
      backend.server.close();
      backend.server.closeAllConnections();
      backend.runtime.store.close();
    }
    process.parentPort?.postMessage({ type: 'stopped' });
  } finally { process.exit(0); }
}
process.parentPort?.on('message', ({ data }) => {
  if (data?.type === 'shutdown') void stop();
});
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.close();
  const { startServer } = await import('../src/server/http.js');
  backend = await startServer();
  const address = backend.server.address();
  if (!address || typeof address === 'string') throw new Error('Backend did not bind a local port');
  process.parentPort?.postMessage({ type: 'ready', port: address.port, nodeVersion: process.versions.node });
} catch (error) {
  // Deliberately omit env/configuration and stack traces from the desktop log.
  process.parentPort?.postMessage({ type: 'error', message: String(error?.message || 'Backend startup failed') });
  process.exit(1);
}
