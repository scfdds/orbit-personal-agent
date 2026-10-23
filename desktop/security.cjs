const { URL } = require('node:url');

function sameOrigin(candidate, origin) {
  try { return new URL(candidate).origin === origin; } catch { return false; }
}
function externalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function navigationTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.conversationId === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value.conversationId)) result.conversationId = value.conversationId;
  for (const key of ['deliveryId', 'runId', 'requestId']) {
    if (typeof value[key] === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value[key])) result[key] = value[key];
  }
  if (Number.isSafeInteger(value.generation) && value.generation >= 0) result.generation = value.generation;
  if (value.voiceInput === true) result.voiceInput = true;
  if (value.view === 'home' || value.view === 'settings') result.view = value.view;
  return result;
}
module.exports = { sameOrigin, externalUrl, navigationTarget };
