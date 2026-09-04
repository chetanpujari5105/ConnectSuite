import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
// The page loads these three before `overview.js` and this file does the same wiring, not a stub:
// `SCREENS` and `iconSvg` come off `navModel`/`icons`, and `activityPage`/`activityWhen`/
// `CATEGORY_TINTS` off `shared/activity`.
import './navModel';
import './icons';
import '../shared/activity';
import '../shared/deviceVitals';
import './overview';

/**
 * Overview's Quick actions, Recent activity and footer strip, driven for real.
 *
 * This file exists because of a bug it would have caught. The card took `events.slice(0, 5)` from a
 * store that returns events **oldest first**, and drew the five oldest things that had ever happened
 * under a heading reading *Recent activity*. Nothing in the suite could see it — the code was in
 * `renderer.ts`, which needs `connect`, `shell` and a live DOM at module scope and is therefore
 * reachable by no test at all. Moving it into a class was the fix; this is the guard.
 */

type Event = { seq: number; at: number; category: string; kind: string; detail: string };

class FakeBridge {
  events: Event[] = [];
  fail = false;
  readonly calls: string[] = [];

  async activityEvents() {
    this.calls.push('activityEvents');
    if (this.fail) return { ok: false as const, reason: 'the log could not be read' };
    return { ok: true as const, data: { events: this.events, error: null } };
  }
  async disconnect() {
    this.calls.push('disconnect');
    return null;
  }
}

installFakeDocument();

interface Pane {
  bridge: FakeBridge;
  grid: FakeElement;
  count: FakeElement;
  recent: FakeElement;
  strip: FakeElement;
  stripLine: FakeElement;
  disconnect: FakeElement;
  routed: string[];
  view: { setStatus(c: boolean, n: string | null, u: number): void; refresh(): Promise<void> };
}

function mount(events: Event[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.events = events;
  const parts = {
    grid: el('div'),
    count: el('span'),
    recent: el('div'),
    strip: el('div'),
    stripLine: el('span'),
    disconnect: el('button'),
    ringRow: el('div'),
  };
  const routed: string[] = [];
  const View = (globalThis as Record<string, unknown>).OverviewView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    bridge,
    parts.grid,
    parts.count,
    parts.recent,
    parts.strip,
    parts.stripLine,
    parts.disconnect,
    (id: string) => routed.push(id),
    parts.ringRow,
  );
  return { bridge, ...parts, routed, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function event(seq: number, over: Partial<Event> = {}): Event {
  return { seq, at: 1_000_000 + seq * 1000, category: 'files', kind: `kind ${seq}`, detail: `detail ${seq}`, ...over };
}

// ---- Recent activity ----------------------------------------------------------------------------

test('Recent activity shows the NEWEST five, whatever order the store hands them over in', async () => {
  // The store returns events in insertion order — oldest first — and the Activity pane sorts by
  // `seq` descending before paging. `.slice(0, 5)` over the raw array is therefore the five oldest
  // things that ever happened, under a heading reading "Recent activity". That shipped.
  const pane = mount([1, 2, 3, 4, 5, 6, 7].map((n) => event(n)));
  await pane.view.refresh();

  const rows = pane.recent.queryAll('.recent-row');
  assert.equal(rows.length, 5, 'control: five rows were drawn');
  assert.deepEqual(
    pane.recent.queryAll('.recent-text').map((t) => t.textContent),
    ['kind 7', 'kind 6', 'kind 5', 'kind 4', 'kind 3'],
  );
});

test('nothing recorded and could-not-read are two different cards', async () => {
  const empty = mount([]);
  await empty.view.refresh();
  assert.match(empty.recent.textContent, /Nothing yet/);
  assert.equal(empty.recent.queryAll('.is-problem').length, 0);

  const failed = mount([]);
  failed.bridge.fail = true;
  await failed.view.refresh();
  assert.match(failed.recent.textContent, /could not be read/);
  // Failed is not empty, and the two are one bug apart everywhere else in this app.
  assert.equal(failed.recent.queryAll('.is-problem').length, 1);
  assert.ok(!failed.recent.textContent.includes('Nothing yet'));
});

test('a late refresh does not draw over a newer one', async () => {
  // A route open, the launch and a reconnect can each begin one. Two correct triggers a frame apart
  // is exactly how the Files pane assembled a wrong picture out of legal states.
  const pane = mount([event(1)]);
  const first = pane.view.refresh();
  pane.bridge.events = [event(2)];
  const second = pane.view.refresh();
  await Promise.all([first, second]);

  assert.deepEqual(
    pane.recent.queryAll('.recent-text').map((t) => t.textContent),
    ['kind 2'],
    'the older run overwrote the newer one',
  );
});

// ---- Quick actions ------------------------------------------------------------------------------

test('the grid is the design’s eight, read from navModel rather than written out', () => {
  const pane = mount();
  const tiles = pane.grid.queryAll('.quick-tile');
  assert.equal(tiles.length, 8);
  assert.deepEqual(
    pane.grid.queryAll('.quick-name').map((n) => n.textContent),
    ['Mirror', 'Files', 'Photos', 'Notifications', 'Messages', 'Clipboard', 'Calls', 'Camera'],
  );
});

test('an unbuilt tile is marked rather than removed, and says so in its accessible name', () => {
  const pane = mount();
  const unbuilt = pane.grid.queryAll('.quick-tile').filter((t) => t.className.includes('is-unbuilt'));
  assert.equal(unbuilt.length, 1, 'Camera is the only unbuilt screen in the eight');
  // Removing it leaves a seven-tile grid that reflows the day it ships. A marked tile carries the
  // same information and the composition stops moving — state A's rule.
  assert.match(unbuilt[0].getAttribute('aria-label') ?? '', /Camera — not built yet/);
  // The state must not live only in the opacity: that is defect 26, one pane over.
  assert.match(unbuilt[0].textContent, /Not built yet/);
});

test('the count says how many WORK, with the total beside it', () => {
  const pane = mount();
  // The design's "8 available" counts tiles. Ours counts the ones that work, because the two
  // numbers differ here — a bare 8 over a grid with a dead tile is the denominator rule with the
  // denominator taken out.
  assert.equal(pane.count.textContent, '7 of 8 available');
});

test('the Notifications tile shows a live count above zero and its subtitle at zero', () => {
  const pane = mount();
  const subOf = (label: string) => {
    const at = pane.grid.queryAll('.quick-name').findIndex((n) => n.textContent === label);
    return pane.grid.queryAll('.quick-sub')[at]?.textContent;
  };
  assert.match(subOf('Notifications') ?? '', /Show every phone notification|notification/i);

  pane.view.setStatus(true, 'Phone', 17);
  assert.equal(subOf('Notifications'), '17 new');

  // A tile reading "0 new" is a count nobody needs — the rule the sidebar badge already follows.
  pane.view.setStatus(true, 'Phone', 0);
  assert.ok(!(subOf('Notifications') ?? '').includes('0 new'));
});

test('a tile routes to its own screen', () => {
  const pane = mount();
  pane.grid.queryAll('.quick-tile')[1].click();
  assert.deepEqual(pane.routed, ['files']);
});

// ---- The footer strip ---------------------------------------------------------------------------

test('the strip claims encryption only while something is connected', () => {
  const pane = mount();
  pane.view.setStatus(true, 'Galaxy S26 Ultra', 0);
  assert.match(pane.stripLine.textContent, /Encrypted end to end with Galaxy S26 Ultra/);
  assert.equal(pane.disconnect.disabled, false);
  assert.ok(!pane.strip.classList.contains('is-idle'));

  // A strip claiming an encrypted connection over a link that is down would be this screen's one
  // security sentence being wrong in the state where somebody is most likely to be reading it.
  pane.view.setStatus(false, null, 0);
  assert.ok(!/[Ee]ncrypted/.test(pane.stripLine.textContent));
  assert.match(pane.stripLine.textContent, /Not connected/);
  assert.equal(pane.disconnect.disabled, true);
  assert.ok(pane.strip.classList.contains('is-idle'));
});

test('Disconnect calls the bridge, and only that', async () => {
  const pane = mount();
  pane.view.setStatus(true, 'Phone', 0);
  pane.disconnect.click();
  await settle();
  assert.deepEqual(pane.bridge.calls.filter((c) => c === 'disconnect'), ['disconnect']);
});

// ---- O4, Device status rings --------------------------------------------------------------------

/**
 * These drive the **view**, not `deviceVitals.ts` — that decision has its own tests. What is checked
 * here is that the pane wires it up and that the three states reach the DOM differently, which is
 * the layer defects 58, 59 and 85 all lived in.
 */
type Vitals = { setVitals(b: unknown, s: unknown): void };

test('O4 — a phone that has never reported draws no arc at all', () => {
  const pane = mount();
  (pane.view as unknown as Vitals).setVitals(null, null);
  const cells = pane.ringRow.children;
  assert.equal(cells.length, 2, 'two rings, and neither of them is memory');
  for (const cell of cells) {
    assert.equal(cell.dataset.tone, 'unknown');
    // A gradient would paint something here. The absence of the arc element IS the state.
    // `querySelector` rather than `querySelectorAll`: the DOM double implements the first and not
    // the second, and a test that reaches past what the double models is testing the double.
    assert.equal(cell.querySelector('.ring-arc'), null);
  }
});

test('O4 — reported-as-unknown and never-reported are different sentences', () => {
  const never = mount();
  (never.view as unknown as Vitals).setVitals(null, null);
  const cannot = mount();
  (cannot.view as unknown as Vitals).setVitals(
    { level: null, charging: false, capacityUnknown: true },
    null,
  );
  const a = never.ringRow.children[0].querySelector('.ring-caption').textContent;
  const b = cannot.ringRow.children[0].querySelector('.ring-caption').textContent;
  assert.notEqual(a, b, 'a phone that cannot report reads the same as one that has not yet');
});

test('O4 — a real reading draws an arc and says the number', () => {
  const pane = mount();
  (pane.view as unknown as Vitals).setVitals(
    { level: 72, charging: true, capacityUnknown: false },
    { freeBytes: 41_231_908_864, totalBytes: 511_000_000_000 },
  );
  const [battery, storage] = Array.from(pane.ringRow.children);
  assert.equal(battery.dataset.tone, 'ok');
  assert.notEqual(battery.querySelector('.ring-arc'), null);
  assert.equal(battery.querySelector('.ring-value').textContent, '72%');
  assert.equal(battery.querySelector('.ring-caption').textContent, 'Charging');
  assert.match(storage.querySelector('.ring-caption').textContent, /^free of /);
});

test('O4 — a low battery is toned differently from a healthy one', () => {
  const low = mount();
  (low.view as unknown as Vitals).setVitals({ level: 5, charging: false, capacityUnknown: false }, null);
  assert.equal(low.ringRow.children[0].dataset.tone, 'low');
});
