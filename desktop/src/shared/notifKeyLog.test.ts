import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownLogLine, notifKeyForLog } from './notifKeyLog';

const WHATSAPP = '0|com.whatsapp|1|919876543210@s.whatsapp.net|10123';

test('a tag carrying a phone number never reaches the log line', () => {
  const shown = notifKeyForLog(WHATSAPP);
  assert.ok(shown.startsWith('0|com.whatsapp|1|tag#'), `control: the package and id are kept — ${shown}`);
  assert.ok(!/\d{5,}@|9876543210/.test(shown), `the number survived: ${shown}`);
  assert.ok(shown.endsWith('|10123'), 'control: the uid is kept');
});

test('one key is shown the same way twice in a run, two keys differently', () => {
  assert.equal(notifKeyForLog(WHATSAPP), notifKeyForLog(WHATSAPP));
  assert.notEqual(notifKeyForLog(WHATSAPP), notifKeyForLog('0|com.whatsapp|1|919800000001@s.whatsapp.net|10123'));
});

test('a key with no tag is shown as it is', () => {
  assert.equal(notifKeyForLog('0|com.slack|1234|null|10123'), '0|com.slack|1234|null|10123');
});

test('a key of an unexpected shape is replaced whole', () => {
  const shown = notifKeyForLog('+15551234567');
  assert.match(shown, /^key#[0-9a-f]{8}$/);
  assert.ok(!shown.includes('5551234567'));
});

test('the cooldown line the log writes carries the package and the counts, and no number', () => {
  const line = cooldownLogLine('com.whatsapp', 'event', WHATSAPP, 3, 7, 12);
  assert.ok(line.startsWith('cooldown com.whatsapp (event key, 0|com.whatsapp|1|tag#'), `control: ${line}`);
  assert.ok(line.endsWith('3 held / 7 posted since launch, 12 keys tracked'), `control: ${line}`);
  assert.ok(!line.includes('9876543210'), `the number reached the log line: ${line}`);
});
