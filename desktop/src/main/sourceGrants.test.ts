import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DROP_FOLDERS_MAX, DROP_LIST_FILES_MAX, SOURCE_GRANT_TTL_MS, SourceGrants, dropConfirmation, dropSheetConfirmed, dropSheetOptions } from './sourceGrants';

const id = (ino: number) => ({ dev: 1, ino });

test('a grant is for one window, one file identity, and one hour', () => {
  let now = 1_000;
  const grants = new SourceGrants(() => now);
  const owner = {};
  grants.grant('/f', owner, id(7));
  assert.deepEqual(grants.check('/f', owner, id(7)), { ok: true }, 'control');
  assert.deepEqual(grants.check('/g', owner, id(7)), { ok: false, refusal: 'not-chosen' });
  assert.deepEqual(grants.check('/f', {}, id(7)), { ok: false, refusal: 'other-window' });
  assert.deepEqual(grants.check('/f', owner, id(8)), { ok: false, refusal: 'changed' });
  assert.deepEqual(grants.check('/f', owner, null), { ok: false, refusal: 'changed' });
  now += SOURCE_GRANT_TTL_MS;
  assert.deepEqual(grants.check('/f', owner, id(7)), { ok: true }, 'exactly an hour is still in time');
  now += 1;
  assert.deepEqual(grants.check('/f', owner, id(7)), { ok: false, refusal: 'expired' });
  assert.deepEqual(grants.check('/f', owner, id(7)), { ok: false, refusal: 'not-chosen' }, 'removed once expired');
});

test('closing a window revokes its grants and only its grants', () => {
  const grants = new SourceGrants(() => 0);
  const a = {};
  const b = {};
  grants.grant('/a', a, id(1));
  grants.grant('/b', b, id(2));
  assert.equal(grants.revokeOwner(a), 1);
  assert.equal(grants.check('/a', a, id(1)).ok, false);
  assert.equal(grants.check('/b', b, id(2)).ok, true);
});

test('grants are bounded', () => {
  const grants = new SourceGrants(() => 0, SOURCE_GRANT_TTL_MS, 3);
  const o = {};
  for (let i = 0; i < 10; i += 1) grants.grant(`/f${i}`, o, id(i));
  assert.equal(grants.size(), 3);
  assert.equal(grants.check('/f0', o, id(0)).ok, false);
  assert.equal(grants.check('/f9', o, id(9)).ok, true);
});

test('the drop sheet names every file when there are few', () => {
  const sheet = dropConfirmation(['/Users/p/Desktop/a.txt', '/Users/p/.ssh/id_rsa'], '/Users/p');
  assert.equal(sheet.kind, 'ask');
  if (sheet.kind !== 'ask') return;
  assert.equal(sheet.message, 'Send these 2 files to your phone?');
  assert.equal(sheet.detail, '~/Desktop/a.txt\n~/.ssh/id_rsa');
  const one = dropConfirmation(['/tmp/x.bin'], '/Users/p');
  assert.equal(one.kind === 'ask' && one.message, 'Send “x.bin” to your phone?');
});

test('a file cannot hide as the thirteenth of a long drop: every source folder is shown with its count', () => {
  const many = Array.from({ length: DROP_LIST_FILES_MAX + 5 }, (_, i) => `/Users/p/Pictures/${i}.jpg`);
  const sheet = dropConfirmation([...many, '/Users/p/.ssh/id_rsa'], '/Users/p');
  assert.equal(sheet.kind, 'ask');
  if (sheet.kind !== 'ask') return;
  assert.match(sheet.detail, /^17 files from ~\/Pictures$/m);
  assert.match(sheet.detail, /^1 file from ~\/\.ssh$/m);
});

test('a drop from more folders than the sheet can show is refused, with the picker named', () => {
  const spread = Array.from({ length: DROP_FOLDERS_MAX + 1 }, (_, i) => Array.from({ length: 2 }, (_, j) => `/d${i}/${j}`)).flat();
  const sheet = dropConfirmation(spread, null);
  assert.equal(sheet.kind, 'refuse');
  assert.match(sheet.kind === 'refuse' ? sheet.reason : '', /Send to phone…/);
  const fits = dropConfirmation(spread.slice(0, DROP_FOLDERS_MAX * 2), null);
  assert.equal(fits.kind, 'ask', 'control: exactly the maximum number of folders is still shown');
});

/**
 * What a macOS sheet does with these options. A model of Electron 43.4.1's
 * `shell/browser/ui/message_box_mac.mm` (`CreateNSAlert`), because no unit test can reach the real
 * NSAlert: NSAlert gives the FIRST button added Return; a valid `defaultId` takes Return off button 0
 * and puts it on `defaultId`; then a valid `cancelId` puts Escape on `cancelId` — overwriting Return if
 * it is the same button — and, when `cancelId === defaultId`, draws that button highlighted.
 * `lib/browser/api/dialog.ts` defaults `defaultId` to -1. Not reached: the sheet itself; that is the
 * hardware re-test (Return and Escape on a real drop).
 */
function macSheetKeys(o: { buttons: string[]; defaultId: number; cancelId: number }) {
  const keys = o.buttons.map((_, i) => (i === 0 ? '\r' : ''));
  if (o.defaultId >= 0 && o.defaultId < o.buttons.length) {
    keys[0] = '';
    keys[o.defaultId] = '\r';
  }
  let highlighted: string | null = null;
  if (o.buttons.length > 1 && o.cancelId >= 0) {
    if (o.cancelId < o.buttons.length) keys[o.cancelId] = '\e';
    if (o.cancelId === o.defaultId) highlighted = o.buttons[o.defaultId] ?? null;
  }
  const answers = (key: string) => {
    const i = keys.indexOf(key);
    return i < 0 ? null : o.buttons[i]!;
  };
  return { returnKey: answers('\r'), escapeKey: answers('\e'), highlighted };
}

test('control: the model reproduces the 2026-10-07 reading of the shipped sheet (Return answered nothing, Escape cancelled)', () => {
  const shipped = macSheetKeys({ buttons: ['Send', 'Cancel'], defaultId: 1, cancelId: 1 });
  assert.equal(shipped.returnKey, null, '22:16:41 — Return once, sheet stayed open, no log line');
  assert.equal(shipped.escapeKey, 'Cancel', '22:20:05 — Escape once, "not confirmed — nothing granted"');
  // And the trap the recorded fix direction ("do not make one button both default and cancel") walks into:
  // dropping defaultId leaves NSAlert's own Return on the first button, which is Send.
  assert.equal(macSheetKeys({ buttons: ['Send', 'Cancel'], defaultId: -1, cancelId: 1 }).returnKey, 'Send');
});

test('the drop sheet: no key sends, Escape cancels, nothing is drawn as the default', () => {
  const options = dropSheetOptions({ message: 'Send “a.txt” to your phone?', detail: '~/a.txt' });
  const sheet = macSheetKeys(options);
  assert.notEqual(sheet.returnKey, 'Send', 'Return must never send');
  assert.notEqual(sheet.escapeKey, 'Send', 'Escape must never send');
  assert.equal(sheet.escapeKey, 'Cancel');
  assert.equal(sheet.highlighted, null, 'a highlighted Cancel that Return does not press is a promise the sheet breaks');
  assert.deepEqual([...options.buttons].sort(), ['Cancel', 'Send']);
});

test('only the Send button’s answer confirms a drop, wherever Send sits', () => {
  const options = dropSheetOptions({ message: 'm', detail: 'd' });
  const send = options.buttons.indexOf('Send');
  const cancel = options.buttons.indexOf('Cancel');
  assert.equal(dropSheetConfirmed(send), true);
  assert.equal(dropSheetConfirmed(cancel), false);
  assert.equal(dropSheetConfirmed(options.cancelId), false, 'the Escape answer');
  for (const other of [-1, options.buttons.length]) assert.equal(dropSheetConfirmed(other), false);
});
