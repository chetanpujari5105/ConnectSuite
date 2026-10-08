import { test } from 'node:test';
import assert from 'node:assert/strict';
// `require`, not `import`, and not by accident: this module carries no `export` keyword because the
// renderer loads it as a plain script (see its header). The other shared modules' tests do the same.
const { describeClipPhone, lastArrivalFromPhone, lastArrivalHow } = require('./clipPhoneState.ts');

type ClipPhoneStateId = 'waiting' | 'received' | 'offline' | 'unavailable';
interface ClipPhoneFacts {
  connected: boolean;
  advertised: boolean;
  unavailableReason: string | null;
  lastArrivedAtMs: number | null;
  lastArrivalHow?: 'applied' | 'copied' | 'offered' | null;
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
  assert.match(view.detail, /open Sidekick there/);
  // And it names the owner of the rule, so it cannot read as our unfinished work.
  assert.match(view.detail, /Android/);
  assert.match(view.detail, /every app/);
});

test('every route the product has is named in the copy a waiting user reads', () => {
  // The guard against the next second-path drift: when a third way to send arrives, this fails
  // until somebody decides whether it belongs in the sentence. That decision is the point.
  const detail = describeClipPhone(facts()).detail;
  const routes = ['Send to Mac', 'open Sidekick there'];
  for (const route of routes) assert.ok(detail.includes(route), `the copy does not mention ${route}`);
});

test('the toolbar route is never promised unqualified — defect 86', () => {
  // It does not exist until a per-app switch is flipped on the phone, and One UI ships that off.
  // An unqualified mention is a promise this Mac cannot keep and cannot even check.
  for (const view of [describeClipPhone(facts()), describeClipPhone(facts({ lastArrivedAtMs: T0 - 1000 }))]) {
    if (!view.detail.includes('Send to Mac')) continue;
    assert.match(view.detail, /set up on the phone/, `"${view.id}" promises the toolbar route flatly`);
  }
});

test('the route that always works is stated before the one that needs setting up', () => {
  const detail = describeClipPhone(facts()).detail;
  assert.ok(
    detail.indexOf('open Sidekick there') < detail.indexOf('Send to Mac'),
    'the conditional route leads, so a user without the switch reads a promise first',
  );
});

test('the received state does not send people to a toolbar entry that may be off', () => {
  // It used to read "For the next one, select it on the phone and tap Send to Mac" — a flat
  // instruction for a gesture most phones do not have yet.
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 1000 }));
  if (view.detail.includes('Send to Mac')) assert.match(view.detail, /set up on the phone/);
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

// ---- 2026-10-09: the arrival card said how it arrived, and named the old app (release report, stage 6) ----

test('an arrival copied by the person from an offer is not described as automatic', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 1_000, lastArrivalHow: 'copied' }));
  assert.equal(view.id, 'received');
  assert.doesNotMatch(view.detail, /straight onto|automatic/i, 'a person-initiated Copy described as automatic');
  assert.match(view.detail, /You copied it/);
  // The selection route does not need the app on screen, so no "open the app again" is claimed.
  assert.doesNotMatch(view.detail, /open on the phone again/);
});

test('an arrival still waiting for Copy says so, and says the clipboard is untouched', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 1_000, lastArrivalHow: 'offered' }));
  assert.doesNotMatch(view.detail, /⌘V pastes it/);
  assert.match(view.detail, /Copy/);
});

test('control: an automatic arrival still says it went straight onto the clipboard', () => {
  const view = describeClipPhone(facts({ lastArrivedAtMs: T0 - 1_000, lastArrivalHow: 'applied' }));
  assert.match(view.detail, /straight onto this Mac’s clipboard/);
  assert.match(view.detail, /Sidekick open on the phone again/);
});

test('no state of the phone line names the old app', () => {
  const all = [
    facts(), facts({ connected: false }), facts({ advertised: false }),
    ...(['applied', 'copied', 'offered', null] as const).map((how) => facts({ lastArrivedAtMs: T0, lastArrivalHow: how })),
  ].map((f) => describeClipPhone(f));
  assert.equal(all.length, 7, 'control: every fact set was described');
  for (const view of all) assert.doesNotMatch(`${view.headline} ${view.detail}`, /ConnectSuite/);
});

test('lastArrivalHow reads the newest phone entry: applied, copied from an offer, or offered', () => {
  assert.equal(lastArrivalHow([]), null);
  assert.equal(lastArrivalHow([{ source: 'phone', receivedAtMs: 5, applied: true }]), 'applied');
  assert.equal(lastArrivalHow([{ source: 'phone', receivedAtMs: 5, applied: true, copiedByPerson: true }]), 'copied');
  assert.equal(lastArrivalHow([{ source: 'phone', receivedAtMs: 5, applied: false, offerId: 'o1' }]), 'offered');
  assert.equal(
    lastArrivalHow([
      { source: 'phone', receivedAtMs: 9, applied: true, copiedByPerson: true },
      { source: 'phone', receivedAtMs: 5, applied: true },
      { source: 'mac', receivedAtMs: 20, applied: true },
    ]),
    'copied',
    'the newest phone entry decides, by this Mac’s clock',
  );
});
