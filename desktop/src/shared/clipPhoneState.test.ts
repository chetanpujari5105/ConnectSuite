import { test } from 'node:test';
import assert from 'node:assert/strict';
// `require`, not `import`, and not by accident: this module carries no `export` keyword because the
// renderer loads it as a plain script (see its header). The other shared modules' tests do the same.
const { describeClipPhone, lastArrivalFromPhone } = require('./clipPhoneState.ts');

type ClipPhoneStateId = 'waiting' | 'received' | 'offline' | 'unavailable';
interface ClipPhoneFacts {
  connected: boolean;
  advertised: boolean;
  unavailableReason: string | null;
  lastArrivedAtMs: number | null;
  nowMs: number;
}

const T0 = 1_700_000_000_000;

const facts = (over: Partial<ClipPhoneFacts> = {}): ClipPhoneFacts => ({
  connected: true,
  advertised: true,
  unavailableReason: null,
  lastArrivedAtMs: null,
  nowMs: T0,
  ...over,
});

test('connected, advertised, nothing yet — the resting state of a working feature', () => {
  const view = describeClipPhone(facts());
  assert.equal(view.id, 'waiting');
  // The defect was a pane that could not say this. The tone is the machine-readable half of it.
  assert.equal(view.tone, 'ready');
  // **Nothing to do, because nothing is wrong.** A Retry here would assert a problem.
  assert.equal(view.action, null);
});

test('the waiting state carries the recipe, which was 828px below the fold', () => {
  const view = describeClipPhone(facts());
  // **Both** routes. The first version of this named only the slower one, and stayed true and
  // misleading the hour the selection toolbar shipped — defect 63's shape.
  assert.match(view.detail, /Send to Mac/);
  assert.match(view.detail, /open ConnectSuite there/);
  // And it names the owner of the rule, so it cannot read as our unfinished work.
  assert.match(view.detail, /Android/);
  assert.match(view.detail, /every app/);
});

test('every route the product has is named in the copy a waiting user reads', () => {
  // The guard against the next second-path drift: when a third way to send arrives, this fails
  // until somebody decides whether it belongs in the sentence. That decision is the point.
  const detail = describeClipPhone(facts()).detail;
  const routes = ['Send to Mac', 'open ConnectSuite there'];
  for (const route of routes) assert.ok(detail.includes(route), `the copy does not mention ${route}`);
});

test('the received state points at the cheaper route for next time', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 1000 }));
  assert.match(view.detail, /Send to Mac/);
});

test('an arrival is dated on THIS Mac\'s clock', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 120_000 }));
  assert.equal(view.id, 'received');
  assert.match(view.headline, /2 minutes ago/);
});

test('a fresh arrival reads "just now" rather than "0 minutes ago"', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 3_000 }));
  assert.match(view.headline, /just now/);
});

test('disconnected wins over every other question', () => {
  // A phone that is not there cannot be failing to advertise, and cannot have refused a read.
  const view = describeClipPhone(facts({ connected: false, advertised: false }));
  assert.equal(view.id, 'offline');
  // The sentence that stops this being read as the Android limit, which is the confusion under test.
  assert.match(view.detail, /not the Android/i);
});

test('a connected phone that is not offering clipboard says so in its own words', () => {
  const view = describeClipPhone(
    facts({ advertised: false, unavailableReason: 'Notification access is off.' }),
  );
  assert.equal(view.id, 'unavailable');
  assert.equal(view.detail, 'Notification access is off.');
});

test('and falls back to our own sentence when the phone did not give one', () => {
  const view = describeClipPhone(facts({ advertised: false }));
  assert.equal(view.id, 'unavailable');
  assert.ok(view.detail.length > 20, 'an empty detail would draw a blank line');
});

/**
 * The invariant the defect is about, and the reason it is asserted pairwise rather than by eye.
 *
 * Defect 85 was *working and quiet* and *broken and quiet* drawing the identical picture. So the
 * four states are required to differ in **four independent ways** — the Files pane's rule, which
 * exists because one difference is a bug away from none.
 */
const ALL: ClipPhoneStateId[] = ['waiting', 'received', 'offline', 'unavailable'];

const viewFor = (id: ClipPhoneStateId) =>
  describeClipPhone(
    facts({
      connected: id !== 'offline',
      advertised: id !== 'unavailable',
      lastArrivedAtMs: id === 'received' ? T0 - 60_000 : null,
    }),
  );

test('every state is reachable — the control, before any claim about them differing', () => {
  // A pairwise-difference test over three states that all collapse to one would pass trivially.
  for (const id of ALL) assert.equal(viewFor(id).id, id, `${id} is unreachable`);
});

test('no two states share an icon, or a headline verb', () => {
  const icons = new Set(ALL.map((id) => viewFor(id).icon));
  assert.equal(icons.size, ALL.length, 'two states draw the same icon');
  const verbs = new Set(ALL.map((id) => viewFor(id).headline.split(' ')[0].toLowerCase()));
  assert.equal(verbs.size, ALL.length, 'two states open with the same word');
});

test('working and broken differ in tone AND in whether an action exists', () => {
  const working: ClipPhoneStateId[] = ['waiting', 'received'];
  const broken: ClipPhoneStateId[] = ['offline', 'unavailable'];
  for (const w of working) {
    for (const b of broken) {
      const a = viewFor(w);
      const c = viewFor(b);
      assert.notEqual(a.tone, c.tone, `${w} and ${b} share a tone`);
      // The fourth difference: nothing to do, versus something to do.
      assert.equal(a.action, null, `${w} offers an action, which asserts a problem`);
      assert.ok(c.action, `${b} offers no action, so a broken state looks like a working one`);
    }
  }
});

test('waiting and offline — the exact pair that drew one picture — differ four ways', () => {
  const w = viewFor('waiting');
  const o = viewFor('offline');
  assert.notEqual(w.tone, o.tone);
  assert.notEqual(w.icon, o.icon);
  assert.notEqual(w.headline, o.headline);
  assert.notEqual(w.action === null, o.action === null);
});

test('lastArrivalFromPhone takes this Mac\'s clock and skips what it did not witness', () => {
  assert.equal(
    lastArrivalFromPhone([
      { source: 'mac', receivedAtMs: 9_000 },
      { source: 'phone', receivedAtMs: 5_000 },
      { source: 'phone', receivedAtMs: 7_000 },
    ]),
    7_000,
  );
  // A phone row with no receivedAtMs is one this Mac did not see arrive. `atMs` is RIGHT THERE and
  // is the phone's clock; using it would date the line by somebody else's watch.
  assert.equal(lastArrivalFromPhone([{ source: 'phone' }]), null);
  assert.equal(lastArrivalFromPhone([{ source: 'mac', receivedAtMs: 1 }]), null);
  assert.equal(lastArrivalFromPhone([]), null);
});
