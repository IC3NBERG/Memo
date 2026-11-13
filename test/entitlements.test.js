'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
  </dict>
</plist>`;

test('la configurazione entitlements del repository supera la revisione', async () => {
  const { checkConfiguration } = await import('../scripts/verify-entitlements.mjs');
  const result = checkConfiguration();
  assert.deepEqual(result.problems, []);
});

test('parseEntitlements legge booleani e stringhe', async () => {
  const { parseEntitlements } = await import('../scripts/verify-entitlements.mjs');
  const entries = parseEntitlements(ENTITLEMENTS_PLIST);
  assert.deepEqual(entries, {
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.network.client': true,
  });
});

test('validateEntitlements accetta solo le chiavi approvate', async () => {
  const { validateEntitlements } = await import('../scripts/verify-entitlements.mjs');
  assert.deepEqual(validateEntitlements({
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.network.client': true,
  }, 'main'), []);

  const unknown = validateEntitlements({ 'com.example.unknown': true }, 'main');
  assert.match(unknown.join(' '), /non presente nell'allowlist/);

  const forbidden = validateEntitlements({ 'com.apple.security.get-task-allow': true }, 'main');
  assert.match(forbidden.join(' '), /chiave vietata/);

  const wrongValue = validateEntitlements({ 'com.apple.security.cs.allow-jit': false }, 'main');
  assert.match(wrongValue.join(' '), /atteso true/);

  const wrongScope = validateEntitlements({ 'com.apple.security.device.audio-input': true }, 'inherit');
  assert.match(wrongScope.join(' '), /non ammessa per inherit/);
});

test('parseEntitlements rifiuta un plist vuoto o con chiavi duplicate', async () => {
  const { parseEntitlements } = await import('../scripts/verify-entitlements.mjs');
  assert.throws(() => parseEntitlements('<plist><dict/></plist>'), /nessun entitlement/);
  assert.throws(
    () => parseEntitlements(`<key>a</key><true/><key>a</key><true/>`),
    /chiave duplicata/,
  );
});
