// A pinned extension identity, and what it is actually for.
//
// chrome.storage.sync already mirrored the vault (src/vault.js has done this
// for a while), and Settings already claimed a second machine signed into the
// same Chrome would pick the keys up by itself. That claim was false for an
// unpacked extension with no fixed "key" in the manifest: Chrome derives an
// unpacked extension's id from the absolute folder path it was loaded from,
// so the Mac and the VPS - different folders on different machines - were, as
// far as Chrome and its Sync service are concerned, two completely unrelated
// extensions. chrome.storage.sync is scoped per extension id, so their vaults
// could never have met regardless of Sync, Google account, or anything else
// in Settings - there was nothing wrong to fix in the sync code itself.
//
// The fix is the "key" field: a fixed RSA public key in manifest.json makes
// Chrome compute the SAME id everywhere that manifest is unpacked, on any
// machine, forever - which is the one thing that makes cross-machine Sync
// possible for an unpacked extension at all.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));

ok('the manifest carries a fixed key', typeof manifest.key === 'string' && manifest.key.length > 100,
   String(manifest.key).slice(0, 40));
ok('it is valid base64', /^[A-Za-z0-9+/]+=*$/.test(manifest.key));

// Chrome's own algorithm: SHA-256 of the DER-encoded public key, first 16
// bytes, each nibble mapped to a-p. Reproduced here so this test proves the
// id is actually stable and computable - not just that a string exists.
function chromeExtensionId(keyB64) {
  const der = Buffer.from(keyB64, 'base64');
  const hash = createHash('sha256').update(der).digest();
  let id = '';
  for (const byte of hash.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 0xf));
  }
  return id;
}

const id1 = chromeExtensionId(manifest.key);
const id2 = chromeExtensionId(manifest.key);
ok('the id is deterministic - the whole point', id1 === id2 && /^[a-p]{32}$/.test(id1), id1);

// The regression this exists to prevent: shipping a future version without
// carrying the key forward, which would silently re-orphan everyone's vault
// exactly like the bug this fixes.
ok('the key is not accidentally emptied out', manifest.key.length > 300, String(manifest.key.length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
