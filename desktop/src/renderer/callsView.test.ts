import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
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
  async callLog() {
    this.calls.push('callLog');
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

  fireCall(call: Call | null): void {
    this.changed?.(call);
  }
}

installFakeDocument();
const fakeWindow = installFakeWindow();

interface Pane {
  bridge: FakeBridge;
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

function mount(log: LogRow[] = [], current: Call | null = null): Pane {
  const bridge = new FakeBridge();
  bridge.log = log;
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
  return { bridge, ...parts };
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
