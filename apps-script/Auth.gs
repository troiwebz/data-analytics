/** Shared-secret check for the extension's JSON API. */

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkSecret_(payload) {
  if (!payload || !constantTimeEquals_(String(payload.secret || ''), SHARED_SECRET)) {
    throw new Error('bad secret');
  }
}
