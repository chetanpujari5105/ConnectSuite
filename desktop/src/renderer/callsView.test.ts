import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
// The two globals the page provides by loading these as plain scripts *before* calls.js. Under
// `node --test` nothing loads them, so the pane would throw on its first `iconSvg` — which is what
// happened, and is the export/CommonJS trap this repo already records: a green suite exercising a
// loader the renderer never uses. Imported in the page's own order, for the same reason.
import './icons';
import './stateBlock';
import '../shared/contactPhotos';
import '../shared/appCall';
import '../shared/callAudio';
import '../shared/returnRefresh';
// Side-effecting import, safe because `calls.ts` touches no DOM at module scope — it only hangs
// the view class and the pure label rules on `globalThis`.
import './calls';

/**
 * The Calls pane's **view class**, driven for real.
 *
 * `calls.test.ts` covers the pure label rules. This file covers the half that draws, which is the
 * half three renderer-only defects have shipped from with a green suite — and it is what takes
 * `CallsView` off `check-renderer-views.mjs`'s debt list, where its reason read *"the drawing half
 * is not [tested]"*.
 *
 * **What is asserted here is mostly what is _absent_**, and that is deliberate. The pane's whole
 * departure from the handoff is four controls it refuses to draw — a waveform over silence, Mute,
 * Speaker, and an in-call keypad — and an absence is only evidence when the query that reports it
 * has been shown to find something. Every absence assertion below therefore names a control that
 * *is* found in the same tree, in the same call.
 */

type Call = {
  callId: string;
  number: string;
  contactName?: string;
  startedAtMs: number;
  state: 'ringing' | 'active' | 'dialing';
};
type LogRow = {
  id: string;
  number: string;
  contactName?: string;
  type: string;
  dateMs: number;
  durationMs: number;
};

class FakeBridge {
  log: LogRow[] = [];
  hasMore = false;
  current: Call | null = null;
  contacts: { id: string; displayName: string; numbers: { value: string; label: string }[] }[] = [];
  contactQueries: string[] = [];
  readonly calls: string[] = [];
  private changed: ((call: Call | null) => void) | null = null;

  async callCurrent() {
    return this.current;
  }
  /** When set, `call.log` is refused with this sentence — a revoked call-log grant, a busy phone. */
  logRefusal: string | null = null;
  async callLog() {
    this.calls.push('callLog');
    if (this.logRefusal) return { ok: false as const, reason: this.logRefusal, fixHint: 'Synthetic hint.' };
    return { ok: true as const, data: { calls: this.log, hasMore: this.hasMore } };
  }
  async callAnswer() {
    this.calls.push('callAnswer');
    return { ok: true };
  }
  async callReject() {
    this.calls.push('callReject');
    return { ok: true };
  }
  async callDial(number: string) {
    this.calls.push(`callDial:${number}`);
    return { ok: true };
  }
  onCallChanged(cb: (call: Call | null) => void) {
    this.changed = cb;
  }
  async contactsList(options: { query?: string }) {
    this.contactQueries.push(options.query ?? '');
    return { ok: true as const, data: { contacts: this.contacts, hasMore: false } };
  }

  /** number → base64 the phone would return. A number that is absent here has no photograph. */
  photos: Record<string, string> = {};
  /** Every number `contacts.get` was called with, in order. The denominator for the skip rule. */
  readonly photoAsks: string[] = [];
  /** When true `contacts.get` refuses, which is what a revoked contacts grant looks like. */
  photosRefuse = false;

  /** The live notification list the naming rule reads. Empty unless a test puts a call in it. */
  notifs: {
    package: string;
    appName?: string;
    title?: string;
    category?: string;
    ongoing: boolean;
  }[] = [];
  notifListCalls = 0;
  /** When true `notifList` rejects, which is what an ungranted notification listener looks like. */
  notifsUnavailable = false;
  private notifChanged: ((list: unknown[]) => void) | null = null;

  async notifList() {
    this.notifListCalls += 1;
    if (this.notifsUnavailable) throw new Error('notifications are not shared');
    return this.notifs;
  }
  onNotifChanged(cb: (list: unknown[]) => void) {
    this.notifChanged = cb;
  }
  fireNotifs(list: typeof this.notifs): void {
    this.notifs = list;
    this.notifChanged?.(list);
  }

  async contactsGet(options: { number?: string; withPhoto?: boolean }) {
    this.photoAsks.push(options.number ?? '');
    if (this.photosRefuse) {
      return { ok: false as const, reason: 'This phone is not sharing its contacts.' };
    }
    const photo = this.photos[options.number ?? ''];
    return { ok: true as const, data: photo ? { photo } : {} };
  }

  fireCall(call: Call | null): void {
    this.changed?.(call);
  }
}

installFakeDocument();
const fakeWindow = installFakeWindow();

interface Pane {
  bridge: FakeBridge;
  /** The view itself. `renderer.ts` calls `setAdvertised` on every status change; so can a test. */
  view: { setAdvertised(on: boolean): void };
  card: FakeElement;
  note: FakeElement;
  live: FakeElement;
  body: FakeElement;
  input: FakeElement;
  dialButton: FakeElement;
  notice: FakeElement;
  tabs: FakeElement;
  keypad: FakeElement;
  frequent: FakeElement;
}

function mount(log: LogRow[] = [], current: Call | null = null, logRefusal: string | null = null): Pane {
  const bridge = new FakeBridge();
  bridge.log = log;
  bridge.logRefusal = logRefusal;
  bridge.current = current;
  const parts = {
    card: el('div'),
    note: el('p'),
    live: el('div'),
    body: el('div'),
    input: el('input'),
    dialButton: el('button'),
    notice: el('div'),
    tabs: el('div'),
    keypad: el('div'),
    frequent: el('div'),
  };
  const View = (globalThis as Record<string, unknown>).CallsView as new (
    ...args: unknown[]
  ) => { setAdvertised(on: boolean): void };
  const view = new View(
    parts.card,
    parts.note,
    parts.live,
    parts.body,
    parts.input,
    parts.dialButton,
    parts.notice,
    parts.tabs,
    parts.keypad,
    parts.frequent,
    bridge,
  );
  // How the real app drives it: `renderer.ts` calls this the moment the phone advertises `calls`.
  // Constructing without it would test a pane in a state the app never puts it in.
  view.setAdvertised(true);
  return { bridge, view, ...parts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function row(id: string, over: Partial<LogRow> = {}): LogRow {
  return {
    id,
    number: '+911234500000',
    type: 'incoming',
    dateMs: Date.UTC(2026, 8, 3, 9, 0),
    durationMs: 60_000,
    ...over,
  };
}

// ---- The four refusals -------------------------------------------------------------------------

test('the live card draws no waveform, no Mute, no Speaker and no in-call keypad', async () => {
  const pane = mount([], {
    callId: 'c1',
    number: '+911234500000',
    contactName: 'R. Sharma',
    startedAtMs: Date.now() - 138_000,
    state: 'active',
  });
  pane.bridge.fireCall(pane.bridge.current);
  await settle();

  // **The control comes first.** The absences below mean nothing unless this tree is populated and
  // the query can see a button in it — an empty card would satisfy every assertion that follows.
  const buttons = pane.live.queryAll('button').map((b) => b.textContent);
  assert.deepEqual(buttons, ['Hang up'], 'control: the card draws exactly the one control it has a verb for');
  assert.match(pane.live.textContent, /R\. Sharma/, 'control: the card is drawn and carries the caller');

  // **Controls, never words** — and this assertion was written the wrong way round first, which is
  // why it is worth a paragraph. It searched `pane.live.textContent` for `'Mute'` and went red, over
  // a pane that draws no Mute button: the match was the card's own sentence saying *"Mute, speaker
  // and keypad tones are on the phone"*. That is `CLAUDE.md`'s "searching for a forbidden thing
  // finds the sentence forbidding it", for the seventh time, inside the test written to prove the
  // refusal. It went red rather than green only by luck of direction — the same search over a
  // *presence* question would have passed on the explanation and reported a control that is not
  // there. So the query counts elements a person could press.
  const pressable = pane.live.queryAll('button').map((b) => b.textContent.trim());
  for (const forbidden of ['Mute', 'Speaker', 'Keypad']) {
    assert.ok(
      !pressable.some((label) => label.includes(forbidden)),
      `the card drew a "${forbidden}" control, which nothing on the wire can back`,
    );
  }
  // The waveform is 40 sibling spans in the handoff, and the badge is a lock glyph beside a label.
  // Both are counted as elements rather than searched for as words, because neither has text a
  // search could honestly find — an absence a query could never have detected is not a reading.
  assert.equal(pane.live.queryAll('.wave-bar').length, 0, 'no waveform bars');
  assert.equal(pane.live.queryAll('.call-encrypted').length, 0, 'no encryption badge on a cellular call');
});

test('the running clock is a measurement, and it ticks on an interval rather than being a label', async () => {
  const startedAtMs = Date.now() - 138_000; // 00:02:18, the handoff's own figure
  const pane = mount([], { callId: 'c1', number: '+91', startedAtMs, state: 'active' });
  pane.bridge.fireCall(pane.bridge.current);
  await settle();

  const clock = pane.live.queryAll('div').find((d) => d.className.includes('call-clock'));
  assert.ok(clock, 'control: the clock element exists');
  assert.match(clock.textContent, /^00:02:1[78]$/);
  assert.ok(
    fakeWindow.timers.some((t) => t.kind === 'interval' && t.delay === 1000),
    'a clock that does not tick is a label wearing a clock’s formatting',
  );
});

test('with no call the pane draws the state the design does not have, and no dead controls', async () => {
  const pane = mount([]);
  await settle();
  assert.match(pane.live.textContent, /No call in progress/);
  // The empty state offers nothing to press: an Answer button over no call is the "check that does
  // not gate" shape, one layer up in the UI.
  assert.equal(pane.live.queryAll('button').length, 0);
  assert.ok(pane.live.classList.contains('is-idle'));
});

// ---- The tab strip -----------------------------------------------------------------------------

test('the Missed count is withheld until the log has actually been read', async () => {
  const pane = mount([row('a', { type: 'missed' }), row('b')]);
  // Before `loadLog` resolves the strip is drawn from an empty log. A `Missed 0` there is a reading
  // taken of nothing, and it is the one number on this screen somebody would act on.
  const beforeRead = pane.tabs.queryAll('button').map((b) => b.textContent);
  assert.deepEqual(beforeRead, ['All', 'Missed', 'Contacts']);

  await settle();
  const afterRead = pane.tabs.queryAll('button').map((b) => b.textContent);
  assert.deepEqual(afterRead, ['All', 'Missed 1', 'Contacts']);
});

test('Missed filters the log, and an empty filter result is not an empty log', async () => {
  const pane = mount([row('a'), row('b')]);
  await settle();
  assert.equal(pane.body.queryAll('.call-row').length, 2, 'control: All shows both');

  const missedTab = pane.tabs.queryAll('button')[1];
  missedTab.click();
  assert.equal(pane.body.queryAll('.call-row').length, 0);
  // A3/A4's distinction one pane over: nothing *matching* names the filter and the denominator;
  // nothing *recorded* does not. Collapsing them is how a working filter reads as a broken feature.
  assert.match(pane.note.textContent, /No missed calls in the 2/);

  const empty = mount([]);
  await settle();
  assert.match(empty.note.textContent, /no calls in the phone’s log/i);
});

test('the Contacts tab asks the phone rather than filtering the log here', async () => {
  const pane = mount([row('a', { contactName: 'R. Sharma' })]);
  pane.bridge.contacts = [
    { id: '1', displayName: 'P. Mehta', numbers: [{ value: '+919800000002', label: 'Mobile' }] },
  ];
  await settle();

  pane.tabs.queryAll('button')[2].click();
  await settle();

  assert.deepEqual(pane.bridge.contactQueries, [''], 'the phone does the matching, not this pane');
  assert.match(pane.body.textContent, /P\. Mehta/);
  assert.ok(
    !pane.body.textContent.includes('R. Sharma'),
    'the Contacts tab is a different source, not a filter over the log',
  );
});

test('a contact with no number is drawn and says so rather than being dropped', async () => {
  const pane = mount([]);
  pane.bridge.contacts = [{ id: '1', displayName: 'Office', numbers: [] }];
  await settle();
  pane.tabs.queryAll('button')[2].click();
  await settle();

  assert.match(pane.body.textContent, /No number on this contact/);
  // "Not in the list" and "in the list with nothing to dial" are different facts about a person.
  // The row is the control, so the second fact is carried by `disabled` rather than by absence.
  const rows = pane.body.queryAll('.call-row');
  assert.equal(rows.length, 1, 'control: the row is drawn at all');
  assert.equal(rows[0].disabled, true);
});

// ---- The dialler -------------------------------------------------------------------------------

test('the keypad types into the field and never dials', async () => {
  const pane = mount([]);
  await settle();
  const keys = pane.keypad.queryAll('button');
  assert.equal(keys.length, 13, 'twelve keys as drawn, plus the delete the design does not have');

  for (const digit of ['9', '8', '0']) {
    const key = keys.find((k) => k.queryAll('.dialkey-digit')[0]?.textContent === digit);
    assert.ok(key, `control: the ${digit} key exists`);
    key.click();
  }
  assert.equal(pane.input.value, '980');
  assert.deepEqual(
    pane.bridge.calls.filter((c) => c.startsWith('callDial')),
    [],
    'a keypad that dialled on the last key would place a call from a mistyped digit',
  );
});

test('delete removes one digit and withdraws an armed confirmation', async () => {
  const pane = mount([]);
  await settle();
  pane.input.value = '+9198';
  pane.dialButton.click();
  await settle();
  assert.match(pane.dialButton.textContent, /^Confirm/, 'control: the first click arms');

  pane.keypad.queryAll('.dialkey-back')[0].click();
  assert.equal(pane.input.value, '+919');
  assert.equal(pane.dialButton.textContent, 'Call', 'a confirmation that survives an edit calls a number nobody confirmed');
});

test('dialling takes two clicks and the second one names the number', async () => {
  const pane = mount([]);
  await settle();
  pane.input.value = '+919800000001';

  pane.dialButton.click();
  await settle();
  assert.deepEqual(pane.bridge.calls.filter((c) => c.startsWith('callDial')), []);
  assert.match(pane.dialButton.textContent, /Confirm — call \+919800000001/);

  pane.dialButton.click();
  await settle();
  assert.deepEqual(pane.bridge.calls.filter((c) => c.startsWith('callDial')), ['callDial:+919800000001']);
});

test('Frequently called counts the log, and withholds the list until the log is read', async () => {
  const pane = mount([
    row('a', { number: '+911111111111', contactName: 'Mom' }),
    row('b', { number: '+911111111111', contactName: 'Mom' }),
    row('c', { number: '+912222222222' }),
  ]);
  // Before the read: an empty list would mean "nothing read yet" and "nobody called twice" at once.
  assert.match(pane.frequent.textContent, /once it arrives/);

  await settle();
  const rows = pane.frequent.queryAll('.calls-frequent-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Mom/);
  // The count is the denominator for the word "frequently" — a list of names without it is a claim
  // with its basis removed.
  assert.match(rows[0].textContent, /2 calls/);
  assert.match(rows[1].textContent, /1 call\b/);

  rows[1].click();
  assert.equal(pane.input.value, '+912222222222');
  assert.equal(pane.input.focusCount, 1);
});

test('clicking a log row fills the dialler rather than placing the call', async () => {
  const pane = mount([row('a', { number: '+913333333333' })]);
  await settle();
  pane.body.queryAll('.call-row')[0].click();
  assert.equal(pane.input.value, '+913333333333');
  assert.deepEqual(pane.bridge.calls.filter((c) => c.startsWith('callDial')), []);
});

// ---- Answer / reject ---------------------------------------------------------------------------

test('a ringing call offers Answer on phone; an active one offers only Hang up', async () => {
  const ringing: Call = { callId: 'c1', number: '+91', startedAtMs: Date.now(), state: 'ringing' };
  // Set on the bridge as well as fired, because `setAdvertised` asks `callCurrent()` on mount and
  // its reply lands after the event. A test that only fired the event was measuring its own race
  // and would have gone green on any pane that ignored the event entirely.
  const pane = mount([], ringing);
  pane.bridge.fireCall(ringing);
  await settle();
  assert.deepEqual(pane.live.queryAll('button').map((b) => b.textContent), ['Answer on phone', 'Reject']);
  // The label says *where* it answers. A bare "Answer" is a promise this Mac cannot keep — there is
  // no audio path in either direction and there never will be.
  assert.match(pane.live.queryAll('button')[0].title, /no audio/i);

  const active: Call = { callId: 'c1', number: '+91', startedAtMs: Date.now(), state: 'active' };
  pane.bridge.current = active;
  pane.bridge.fireCall(active);
  await settle();
  assert.deepEqual(pane.live.queryAll('button').map((b) => b.textContent), ['Hang up']);
});

// ---- Contact photographs -------------------------------------------------------------------

/**
 * The photograph is drawn **over** a disc that was already correct, and both halves are asserted.
 *
 * The second assertion is the one that matters and it is the easy one to leave out: the initials
 * and the hue are still there underneath. That is the entire fallback story — a fetch that fails,
 * is refused, or never returns leaves the disc this pane has always drawn — and a version that
 * emptied the disc before painting would pass the first assertion and ship a hole.
 */
test('a log row with a contact draws that contact photograph over its initials', async () => {
  const pane = mount([row('1', { contactName: 'Ada Lovelace', number: '+911234500001' })]);
  pane.bridge.photos['+911234500001'] = 'QUFB';
  await settle();
  await settle();

  const discs = pane.body.queryAll('.call-disc');
  assert.equal(discs.length, 1, 'control: one row, one disc — the query finds the thing');
  const disc = discs[0]!;

  assert.equal(disc.style.backgroundImage, 'url("data:image/png;base64,QUFB")');
  assert.ok(disc.classList.contains('has-photo'), 'the stylesheet is told to reveal it');
  assert.equal(disc.textContent, 'AL', 'the initials are still underneath, not thrown away');
  assert.equal(disc.style['--disc-hue'], undefined, 'no per-person hue — the Sidekick system has none (D2)');
});

/**
 * The inference `photoWorthAsking` makes, asserted as a **request count** rather than as a picture.
 *
 * A row the phone could not name has no contact behind it, so it cannot have a photograph, so it
 * is not worth a round trip. Asserting the absence of a photo would pass for the wrong reason —
 * there is no photo for that number in the fake either. The number of requests is the only thing
 * that separates "did not draw one" from "did not ask".
 */
test('a row the phone could not name is not asked about at all', async () => {
  const pane = mount([
    row('1', { contactName: 'Ada Lovelace', number: '+911234500001' }),
    row('2', { number: '+911234500002' }),
  ]);
  await settle();
  await settle();

  assert.deepEqual(
    pane.bridge.photoAsks,
    ['+911234500001'],
    'the named row is asked about — control — and the unnamed one is not',
  );
});

test('the same person on the card and in the log costs one request, not two', async () => {
  const call: Call = {
    callId: 'c1',
    number: '+911234500001',
    contactName: 'Ada Lovelace',
    startedAtMs: Date.now(),
    state: 'ringing',
  };
  const pane = mount([row('1', { contactName: 'Ada Lovelace', number: '+911234500001' })], call);
  pane.bridge.photos['+911234500001'] = 'QUFB';
  pane.bridge.fireCall(call);
  await settle();
  await settle();

  assert.deepEqual(pane.bridge.photoAsks, ['+911234500001'], 'the second draw joined the first run');
  const live = pane.live.queryAll('.call-disc');
  assert.equal(live.length, 1, 'control: the live card has a disc');
  assert.equal(live[0]!.style.backgroundImage, 'url("data:image/png;base64,QUFB")');
});

/**
 * A refusal is a disc, not a hole and not a banner.
 *
 * `contacts.get` refuses outright when the contacts grant is off, which is a state a user can be
 * in for a perfectly good reason while still wanting their call log.
 */
test('a refused photograph leaves the disc exactly as it was', async () => {
  const pane = mount([row('1', { contactName: 'Ada Lovelace', number: '+911234500001' })]);
  pane.bridge.photosRefuse = true;
  await settle();
  await settle();

  const disc = pane.body.queryAll('.call-disc')[0]!;
  assert.equal(disc.textContent, 'AL');
  assert.ok(!disc.classList.contains('has-photo'));
  assert.equal(disc.style.backgroundImage, undefined, 'nothing was painted');
  assert.equal(pane.notice.textContent, '', 'and no banner: the row is readable without a face');
});

/**
 * The one place a value off the wire reaches a stylesheet, checked at the boundary.
 *
 * The phone writes a base64 PNG and nothing else does, but `url("…")` is a CSS context and a
 * string that closed the quote would be a declaration this app did not write.
 */
test('a photo field that is not base64 is not painted', async () => {
  const pane = mount([row('1', { contactName: 'Ada Lovelace', number: '+911234500001' })]);
  pane.bridge.photos['+911234500001'] = 'AAA"); background-image: url("http://evil/';
  await settle();
  await settle();

  const disc = pane.body.queryAll('.call-disc')[0]!;
  assert.equal(disc.style.backgroundImage, undefined);
  assert.equal(disc.textContent, 'AL', 'and it degrades to the disc, like every other refusal');
});

test('the photographs are dropped when the phone stops advertising calls', async () => {
  const pane = mount([row('1', { contactName: 'Ada Lovelace', number: '+911234500001' })]);
  pane.bridge.photos['+911234500001'] = 'QUFB';
  await settle();
  await settle();
  assert.deepEqual(pane.bridge.photoAsks, ['+911234500001'], 'control: it was asked once');

  // The link dropped and came back, which is exactly what `renderer.ts` drives on a status change.
  pane.bridge.photoAsks.length = 0;
  pane.view.setAdvertised(false);
  pane.view.setAdvertised(true);
  await settle();
  await settle();

  assert.deepEqual(
    pane.bridge.photoAsks,
    ['+911234500001'],
    'the face was re-fetched rather than served from a cache the link had invalidated',
  );
});

// ---- Naming a call the phone network is not hosting ------------------------------------------

const whatsappCall = {
  package: 'com.whatsapp',
  appName: 'WhatsApp',
  title: 'Sahil Chaudhary',
  category: 'call',
  ongoing: true,
};

const appCall: Call = {
  callId: 'c1',
  number: '',
  startedAtMs: Date.now() - 4_000,
  state: 'ringing',
};

test('a call with no number is named from the app notification, headline and status line', async () => {
  // `current` as well as `fireCall`: `setAdvertised(true)` kicks off `refreshCurrent()`, which
  // resolves after this line and would otherwise put the card back to idle.
  const pane = mount([], appCall);
  pane.bridge.notifs = [whatsappCall];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  const who = pane.live.queryAll('.call-who')[0]!;
  const state = pane.live.queryAll('.call-state')[0]!;
  assert.equal(who.textContent, 'Sahil Chaudhary', 'not "Unknown number"');
  assert.equal(state.textContent, 'Ringing · WhatsApp');
});

/**
 * The note is asserted **and** the controls are asserted unchanged, in the same test.
 *
 * The second half is the point: this feature adds a name and touches nothing else. A version that
 * hid Answer or Reject for an app call would pass every assertion about the note.
 */
test('the app-call note is drawn, and the two controls are exactly as they were', async () => {
  // `current` as well as `fireCall`: `setAdvertised(true)` kicks off `refreshCurrent()`, which
  // resolves after this line and would otherwise put the card back to idle.
  const pane = mount([], appCall);
  pane.bridge.notifs = [whatsappCall];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  const hosted = pane.live.queryAll('[data-app-call]');
  assert.equal(hosted.length, 1, 'control: the strip is found');
  assert.match(hosted[0]!.textContent, /WhatsApp is hosting this call/);
  assert.match(hosted[0]!.textContent, /not measured/);

  const buttons = pane.live.queryAll('button').map((b) => b.textContent);
  assert.deepEqual(
    buttons,
    ['Answer on phone', 'Reject'],
    'naming a call must not add, remove or relabel a control',
  );
});

test('an ordinary call with a number is untouched, note and all', async () => {
  const ordinary: Call = { ...appCall, number: '+919604375820', contactName: 'Ada Lovelace' };
  const pane = mount([], ordinary);
  pane.bridge.notifs = [whatsappCall];
  pane.bridge.fireCall(ordinary);
  await settle();
  await settle();

  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Ada Lovelace');
  assert.equal(pane.live.queryAll('.call-state')[0]!.textContent, 'Ringing · +919604375820');
  assert.equal(pane.live.queryAll('[data-app-call]').length, 0, 'no hosted strip');
  // Control: the same tree does carry the other two strips, so the absence above is a reading.
  assert.equal(pane.live.queryAll('.call-audio-note').length, 2);
});

/**
 * The second trigger, and the reason it exists: the notification is routinely posted a beat after
 * the call state changes. A card drawn only on `onCallChanged` says `Unknown number` and stays.
 */
test('a notification arriving after the call names the card without a second call event', async () => {
  const pane = mount([], appCall);
  pane.bridge.notifs = [];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();
  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Unknown number', 'before');

  pane.bridge.fireNotifs([whatsappCall]);
  await settle();
  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Sahil Chaudhary', 'after');
});

test('the phone own dialer notification does not rename a withheld-number call', async () => {
  const pane = mount([], appCall);
  pane.bridge.notifs = [
    { package: 'com.samsung.android.incallui', appName: 'Phone', category: 'call', ongoing: true },
  ];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Unknown number');
  assert.equal(pane.live.queryAll('[data-app-call]').length, 0);
});

test('a phone not sharing notifications leaves the card exactly as it was, with no banner', async () => {
  const pane = mount([], appCall);
  pane.bridge.notifsUnavailable = true;
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  assert.ok(pane.bridge.notifListCalls > 0, 'control: it did ask');
  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Unknown number');
  assert.equal(pane.notice.textContent, '', 'and no notice: the card is readable without a name');
});

/**
 * The derived name is dropped with the link, asserted at the only place that can see it.
 *
 * The first version checked the strip was gone right after `setAdvertised(false)`, and passed with
 * the clearing deleted — that call also nulls the call and draws the idle card, which has no strip
 * whatever `appCall` holds. The assertion was true for a reason unrelated to the line it names.
 *
 * So it reconnects and puts up a *different* nameless call with nothing on the notification list.
 * If the old list survived the drop, this call would be named after a WhatsApp call that ended
 * before the link went away.
 */
test('the app name and the notification list are dropped when the link goes', async () => {
  const pane = mount([], appCall);
  pane.bridge.notifs = [whatsappCall];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();
  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Sahil Chaudhary', 'control');

  pane.view.setAdvertised(false);
  // The phone comes back and something else rings, with nothing on the notification list now.
  pane.bridge.notifs = [];
  pane.bridge.notifsUnavailable = true;
  pane.view.setAdvertised(true);
  pane.bridge.fireCall({ ...appCall, callId: 'c2' });
  await settle();
  await settle();

  assert.equal(
    pane.live.queryAll('.call-who')[0]!.textContent,
    'Unknown number',
    'a name from the previous link must not survive it',
  );
  assert.equal(pane.live.queryAll('[data-app-call]').length, 0);
});

/**
 * A call arriving while the pane is already up is named **without** waiting for a notification
 * change — and this test is written the way it is because the obvious version could not fail.
 *
 * `mount(log, current)` seeds `bridge.current`, so `setAdvertised(true)` runs `refreshCurrent()`,
 * which fetches the list by its own route; an assertion on "did it fetch" was satisfied by a code
 * path it was not about, and stayed green with the fetch under test deleted. Here `current` is
 * deliberately **null** and `onNotifChanged` is never fired, so the fetch in `onCallChanged` is the
 * only thing that can populate the list.
 *
 * The real gap it guards: on a cold pane nothing has fired `onNotifChanged` yet, because that fires
 * only on a *change*. Without this fetch the first call of a session reads `Unknown number` until
 * some unrelated notification happens to move.
 */
test('a call arriving on a cold pane is named without any notification change', async () => {
  const pane = mount([], null);
  pane.bridge.notifs = [whatsappCall];
  await settle();
  const asksBefore = pane.bridge.notifListCalls;

  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  assert.ok(
    pane.bridge.notifListCalls > asksBefore,
    'the call itself must ask for the list; nothing else will on a cold pane',
  );
  assert.equal(pane.live.queryAll('.call-who')[0]!.textContent, 'Sahil Chaudhary');
});

/**
 * An app call has **two** strips, not three, and that is a layout measurement rather than taste.
 *
 * Three put the last one at 728–826 inside a `#page` scroll port ending at 795 — 31px clipped,
 * `fraction: 0.69`, measured with `__probe.onScreen`. A card carrying a state has to be visible at
 * rest and not merely reachable (defect 85), and nobody scrolls a card while a phone is ringing.
 *
 * So the strip count is asserted, and so is the fact that nothing the replaced sentence said was
 * dropped: mute and speaker still appear, inside the one strip that remains.
 */
test('an app call replaces the mute strip rather than adding a third one', async () => {
  const pane = mount([], appCall);
  pane.bridge.notifs = [whatsappCall];
  pane.bridge.fireCall(appCall);
  await settle();
  await settle();

  const strips = pane.live.queryAll('.call-audio-note');
  assert.equal(strips.length, 2, 'two strips, or the last one is drawn below the fold');
  const hosted = pane.live.queryAll('[data-app-call]')[0]!;
  assert.match(hosted.textContent, /Mute, speaker and keypad tones are on the phone/,
    'the replaced sentence must not lose what it said');
  assert.match(hosted.textContent, /WhatsApp is hosting this call/);
});

// ---- The call-audio sentence --------------------------------------------------------------------

const PANE_AUDIO = 'Phone call audio on Mac is not available. No Mac and phone have been verified for it.';

test('with no call the pane says call audio is not available, in the approved words', async () => {
  const pane = mount([]);
  await settle();
  const notes = pane.live.queryAll('.call-audio-note');
  assert.equal(notes.length, 1, 'control: the idle card draws one audio strip');
  assert.equal(notes[0].textContent.trim(), PANE_AUDIO);
});

test('a live call draws the same sentence, beside the controls it has a verb for', async () => {
  const pane = mount([], {
    callId: 'c1',
    number: '+911234500000',
    contactName: 'R. Sharma',
    startedAtMs: Date.now(),
    state: 'ringing',
  });
  pane.bridge.fireCall(pane.bridge.current);
  await settle();
  assert.deepEqual(
    pane.live.queryAll('button').map((b) => b.textContent),
    ['Answer on phone', 'Reject'],
    'control: the live card is drawn',
  );
  const audio = pane.live
    .queryAll('.call-audio-note')
    .filter((n) => !n.classList.contains('call-controlled-note'));
  assert.equal(audio.length, 1, 'exactly one audio strip on a live card');
  assert.equal(audio[0].textContent.trim(), PANE_AUDIO);
});

// ---- A refused call log ------------------------------------------------------------------------
//
// Found by the overnight UI harness (2026-10-06): the refusal was shown in the pane's notice, which
// hides itself after six seconds, and nothing else changed — the history column stayed empty and
// Frequently called kept saying it would read the log "once it arrives". Six seconds later the
// pane said nothing at all about why it was blank: Product Principle 1's blank pane.

test('a refused call log stays said in the history column, with a way to ask again', async () => {
  const refused = mount([], null, 'This phone is not sharing its call log.');
  await settle();
  assert.ok(
    refused.note.textContent.includes('This phone is not sharing its call log.'),
    `the history column does not say why it is empty: "${refused.note.textContent}"`,
  );
  const retry = refused.body.children.find((c) => c.tagName.toUpperCase() === 'BUTTON' && c.textContent === 'Try again');
  assert.ok(retry, 'no way to ask again from the column');
  assert.ok(
    !refused.frequent.textContent.includes('once it arrives'),
    `Frequently called still promises a log that was refused: "${refused.frequent.textContent}"`,
  );
  // Control: asking again with a phone that now answers draws the log and drops the refusal.
  refused.bridge.logRefusal = null;
  refused.bridge.log = [row('a')];
  const before = refused.bridge.calls.filter((c) => c === 'callLog').length;
  retry.click();
  await settle();
  assert.equal(refused.bridge.calls.filter((c) => c === 'callLog').length, before + 1, 'Try again did not ask the phone');
  assert.ok(!refused.note.textContent.includes('not sharing'), `the refusal outlived a log that arrived: "${refused.note.textContent}"`);
  assert.match(refused.note.textContent, /1 recent call/);
});

test('a refusal after a log was read says so, and keeps the rows it read', async () => {
  const pane = mount([row('a'), row('b')]);
  await settle();
  assert.match(pane.note.textContent, /2 recent calls/, 'control: the first read drew the log');
  pane.bridge.logRefusal = 'The phone did not answer.';
  // A re-read while the log is on screen: `refresh()`, and the same path a call ending takes.
  await (pane.view as unknown as { refresh(): Promise<void> }).refresh();
  await settle();
  assert.ok(pane.note.textContent.includes('The phone did not answer.'), `a refused re-read was silent: "${pane.note.textContent}"`);
  assert.ok(pane.note.textContent.includes('last read'), `the rows on screen are not said to be the last read: "${pane.note.textContent}"`);
  assert.ok(pane.body.children.some((c) => c.className === 'call-log'), 'the rows that were read were thrown away');
});

// ---- Coming back to the pane (UX batch 2026-10-10, section 1b) -----------------------------------

test('a call made while the Mac was not watching reaches the log when the link comes back', async () => {
  const pane = mount([row('c1')]);
  await settle();
  const reads = () => pane.bridge.calls.filter((c) => c === 'callLog').length;
  assert.equal(reads(), 1, 'control: the log was read once when the phone offered calls');
  const view = pane.view as unknown as { onReturn(t: string, now?: number): Promise<void> };
  // The phone's log gained a row while this Mac was away; nothing on the wire announces it.
  pane.bridge.log = [row('c2', { dateMs: Date.UTC(2026, 8, 3, 10, 0) }), row('c1')];
  // The second setAdvertised(true) on reconnect is what the app does — and before, it read nothing.
  pane.view.setAdvertised(true);
  await settle();
  assert.equal(reads(), 1, 'control: a reconnect alone did not re-read the log (the defect)');
  await view.onReturn('reconnect', 5_000);
  assert.equal(reads(), 2, 'a return after a reconnect did not re-read the log');
  await view.onReturn('focus', 5_500);
  assert.equal(reads(), 2, 'a focus half a second later asked again');
});
