import assert from 'node:assert/strict';
import test from 'node:test';

require('./shareReceiveCopy');
const { shareWindowModel, shareWinTypeLabel, shareWinApproxBytes, SHARE_WIN_ICON_NAMES } = require('./shareWindowModel') as {
  shareWindowModel: (o: Record<string, unknown>, phone: string | null) => {
    eyebrow: string; title: string; meta: string; place: { label: string; value: string } | null; detail: string[];
    senderNote: string | null; actions: { id: string; label: string; aria: string; primary: boolean }[];
    glyph: string; tone: string; closesItself: boolean; announcement: string;
  };
  shareWinTypeLabel: (m: string) => string;
  shareWinApproxBytes: (n: number) => string;
  SHARE_WIN_ICON_NAMES: string[];
};
const { ICON_NAMES } = require('../renderer/icons') as { ICON_NAMES: string[] };
const { RECEIVE_STATES } = require('../main/share') as { RECEIVE_STATES: readonly string[] };

const offer = (over: Record<string, unknown> = {}) => ({
  offerId: 's-Q3v9aP0kT7mR2xW8yB4nZc', from: 'Galaxy S25 Ultra', name: 'IMG_2041.jpg', mime: 'image/jpeg',
  bytes: 3874112, folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: 0,
  savedAs: null, reason: null, priorCopy: null, ...over,
});

test('a waiting offer names the paired phone, the file, its type, exact bytes and where it goes — Decline then Accept', () => {
  const m = shareWindowModel(offer(), 'Galaxy S25 Ultra');
  assert.equal(m.eyebrow, 'Galaxy S25 Ultra wants to send a file');
  assert.equal(m.title, 'IMG_2041.jpg');
  assert.equal(m.meta, 'JPEG image · 3.9 MB (3,874,112 bytes)');
  assert.deepEqual(m.place, { label: 'Save to', value: '~/Downloads/Sidekick' });
  assert.deepEqual(m.actions.map((a) => a.id), ['decline', 'accept']);
  assert.equal(m.actions.find((a) => a.primary)?.id, 'accept');
  assert.equal(m.glyph, 'photos');
});

test('the sender is the pairing record, not the offer’s own text; a differing `from` is only a note', () => {
  const m = shareWindowModel(offer({ from: 'Totally Your Bank' }), 'Galaxy S25 Ultra');
  assert.equal(m.eyebrow, 'Galaxy S25 Ultra wants to send a file');
  assert.equal(m.senderNote, 'The phone calls itself “Totally Your Bank”.');
  assert.equal(shareWindowModel(offer(), 'Galaxy S25 Ultra').senderNote, null);
  // No pairing record (cannot happen with a live offer, but the model must not invent one).
  assert.equal(shareWindowModel(offer(), null).eyebrow, 'Galaxy S25 Ultra wants to send a file');
});

test('a closed window is not a decline: while waiting, the close action says Hide and that the request waits', () => {
  // The header's close button uses the model's `close` wording; a waiting offer has no `close` in its
  // footer (Decline is the footer's refusal), so the page asks the model for the header wording.
  const waiting = shareWindowModel(offer(), 'P');
  assert.ok(!waiting.actions.some((a) => a.id === 'close'));
  const done = shareWindowModel(offer({ state: 'declined' }), 'P');
  assert.deepEqual(done.actions.map((a) => a.id), ['close']);
});

test('no preview before Accept: every pre-publication state draws a type glyph by MIME, never the name', () => {
  assert.equal(shareWindowModel(offer({ mime: 'video/mp4', name: 'x.jpg' }), 'P').glyph, 'video');
  assert.equal(shareWindowModel(offer({ mime: 'audio/mpeg' }), 'P').glyph, 'music');
  assert.equal(shareWindowModel(offer({ mime: 'application/pdf', name: 'photo.jpg' }), 'P').glyph, 'doc');
});

test('an unknown type is shown as its MIME string, not guessed from the sender’s file name', () => {
  assert.equal(shareWinTypeLabel('application/x-weird'), 'application/x-weird');
  assert.equal(shareWinTypeLabel('IMAGE/JPEG'), 'JPEG image');
});

test('sizes: exact always; the approximation is decimal and only a reading aid', () => {
  assert.equal(shareWindowModel(offer({ bytes: 0 }), 'P').meta, 'JPEG image · 0 bytes');
  assert.equal(shareWindowModel(offer({ bytes: 1 }), 'P').meta, 'JPEG image · 1 byte');
  assert.equal(shareWinApproxBytes(1_000), '1.0 KB');
  assert.equal(shareWinApproxBytes(250_000_000), '250 MB');
  assert.equal(shareWinApproxBytes(4_300_000_000), '4.3 GB');
});

test('a published file is titled by its saved name and placed "Saved in"; it waits to be closed', () => {
  const m = shareWindowModel(offer({ state: 'saved-unacknowledged', savedAs: 'IMG_2041 (2).jpg' }), 'P');
  assert.equal(m.title, 'IMG_2041 (2).jpg');
  assert.deepEqual(m.place, { label: 'Saved in', value: '~/Downloads/Sidekick' });
  assert.equal(m.eyebrow, 'Saved on this Mac; confirmation to phone unknown');
  assert.equal(m.closesItself, false);
});

test('nothing reads Saved before publication, and receiving offers no action a person could mistake', () => {
  for (const state of ['accepting', 'receiving']) {
    const m = shareWindowModel(offer({ state }), 'P');
    assert.doesNotMatch(`${m.eyebrow} ${m.detail.join(' ')}`, /\bSaved\b/);
    assert.deepEqual(m.actions, []);
    assert.equal(m.closesItself, false);
  }
});

test('a destination refusal says why and names no destination; it never reads Declined', () => {
  const m = shareWindowModel(offer({ state: 'refused', reason: 'insufficient-space', folder: '' }), 'P');
  assert.equal(m.eyebrow, 'Not received');
  assert.equal(m.place, null);
  assert.match(m.detail.join(' '), /not enough free space/);
  assert.doesNotMatch(`${m.eyebrow} ${m.detail.join(' ')}`, /Declined/);
  assert.equal(m.closesItself, true);
});

test('expired and ended are their own words', () => {
  assert.equal(shareWindowModel(offer({ state: 'expired' }), 'P').eyebrow, 'Expired');
  assert.equal(shareWindowModel(offer({ state: 'ended' }), 'P').eyebrow, 'Ended with the connection');
});

test('every receive state has a model (the two lists cannot drift)', () => {
  for (const state of RECEIVE_STATES) {
    const m = shareWindowModel(offer({ state }), 'P');
    assert.ok(m.eyebrow.length > 0, state);
  }
});

test('every glyph the window can draw resolves in icons.ts — and the enumeration covers the model', () => {
  for (const name of SHARE_WIN_ICON_NAMES) assert.ok(ICON_NAMES.includes(name), `no icon named ${name}`);
  for (const mime of ['image/png', 'video/mp4', 'audio/mpeg', 'text/plain']) {
    assert.ok(SHARE_WIN_ICON_NAMES.includes(shareWindowModel(offer({ mime }), 'P').glyph), mime);
  }
});
