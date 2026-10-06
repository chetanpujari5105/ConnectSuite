import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownLogLine, createNotifKeyLog, notifKeyForLog } from './notifKeyLog';

const WHATSAPP = '0|com.whatsapp|1|919876543210@s.whatsapp.net|10123';
const key = (tag: string) => `0|com.whatsapp|1|${tag}|10123`;
const shownTag = (line: string) => line.split('|')[3]!;

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

test('a key of an unexpected shape is replaced whole, by an ordinal', () => {
  const log = createNotifKeyLog();
  const shown = log.forLog('+15551234567');
  assert.match(shown, /^key#\d+$/);
  assert.ok(!shown.includes('5551234567'));
  assert.equal(log.forLog('+15551234567'), shown, 'the same malformed key correlates within a run');
  assert.match(log.forLog(''), /^key#\d+$/, 'an empty key is malformed too');
  assert.match(log.forLog('a|b|c|d|e|f'), /^key#\d+$/, 'six parts is not the shape');
});

test('the cooldown line the log writes carries the package and the counts, and no number', () => {
  const line = cooldownLogLine('com.whatsapp', 'event', WHATSAPP, 3, 7, 12);
  assert.ok(line.startsWith('cooldown com.whatsapp (event key, 0|com.whatsapp|1|tag#'), `control: ${line}`);
  assert.ok(line.endsWith('3 held / 7 posted since launch, 12 keys tracked'), `control: ${line}`);
  assert.ok(!line.includes('9876543210'), `the number reached the log line: ${line}`);
});

/**
 * Audit S6, the exact defect. The previous redaction was 32-bit FNV-1a with the salt in its starting
 * state; every FNV step is invertible, so one line whose tag is known gives the salt, and a dictionary
 * then gives every other tag in the run. This runs that attack on whatever the module prints. Against
 * the FNV version it recovers the hidden number (shown red on 2026-10-06); against an ordinal there is
 * no digest to invert.
 */
test('S6: knowing one tag in the log does not reveal another', () => {
  const P = 0x01000193;
  const OFFSET = 0x811c9dc5;
  let inv = P;
  for (let i = 0; i < 5; i++) inv = Math.imul(inv, (2 - Math.imul(P, inv)) >>> 0) >>> 0;
  const fwd = (s: number, t: string) => { let h = s >>> 0; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, P) >>> 0; } return h; };
  const back = (h: number, t: string) => { for (let i = t.length - 1; i >= 0; i--) { h = Math.imul(h, inv) >>> 0; h = (h ^ t.charCodeAt(i)) >>> 0; } return h; };
  const jid = (n: number) => `1555${String(n).padStart(7, '0')}@s.whatsapp.net`;

  const known = jid(1234567);
  const secret = jid(4242);
  const knownShown = shownTag(notifKeyForLog(key(known)));
  const secretShown = shownTag(notifKeyForLog(key(secret)));

  const attack = (hKnown: number | null, hSecret: number | null): string | null => {
    if (hKnown === null || hSecret === null) return null;
    const start = back(hKnown, known);
    for (let n = 0; n < 10_000; n++) if (fwd(start, jid(n)) === hSecret) return jid(n);
    return null;
  };
  const asDigest = (shown: string) => (/^tag#[0-9a-f]{8}$/.test(shown) ? parseInt(shown.slice(4), 16) >>> 0 : null);

  // Control: the attack recovers the secret from salted FNV digests made here, so a null below is a
  // reading about the module and not an attack that never worked.
  const salt = (Math.random() * 0xffffffff) >>> 0;
  const seeded = (OFFSET ^ salt) >>> 0;
  assert.equal(attack(fwd(seeded, known), fwd(seeded, secret)), secret, 'control: the attack must work on FNV');

  const recovered = attack(asDigest(knownShown), asDigest(secretShown));
  assert.equal(recovered, null, `the hidden tag was recovered from the log: ${recovered}`);
});

test('S6: the shown id depends only on the order tags were seen, never on their content', () => {
  // Two processes, fed different tags in the same order, write identical lines. A digest of any kind
  // fails this; an ordinal cannot.
  const runA = createNotifKeyLog();
  const runB = createNotifKeyLog();
  const a = ['111@s.whatsapp.net', '222@s.whatsapp.net', '111@s.whatsapp.net'].map((t) => runA.forLog(key(t)));
  const b = ['999@s.whatsapp.net', '888@s.whatsapp.net', '999@s.whatsapp.net'].map((t) => runB.forLog(key(t)));
  assert.deepEqual(a, b);
  assert.equal(shownTag(a[0]!), 'tag#1', 'a fresh process starts at 1 — ids do not carry across a restart');
  assert.notEqual(a[0], a[1], 'control: two tags are still told apart within a run');
  assert.equal(a[0], a[2], 'control: one tag still correlates within a run');
});

test('S6: no digest-shaped token and no raw tag appears in a line', () => {
  const log = createNotifKeyLog();
  for (let n = 0; n < 50; n++) {
    const tag = `9198000${String(n).padStart(5, '0')}@s.whatsapp.net`;
    const line = log.forLog(key(tag));
    assert.match(shownTag(line), /^tag#\d+$/);
    assert.ok(!line.includes(tag.slice(0, 12)), `the raw tag reached the line: ${line}`);
  }
});

test('S6: retained state is bounded and holds no raw tag', () => {
  const log = createNotifKeyLog(16);
  const tags = Array.from({ length: 40 }, (_, n) => `91980000${String(n).padStart(4, '0')}@s.whatsapp.net`);
  for (const t of tags) log.forLog(key(t));
  assert.equal(log.tracked(), 16, 'the table must stop growing at its bound');
  for (const held of log.heldKeysForTest()) {
    assert.ok(!tags.some((t) => held.includes(t) || held.includes(t.slice(0, 12))), `a raw tag is held: ${held}`);
  }
  // An evicted tag is seen as new: correlation is lost for very old tags, never wrongly merged.
  const first = log.forLog(key(tags[0]!));
  assert.equal(shownTag(first), 'tag#41');
});
