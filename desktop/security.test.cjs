const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sameOrigin, externalUrl, navigationTarget } = require('./security.cjs');

test('service credentials are restricted to the exact loopback origin', () => {
  const origin = 'http://127.0.0.1:49311';
  assert.equal(sameOrigin(origin + '/api/events', origin), true);
  for (const url of ['http://127.0.0.1:49312/api', 'https://127.0.0.1:49311/api', 'http://127.0.0.1.attacker.test:49311/api', 'file:///api', 'not a url']) assert.equal(sameOrigin(url, origin), false);
});
test('external navigation only opens web URLs without credentials', () => {
  assert.equal(externalUrl('https://example.com/report?q=1'), 'https://example.com/report?q=1');
  for (const url of ['javascript:alert(1)', 'file:///Applications/Orbit.app', 'orbit://open', 'https://user:password@example.com', 'not a url']) assert.equal(externalUrl(url), null);
});
test('navigation bridge copies only a valid target rather than arbitrary renderer payloads', () => {
  assert.deepEqual(navigationTarget({ conversationId: 'thread-123', view: 'settings', file: '/etc/passwd', command: 'rm' }), { conversationId: 'thread-123', view: 'settings' });
  assert.deepEqual(navigationTarget({ conversationId: '../../escape', view: 'shell' }), {});
  assert.deepEqual(navigationTarget(null), {});
  assert.deepEqual(navigationTarget({ conversationId: 'thread-123', deliveryId: 'delivery_abc', runId: 'run_abc', requestId: 'abc-123', generation: 3, spokenText: 'Never forward free-form text' }),
    { conversationId: 'thread-123', deliveryId: 'delivery_abc', runId: 'run_abc', requestId: 'abc-123', generation: 3 });
  assert.deepEqual(navigationTarget({ deliveryId: '../invalid', runId: {}, requestId: 'x'.repeat(161), generation: -1 }), {});
  assert.deepEqual(navigationTarget({ voiceInput: true }), { voiceInput: true });
  assert.deepEqual(navigationTarget({ voiceInput: 'true' }), {});
});
