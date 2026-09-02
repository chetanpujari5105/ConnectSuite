import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
// A plain side-effecting import. `apps.ts` touches no DOM at module scope — it only hangs its class
// and its pure functions on `globalThis` — so the document double goes in around the mounts instead.
import './apps';

/**
 * The Apps pane's **view class**, driven for real.
 *
 * The pane's whole design is a claim about what it must *not* say. A backgrounded `startActivity` on
 * this platform returns normally and does not open anything (`docs/phase-7-apps-proposal.md` §2.4),
 * so a click here asks the phone to ask its user — and the copy is allowed to say exactly that and
 * no more. Most of the assertions below are therefore about absence, which makes their controls
 * matter more than usual: every "the pane does not say X" test is paired with a positive read
 * proving the pane said anything at all.
 *
 * The DOM is the double; `domDouble.testkit.ts` says at length which half that leaves unmeasured.
 */

type AppRow = { package: string; label: string; updatedMs: number; labelIsFallback?: boolean };

class FakeBridge {
  apps: AppRow[] = [];
  count = 0;
  total = 0;
  listOk = true;
  icons: Array<[string, string]> = [];
  askOk = true;
  askReason = 'The phone could not show the request.';
  askFixHint: string | undefined = 'Turn on notifications for ConnectSuite on the phone.';
  readonly calls: string[] = [];

  async appsList() {
    this.calls.push('appsList');
    if (!this.listOk) return { ok: false as const, reason: 'apps.list timed out', code: 'TIMEOUT' };
    return {
      ok: true as const,
      data: { apps: this.apps, count: this.count || this.apps.length, total: this.total || this.apps.length },
    };
  }
  async appsIcons(options: { packages: string[] }) {
    this.calls.push(`appsIcons:${options.packages.length}`);
    return { ok: true as const, data: this.icons };
  }
  async appsOpenAsk(options: { package: string }) {
    this.calls.push(`appsOpenAsk:${options.package}`);
    if (this.askOk) return { ok: true as const };
    return {
      ok: false as const,
      reason: this.askReason,
      ...(this.askFixHint ? { fixHint: this.askFixHint } : {}),
    };
  }
}

interface Pane {
  bridge: FakeBridge;
  banner: FakeElement;
  note: FakeElement;
  search: FakeElement;
  grid: FakeElement;
  toast: FakeElement;
  view: { refresh(): Promise<void>; setAdvertised(on: boolean, reason?: string | null): void };
}

// Installed for the whole file rather than around each mount — the view's drawing is asynchronous,
// and a fixture torn down before the thing it supports has finished is the sampling-window fault
// from CLAUDE.md wearing a test-harness costume. clipboardView.test.ts learned this the hard way.
installFakeDocument();

function mount(apps: AppRow[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.apps = apps;
  const banner = el('div');
  const note = el('div');
  const search = el('input');
  const grid = el('div');
  const toast = el('div');
  const View = (globalThis as Record<string, unknown>).AppsView as new (...args: unknown[]) => Pane['view'];
  const view = new View(bridge, banner, note, search, grid, toast);
  return { bridge, banner, note, search, grid, toast, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const APPS: AppRow[] = [
  { package: 'com.instagram.android', label: 'Instagram', updatedMs: 1 },
  { package: 'com.android.chrome', label: 'Chrome', updatedMs: 2 },
  { package: 'com.headless.thing', label: 'com.headless.thing', updatedMs: 3, labelIsFallback: true },
];

test('the grid draws one tile per app, with the name a person reads', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();

  const tiles = pane.grid.queryAll('.apps-tile');
  assert.equal(tiles.length, 3);
  assert.match(pane.grid.textContent, /Instagram/);
  assert.match(pane.grid.textContent, /Chrome/);
});

/**
 * The assertion this pane exists for.
 *
 * A click sends one sentence and it is about the *request*. "Opening", "Launched", "Opened" are all
 * claims about a tap that has not happened and may never happen — and the wire has no field that
 * could support any of them, which is deliberate.
 */
test('a click says the app was sent, and never that it opened', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();

  const tile = pane.grid.queryAll('.apps-tile')[0]!;
  tile.dispatch('click');
  await settle();

  // The positive control first: without it, every "does not say" below passes over an empty node.
  assert.equal(pane.toast.hidden, false, 'the pane said something');
  assert.match(pane.toast.textContent, /Sent to your phone/);
  assert.match(pane.toast.textContent, /Instagram/);

  assert.doesNotMatch(pane.toast.textContent, /open(ed|ing)/i);
  assert.doesNotMatch(pane.toast.textContent, /launch/i);
  assert.equal(pane.bridge.calls.includes('appsOpenAsk:com.instagram.android'), true);
});

/**
 * No pending state, and this is a rule rather than a detail.
 *
 * A tile that dims while "opening" models an operation that does not exist: the request either
 * reached the phone or it did not, in milliseconds, and everything after that belongs to a person
 * holding a phone. The moment a tile has a busy state, somebody will want to resolve it.
 */
test('a tile does not enter a pending state, because there is nothing pending', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();

  const before = pane.grid.queryAll('.apps-tile')[0]!;
  assert.equal(before.disabled, false);
  before.dispatch('click');
  await settle();

  const after = pane.grid.queryAll('.apps-tile')[0]!;
  assert.equal(after.disabled, false, 'no tile may model an operation the Mac cannot observe');
  assert.equal(pane.grid.queryAll('.apps-tile').length, 3, 'and the grid is unchanged');
});

test("a refused ask draws the phone's own sentence, not a Mac-side paraphrase", async () => {
  const pane = mount(APPS);
  pane.bridge.askOk = false;
  pane.bridge.askReason =
    'The phone could not show the request: notifications from ConnectSuite are turned off.';
  await pane.view.refresh();
  await settle();

  pane.grid.queryAll('.apps-tile')[0]!.dispatch('click');
  await settle();

  assert.match(pane.toast.textContent, /notifications from ConnectSuite are turned off/);
  assert.match(pane.toast.textContent, /Turn on notifications/);
  // And it must not say the thing that did not happen. A refusal drawn beside "Sent to your phone"
  // is two contradictory claims on one line, which is how a user learns to distrust both.
  assert.doesNotMatch(pane.toast.textContent, /Sent to your phone/);
  assert.equal(pane.toast.className.includes('refused'), true);
});

test('a successful ask after a refusal clears the refusal', async () => {
  // The state this catches is a stale warning outliving the condition that produced it — the pane
  // would otherwise say "notifications are off" over a request that just went through.
  const pane = mount(APPS);
  pane.bridge.askOk = false;
  await pane.view.refresh();
  await settle();
  pane.grid.queryAll('.apps-tile')[0]!.dispatch('click');
  await settle();
  assert.equal(pane.toast.className.includes('refused'), true);

  pane.bridge.askOk = true;
  pane.grid.queryAll('.apps-tile')[1]!.dispatch('click');
  await settle();
  assert.equal(pane.toast.className.includes('sent'), true);
  assert.match(pane.toast.textContent, /Chrome/);
});

/**
 * The unadvertised state, which is the one the pane must not turn into a dead screen.
 *
 * `apps` is gated on POST_NOTIFICATIONS because the tap is the only route there is. But the list and
 * the icons answer regardless, so the grid stays and the banner explains — the same designed
 * inconsistency the Photos pane carried through slice 2.
 */
test('with the capability off the grid still draws, and the banner says which half is missing', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();
  pane.view.setAdvertised(false, 'missing Notifications');
  await settle();

  assert.equal(pane.banner.hidden, false);
  assert.match(pane.banner.textContent, /missing Notifications/, "the phone's own reason, verbatim");
  assert.equal(
    pane.grid.queryAll('.apps-tile').length,
    3,
    'a grey chip greys a chip; it does not empty a working list',
  );
  assert.equal(pane.banner.className.includes('partial'), true, '--warning, never --destructive');
});

test('with the capability on the banner disappears entirely', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();
  pane.view.setAdvertised(false, 'missing Notifications');
  await settle();
  assert.equal(pane.banner.hidden, false);

  pane.view.setAdvertised(true, null);
  await settle();
  // A banner explaining an absence that has since been fixed is the stale-copy defect. It goes in
  // the same moment the chip turns green, from the same fact.
  assert.equal(pane.banner.hidden, true);
});

test('a failed list replaces the grid and keeps the phone reason', async () => {
  const pane = mount(APPS);
  pane.bridge.listOk = false;
  await pane.view.refresh();
  await settle();

  assert.equal(pane.banner.hidden, false);
  assert.match(pane.banner.textContent, /apps.list timed out/);
  assert.equal(pane.grid.queryAll('.apps-tile').length, 0);
  // Empty and failed must not look alike — the rule the Files pane's four independent differences
  // came from. Here the discriminator is the class and the headline verb.
  assert.equal(pane.banner.className.includes('unavailable'), true);
  assert.doesNotMatch(pane.grid.textContent, /Nothing matches/);
});

test('an unresolved label is drawn as the handle it is', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();

  const fallback = pane.grid
    .queryAll('.apps-tile')
    .find((tile) => tile.dataset.package === 'com.headless.thing');
  assert.ok(fallback, 'the fallback app is in the grid');
  // AppLabels' fallback is correct and must not be "fixed" — but a package id may never be the only
  // thing a user reads *as though it were a name*. Mono is how the notifications pane already says
  // so (departure N5), and this asserts the same treatment reaches here.
  assert.equal(fallback.queryAll('.mono').length, 1);
  // Control: a resolved label is not drawn that way, so the assertion above is about the flag
  // rather than about every tile.
  const named = pane.grid.queryAll('.apps-tile').find((t) => t.dataset.package === 'com.android.chrome');
  assert.equal(named?.queryAll('.mono').length, 0);
});

test('search filters on name and on package, and says how many of how many', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();
  assert.match(pane.note.textContent, /3 apps/);

  (pane.search as unknown as { value: string }).value = 'insta';
  pane.search.dispatch('input');
  await settle();
  assert.equal(pane.grid.queryAll('.apps-tile').length, 1);
  assert.match(pane.note.textContent, /1 of 3 apps/);

  // Searchable by package too — somebody who knows they want `com.android.chrome` should find it.
  // That is a different thing from displaying an id nobody asked for, which the test above covers.
  (pane.search as unknown as { value: string }).value = 'com.android';
  pane.search.dispatch('input');
  await settle();
  assert.equal(pane.grid.queryAll('.apps-tile').length, 1);
});

test('a search matching nothing is a different screen from a phone with no apps', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();
  (pane.search as unknown as { value: string }).value = 'zzzz';
  pane.search.dispatch('input');
  await settle();
  assert.match(pane.grid.textContent, /Nothing matches that/);

  const bare = mount([]);
  await bare.view.refresh();
  await settle();
  assert.match(bare.grid.textContent, /The phone listed no apps/);
  // The two empties must not read alike. One is an ordinary search miss; the other would mean
  // package visibility is refusing the launcher query, which is a finding rather than a state.
  assert.doesNotMatch(bare.grid.textContent, /Nothing matches that/);
});

test('a truncated list shows both numbers rather than only the one it received', async () => {
  const pane = mount(APPS);
  pane.bridge.count = 3;
  pane.bridge.total = 1500;
  await pane.view.refresh();
  await settle();
  // A list that quietly returned its first N rows reads as a phone with exactly N apps — the
  // 200-page probe cap wearing a wire format. Both numbers, or the reading is about the instrument.
  assert.match(pane.note.textContent, /3 apps of 1,500/);
  assert.match(pane.note.textContent, /capped/);
});

test('icons are asked for once, for the packages that were listed', async () => {
  const pane = mount(APPS);
  await pane.view.refresh();
  await settle();
  assert.deepEqual(pane.bridge.calls, ['appsList', 'appsIcons:3']);
});
