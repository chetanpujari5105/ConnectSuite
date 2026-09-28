import assert from 'node:assert/strict';
import test from 'node:test';

require('./shareReceiveCopy');
const { shareWindowModel, shareWinTypeLabel, shareWinApproxBytes, SHARE_WIN_ICON_NAMES } = require('./shareWindowModel') as {
  shareWindowModel: (o: Record<string, unknown>, phone: string | null) => {
    eyebrow: string; title: string; meta: string; place: { label: string; value: string } | null; detail: string[];
    senderNote: string | null; actions: { id: string; label: string; aria: string; primary: boolean }[];
    glyph: string; tone: string; closesItself: boolean; announcement: string;
    progress: { fraction: number | null; label: string; checking: boolean } | null;
  };
  shareWinTypeLabel: (m: string) => string;
  shareWinApproxBytes: (n: number) => string;
  SHARE_WIN_ICON_NAMES: string[];
};
const { shareWindowList } = require('./shareWindowModel') as {
  shareWindowList: (os: Record<string, unknown>[], phone: string | null) => {
    cards: { offerId: string; actions: { id: string; aria: string }[] }[];
    waiting: number;
  };
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

test('nothing reads Saved before publication; a running transfer offers Cancel and nothing else', () => {
  for (const state of ['accepting', 'receiving']) {
    const m = shareWindowModel(offer({ state, receivedBytes: 3874112 }), 'P');
    assert.doesNotMatch(`${m.eyebrow} ${m.detail.join(' ')} ${m.progress?.label}`, /\bSaved\b|100%/);
    assert.deepEqual(m.actions.map((a) => a.id), ['cancel']);
    assert.match(m.actions[0]!.aria, /Nothing will be kept/);
    assert.equal(m.closesItself, false);
  }
});

test('progress is the Mac’s own count: floor percent, never 100%; all bytes in reads as checking', () => {
  const at = (receivedBytes: number | null, bytes = 3874112, state = 'receiving') =>
    shareWindowModel(offer({ state, receivedBytes, bytes }), 'P').progress!;
  assert.deepEqual(at(null, 3874112, 'accepting'), { fraction: null, label: 'Waiting for the phone to start…', checking: false, received: 0, total: 3874112 });
  assert.equal(at(0).label, '0 bytes of 3.9 MB · 0%');
  assert.equal(at(1937056).label, '1.9 MB of 3.9 MB · 50%');
  assert.equal(at(3874111).label, '3.9 MB of 3.9 MB · 99%', 'one byte short is 99, not a rounded 100');
  const done = at(3874112);
  assert.equal(done.checking, true);
  assert.equal(done.label, 'All bytes received — checking before saving…');
  assert.equal(at(99_999_999).fraction, 1, 'a count past the size is clamped, never drawn past full');
  const empty = at(0, 0);
  assert.equal(empty.fraction, null, 'a zero-byte file draws no bar');
  assert.match(empty.label, /empty file/);
  assert.equal(shareWindowModel(offer({ state: 'saved', savedAs: 'a.jpg' }), 'P').progress, null);
});

test('a saved file offers Show in Finder and Open; a failed one inside its window offers Try again', () => {
  const saved = shareWindowModel(offer({ state: 'saved', savedAs: 'IMG (2).jpg' }), 'P');
  assert.deepEqual(saved.actions.map((a) => a.id), ['reveal', 'open']);
  assert.equal(saved.actions.find((a) => a.primary)?.id, 'open');
  assert.equal(saved.actions[1]!.aria, 'Open IMG (2).jpg', 'names the file actually saved');
  const unack = shareWindowModel(offer({ state: 'saved-unacknowledged', savedAs: 'a.jpg' }), 'P');
  assert.deepEqual(unack.actions.map((a) => a.id), ['reveal', 'open'], 'saved on this Mac is saved, whatever the phone heard');
  const retry = shareWindowModel(offer({ state: 'failed', reason: 'checksum', canRetry: true }), 'P');
  assert.deepEqual(retry.actions.map((a) => a.id), ['cancel', 'retry']);
  assert.equal(retry.closesItself, false, 'a retry that is still possible does not vanish');
  const over = shareWindowModel(offer({ state: 'failed', reason: 'checksum', canRetry: false }), 'P');
  assert.deepEqual(over.actions.map((a) => a.id), ['close']);
  assert.ok(!['declined', 'expired', 'cancelled', 'ended', 'refused'].some((state) =>
    shareWindowModel(offer({ state }), 'P').actions.some((a) => a.id === 'open' || a.id === 'reveal')), 'Open only for a published file');
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

test('unexpected-file: Close only — no Open, no Show in Finder, no Try again — and it does not close itself', () => {
  for (const canRetry of [false, true]) {
    const m = shareWindowModel(offer({ state: 'unexpected-file', reason: 'write-failed', unexpectedName: 'IMG_2041 (2).jpg', canRetry }), 'P');
    assert.deepEqual(m.actions.map((a) => a.id), ['close'], `canRetry=${canRetry}`);
    assert.equal(m.closesItself, false);
    assert.deepEqual(m.place, { label: 'Folder', value: '~/Downloads/Sidekick' });
    assert.equal(m.eyebrow, 'Not saved — a different file appeared');
    assert.ok(m.detail[0]!.includes('“IMG_2041 (2).jpg” in ~/Downloads/Sidekick.'), m.detail[0]);
  }
});

// ---- Version 3 foundation (PROPOSED, not wired): one window listing every pending offer ------------

test('v3 foundation: the window lists every pending offer, in arrival order, each with its own Accept and Decline', () => {
  const a = offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', name: 'first.png' });
  const saved = offer({ offerId: 's-SSSSSSSSSSSSSSSSSSSSSS', name: 'done.png', state: 'saved', savedAs: 'done.png' });
  const b = offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', name: 'second.png' });
  const retry = offer({ offerId: 's-RRRRRRRRRRRRRRRRRRRRRR', name: 'retry.png', state: 'failed', reason: 'checksum', canRetry: true });
  const declined = offer({ offerId: 's-DDDDDDDDDDDDDDDDDDDDDD', name: 'no.png', state: 'declined' });
  const list = shareWindowList([a, saved, b, retry, declined], 'Galaxy S25 Ultra');
  assert.deepEqual(list.cards.map((c) => c.offerId), [a.offerId, b.offerId, retry.offerId], 'pending only, arrival order kept');
  assert.equal(list.waiting, 2);
  for (const [card, name] of [[list.cards[0]!, 'first.png'], [list.cards[1]!, 'second.png']] as const) {
    assert.deepEqual(card.actions.map((x) => x.id), ['decline', 'accept'], name);
    assert.ok(card.actions.find((x) => x.id === 'accept')!.aria.includes(name), 'each Accept names its own file');
  }
  assert.deepEqual(list.cards[2]!.actions.map((x) => x.id), ['cancel', 'retry']);
});

test('v3 foundation: no pending offer is an empty list, not a card', () => {
  const list = shareWindowList([offer({ state: 'saved', savedAs: 'x.png' }), offer({ state: 'expired' })], 'P');
  assert.deepEqual(list.cards, []);
  assert.equal(list.waiting, 0);
});

// ---- v3: queue copy, labels that tell identical names apart, and actions bound to offer ids ---------

test('v3: two offers with the same name get different labels, and every action carries its own offer id', () => {
  const t0 = new Date(2026, 8, 25, 14, 7, 9).getTime();
  const a = offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', name: 'IMG_1.jpg', queueMode: true, arrivalSeq: 3, arrivedAtMs: t0 });
  const b = offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', name: 'IMG_1.jpg', queueMode: true, arrivalSeq: 4, arrivedAtMs: t0 + 2000 });
  const list = shareWindowList([a, b], 'P');
  const labels = list.cards.map((c) => c.actions.find((x) => x.id === 'accept')!.aria);
  assert.notEqual(labels[0], labels[1]);
  assert.ok(labels[0]!.includes('IMG_1.jpg (file 3, arrived 14:07:09)'), labels[0]);
  assert.ok(labels[1]!.includes('IMG_1.jpg (file 4, arrived 14:07:11)'), labels[1]);
  for (const card of list.cards) {
    for (const act of card.actions) assert.equal((act as { offerId?: string }).offerId, card.offerId, `${act.id} on ${card.offerId}`);
  }
});

test('v3: a queued card is visible, cancellable by its own id, never closes itself, and says it is not saved', () => {
  const q = offer({ state: 'queued', queueMode: true, filesAhead: 2, arrivalSeq: 5, arrivedAtMs: 0 });
  const m = shareWindowModel(q, 'P') as ReturnType<typeof shareWindowModel> & { actions: { id: string; offerId: string; aria: string }[]; closesItself: boolean; detail: string[] };
  assert.deepEqual(m.actions.map((x) => x.id), ['cancel']);
  assert.equal(m.actions[0]!.offerId, q.offerId);
  assert.match(m.actions[0]!.aria, /has not started/);
  assert.equal(m.closesItself, false);
  assert.equal(m.detail[0], '2 transfers are ahead of it.');
  assert.deepEqual(shareWindowList([q], 'P').cards.map((c) => c.offerId), [q.offerId], 'listed as pending');
});

test('v2 labels are unchanged: no arrival number or clock without version 3', () => {
  const m = shareWindowModel(offer({ arrivalSeq: 3, arrivedAtMs: 0 }), 'Galaxy S25 Ultra');
  assert.equal(m.actions.find((x) => x.id === 'accept')!.aria, 'Accept IMG_2041.jpg from Galaxy S25 Ultra and save it to ~/Downloads/Sidekick');
});

// ---- v3: which cards the one window draws -------------------------------------------------------------

const { shareQueueCards, shareQueueMode } = require('./shareWindowModel') as {
  shareQueueCards: (os: Record<string, unknown>[], phone: string | null, shown: Set<string>, dismissed: Set<string>) => { offerId: string }[];
  shareQueueMode: (os: Record<string, unknown>[]) => boolean;
};

test('v3: the list mode is decided by the offers, and a version-2 run never enters it', () => {
  assert.equal(shareQueueMode([offer({}), offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB' })]), false);
  assert.equal(shareQueueMode([offer({}), offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', queueMode: true })]), true);
  assert.equal(shareQueueMode([]), false);
});

test('v3: cards are pending or shown, never dismissed, in arrival order', () => {
  const a = offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', queueMode: true, arrivalSeq: 1 });
  const b = offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', queueMode: true, arrivalSeq: 2, state: 'saved', savedAs: 'x.png' });
  const c = offer({ offerId: 's-CCCCCCCCCCCCCCCCCCCCCC', queueMode: true, arrivalSeq: 3, state: 'queued', filesAhead: 1 });
  const ids = (shown: string[], dismissed: string[]) => shareQueueCards([c, b, a], 'P', new Set(shown), new Set(dismissed)).map((m) => m.offerId);
  assert.deepEqual(ids([], []), [a.offerId, c.offerId], 'a finished card nobody showed is not replayed');
  assert.deepEqual(ids([b.offerId], []), [a.offerId, b.offerId, c.offerId]);
  assert.deepEqual(ids([b.offerId], [a.offerId]), [b.offerId, c.offerId], 'dismissed stays gone, even while pending');
});

const { shareWinWantedHeight } = require('./shareWindowModel') as {
  shareWinWantedHeight: (root: number, active: boolean, client: number, scroll: number) => number;
};
type QueueCard = { offerId: string; title: string; label: string; arrivalNote: string | null };
const queueCards = (os: Record<string, unknown>[], shown: string[] = [], dismissed: string[] = []) =>
  (shareQueueCards(os, 'P', new Set(shown), new Set(dismissed)) as unknown as QueueCard[]);

test('v3: a card’s own accessible name says which file — arrival number and clock — not only the name', () => {
  const t0 = new Date(2026, 8, 26, 14, 7, 9).getTime();
  const [a, b] = queueCards([
    offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', queueMode: true, arrivalSeq: 1, arrivedAtMs: t0 }),
    offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', queueMode: true, arrivalSeq: 2, arrivedAtMs: t0 + 2000 }),
  ]);
  assert.equal(a!.label, 'IMG_2041.jpg (file 1, arrived 14:07:09)');
  assert.equal(b!.label, 'IMG_2041.jpg (file 2, arrived 14:07:11)');
  assert.equal(a!.title, 'IMG_2041.jpg', 'the heading is still the plain name');
});

test('v2: the label is the title, exactly as before — no arrival number or clock', () => {
  const m = shareWindowModel(offer({ arrivalSeq: 1, arrivedAtMs: 0 }), 'P') as unknown as QueueCard;
  assert.equal(m.label, 'IMG_2041.jpg');
  assert.equal(m.arrivalNote, null);
  const saved = shareWindowModel(offer({ state: 'saved', savedAs: 'IMG_2041 (2).jpg' }), 'P') as unknown as QueueCard;
  assert.equal(saved.label, 'IMG_2041 (2).jpg', 'a v2 label follows the title, which is the saved name');
});

test('v3: the arrival note is drawn only on cards whose name repeats on the list', () => {
  const t0 = new Date(2026, 8, 26, 14, 7, 9).getTime();
  const cards = queueCards([
    offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', queueMode: true, arrivalSeq: 1, arrivedAtMs: t0 }),
    offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', queueMode: true, arrivalSeq: 2, arrivedAtMs: t0 + 1000, name: 'notes.txt', mime: 'text/plain' }),
    offer({ offerId: 's-CCCCCCCCCCCCCCCCCCCCCC', queueMode: true, arrivalSeq: 3, arrivedAtMs: t0 + 2000 }),
  ]);
  const note = (id: string) => cards.find((c) => c.offerId === id)!.arrivalNote;
  assert.equal(note('s-AAAAAAAAAAAAAAAAAAAAAA'), 'File 1 · arrived 14:07:09');
  assert.equal(note('s-CCCCCCCCCCCCCCCCCCCCCC'), 'File 3 · arrived 14:07:11');
  assert.equal(note('s-BBBBBBBBBBBBBBBBBBBBBB'), null, 'control: a name that appears once gets no note');
});

test('v3: a repeat counts only while both cards are on the list — a dismissed twin leaves no note behind', () => {
  const a = offer({ offerId: 's-AAAAAAAAAAAAAAAAAAAAAA', queueMode: true, arrivalSeq: 1, arrivedAtMs: 0 });
  const b = offer({ offerId: 's-BBBBBBBBBBBBBBBBBBBBBB', queueMode: true, arrivalSeq: 2, arrivedAtMs: 0 });
  assert.notEqual(queueCards([a, b]).find((c) => c.offerId === b.offerId)!.arrivalNote, null, 'control: both listed → noted');
  const alone = queueCards([a, b], [], [a.offerId as string]);
  assert.deepEqual(alone.map((c) => c.offerId), [b.offerId]);
  assert.equal(alone[0]!.arrivalNote, null);
});

test('the height the page asks for: drawn height at v2; drawn height plus the list’s hidden overflow at v3', () => {
  assert.equal(shareWinWantedHeight(401.2, false, 0, 0), 402, 'v2: the drawn height, rounded up, as before');
  assert.equal(shareWinWantedHeight(401.2, false, 345, 900), 402, 'v2 ignores the list even if it has sizes');
  assert.equal(shareWinWantedHeight(560, true, 504, 1841), 1897, 'v3 capped: asks for the uncapped height');
  assert.equal(shareWinWantedHeight(401, true, 345, 345), 401, 'v3 uncapped: nothing hidden, nothing added');
  assert.equal(shareWinWantedHeight(120, true, 64, 1841), 1897, 'from the 120 px starting window it still asks for everything');
});

test('v3: every action on every card names its own file — including a finished card’s Close', () => {
  // A fact about each action, not a likeness between two: the screen reader's button list shows actions
  // out of their cards, so an action that does not say which file it is about is ambiguous on its own.
  const t0 = new Date(2026, 8, 26, 14, 7, 9).getTime();
  let checked = 0;
  for (const state of RECEIVE_STATES) {
    for (const canRetry of [false, true]) {
      const o = offer({ state, canRetry, queueMode: true, arrivalSeq: 3, arrivedAtMs: t0, savedAs: state.startsWith('saved') ? 'IMG_2041 (2).jpg' : null, filesAhead: 1 });
      const ident = 'IMG_2041.jpg (file 3, arrived 14:07:09)';
      for (const a of shareWindowModel(o, 'Galaxy S25 Ultra').actions) {
        const names = a.aria.includes(ident) || (state.startsWith('saved') && a.aria.includes('IMG_2041 (2).jpg'));
        assert.ok(names, `${state}${canRetry ? ' (Retry open)' : ''}: ${a.id} is “${a.aria}”`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 20, `control: actions were checked (${checked})`);
});

test('v2: a finished card’s Close keeps its wording exactly', () => {
  assert.equal(shareWindowModel(offer({ state: 'declined', reason: 'user' }), 'P').actions.find((a) => a.id === 'close')!.aria, 'Close — Declined');
});
