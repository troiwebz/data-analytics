/**
 * One-time tokens for the approve/edit/skip links.
 *
 * Gmail, corporate mail scanners and link-preview bots pre-fetch URLs found in
 * email. A bare GET that approves a post WILL fire on its own. So: the token
 * proves the link came from us and expires, and the GET only ever renders a
 * confirmation page — the state change happens on POST, from a button press.
 */

function signToken_(threadId, action) {
  const exp = Math.floor(Date.now() / 60000) + APPROVE_TOKEN_TTL_MIN;
  return exp + '.' + hmac_(threadId + '|' + action + '|' + exp);
}

function verifyToken_(threadId, action, token) {
  if (!token || token.indexOf('.') === -1) return false;
  const parts = token.split('.');
  const exp = parseInt(parts[0], 10);
  if (!isFinite(exp) || exp < Math.floor(Date.now() / 60000)) return false;
  const expected = hmac_(threadId + '|' + action + '|' + exp);
  return constantTimeEquals_(expected, parts.slice(1).join('.'));
}

function hmac_(msg) {
  const raw = Utilities.computeHmacSha256Signature(msg, SHARED_SECRET);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

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
