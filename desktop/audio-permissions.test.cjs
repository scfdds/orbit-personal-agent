const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audioRequestAllowed, audioCheckAllowed } = require('./audio-permissions.cjs');
const origin = 'http://127.0.0.1:49311';
const frame = { isMainFrame: true, requestingUrl: origin + '/?surface=quick', securityOrigin: origin };

test('media requests allow only same-origin main-frame audio, never combined camera', () => {
  const details = { ...frame, mediaTypes: ['audio'] };
  assert.equal(audioRequestAllowed('media', details, origin), true);
  for (const mediaTypes of [[], ['video'], ['audio', 'video'], undefined]) assert.equal(audioRequestAllowed('media', { ...details, mediaTypes }, origin), false);
  for (const patch of [{ isMainFrame: false }, { requestingUrl: 'https://external.test' }, { securityOrigin: 'http://127.0.0.1:49312' }]) assert.equal(audioRequestAllowed('media', { ...details, ...patch }, origin), false);
  assert.equal(audioRequestAllowed('notifications', details, origin), false);
});
test('media checks reject other frames, origins and unknown media kinds', () => {
  const details = { ...frame, mediaType: 'audio' };
  assert.equal(audioCheckAllowed('media', origin, details, origin), true);
  for (const patch of [{ mediaType: 'unknown' }, { mediaType: 'video' }, { isMainFrame: false }, { requestingUrl: undefined }, { embeddingOrigin: 'https://external.test' }]) assert.equal(audioCheckAllowed('media', origin, { ...details, ...patch }, origin), false);
  assert.equal(audioCheckAllowed('media', 'http://127.0.0.1:49312', details, origin), false);
  assert.equal(audioCheckAllowed('geolocation', origin, details, origin), false);
});
