import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { test } from 'node:test';
import { formatPhoneAddress, parsePhoneAddress } from './phoneAddress';

/** Typed in the tester's video, 2026-11-09, exactly as the phone displays it. */
const AS_THE_PHONE_SHOWS_IT = '10.35.99.249:42501';

test('the address exactly as the phone displays it yields a host Node can connect to', () => {
  // Control: the untreated string is not an address, which is why it failed with ENOTFOUND.
  assert.equal(isIP(AS_THE_PHONE_SHOWS_IT), 0);

  const parsed = parsePhoneAddress(AS_THE_PHONE_SHOWS_IT);
  assert.deepEqual(parsed, { ok: true, host: '10.35.99.249', port: 42501 });
  assert.equal(isIP((parsed as { host: string }).host), 4);
});

test('a bare address has no port, so the caller default applies', () => {
  assert.deepEqual(parsePhoneAddress('  192.168.1.42 '), { ok: true, host: '192.168.1.42', port: null });
  assert.deepEqual(parsePhoneAddress('pixel.local'), { ok: true, host: 'pixel.local', port: null });
});

test('a pasted scheme or path is dropped', () => {
  assert.deepEqual(parsePhoneAddress('http://192.168.1.42:42501/'), { ok: true, host: '192.168.1.42', port: 42501 });
});

test('IPv6 is left whole unless bracketed with a port', () => {
  assert.deepEqual(parsePhoneAddress('fe80::1'), { ok: true, host: 'fe80::1', port: null });
  assert.deepEqual(parsePhoneAddress('[fe80::1]:42501'), { ok: true, host: 'fe80::1', port: 42501 });
});

test('what cannot be an address is refused with which part is wrong', () => {
  assert.deepEqual(parsePhoneAddress(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parsePhoneAddress('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(parsePhoneAddress('192.168.1.42:port'), { ok: false, reason: 'bad-port' });
  assert.deepEqual(parsePhoneAddress('192.168.1.42:0'), { ok: false, reason: 'bad-port' });
  assert.deepEqual(parsePhoneAddress('192.168.1.42:70000'), { ok: false, reason: 'bad-port' });
  assert.deepEqual(parsePhoneAddress('my phone'), { ok: false, reason: 'bad-host' });
  assert.deepEqual(parsePhoneAddress(':42501'), { ok: false, reason: 'bad-host' });
});

test('formatting round-trips through the parser', () => {
  for (const text of ['192.168.1.42', '192.168.1.42:42501', '[fe80::1]:42501', 'fe80::1']) {
    const parsed = parsePhoneAddress(text);
    assert.ok(parsed.ok);
    assert.equal(formatPhoneAddress(parsed), text);
  }
});
