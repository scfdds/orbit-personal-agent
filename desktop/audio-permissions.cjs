const { sameOrigin } = require('./security.cjs');

// Only the app's main frames may capture a microphone. No embedded app, camera,
// screen, device enumeration, or unknown media request inherits that permission.
function audioRequestAllowed(permission, details, origin) {
  return permission === 'media' && details?.isMainFrame === true
    && sameOrigin(details.requestingUrl, origin)
    && (!details.securityOrigin || sameOrigin(details.securityOrigin, origin))
    && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1
    && details.mediaTypes[0] === 'audio';
}
function audioCheckAllowed(permission, requestingOrigin, details, origin) {
  return permission === 'media' && details?.mediaType === 'audio'
    && details.isMainFrame === true && sameOrigin(requestingOrigin, origin)
    && sameOrigin(details.requestingUrl, origin)
    && (!details.securityOrigin || sameOrigin(details.securityOrigin, origin))
    && (!details.embeddingOrigin || sameOrigin(details.embeddingOrigin, origin));
}
module.exports = { audioRequestAllowed, audioCheckAllowed };
