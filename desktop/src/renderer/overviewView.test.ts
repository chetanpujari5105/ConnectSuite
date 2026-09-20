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
import '../shared/securityCard';
import './overflowTitle';
import './overview';

/**
 * Overview's Recent activity, metric cards and Connection & security card, driven for real.
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
  async reconnect() {
    this.calls.push('reconnect');
    return null;
  }
}

installFakeDocument();

interface Pane {
  bridge: FakeBridge;
  recent: FakeElement;
  recentSub: FakeElement;
  security: { card: FakeElement; badge: FakeElement; title: FakeElement; body: FakeElement; actions: FakeElement };
  ringRow: FakeElement;
  routed: string[];
  view: { setStatus(s: { phase?: string; paired: boolean }, now?: number): void; refresh(): Promise<void> };
}

function mount(events: Event[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.events = events;
  const parts = {
    recent: el('div'),
    recentSub: el('p'),
    security: { card: el('section'), badge: el('span'), title: el('h3'), body: el('p'), actions: el('div') },
    ringRow: el('div'),
  };
  const routed: string[] = [];
  const View = (globalThis as Record<string, unknown>).OverviewView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    bridge,
    parts.recent,
    parts.recentSub,
    parts.security,
    (id: string, pane?: string) => routed.push(pane ? `${id}/${pane}` : id),
    parts.ringRow,
  );
  return { bridge, ...parts, routed, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function event(seq: number, over: Partial<Event> = {}): Event {
  return { seq, at: 1_000_000 + seq * 1000, category: 'files', kind: `kind ${seq}`, detail: `detail ${seq}`, ...over };
}

// ---- Recent activity ----------------------------------------------------------------------------

test('Recent activity shows the NEWEST four, whatever order the store hands them over in', async () => {
  // The store returns events in insertion order — oldest first — and the Activity pane sorts by
  // `seq` descending before paging. `.slice(0, 5)` over the raw array is therefore the five oldest
  // things that ever happened, under a heading reading "Recent activity". That shipped.
  const pane = mount([1, 2, 3, 4, 5, 6, 7].map((n) => event(n)));
  await pane.view.refresh();

  const rows = pane.recent.queryAll('.recent-row');
  assert.equal(rows.length, 4, 'control: the handoff\'s four rows were drawn');
  assert.deepEqual(
    pane.recent.queryAll('.recent-text').map((t) => t.textContent),
    ['kind 7', 'kind 6', 'kind 5', 'kind 4'],
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

// ---- Connection & security (component 19) -------------------------------------------------------

const actionsOf = (pane: Pane) => pane.security.actions.children.map((b) => b.dataset.action);

test('connected: the encryption claim, and Disconnect beside it', () => {
  const pane = mount();
  pane.view.setStatus({ phase: 'connected', paired: true });
  assert.equal(pane.security.card.dataset.state, 'connected');
  assert.match(pane.security.title.textContent, /Encrypted/);
  assert.deepEqual(actionsOf(pane), ['disconnect']);
  assert.equal(pane.security.card.dataset.layout, 'inline');
});

test('the moment a session ends is recorded by the view and stated in the past tense', () => {
  // The write lives in the view, in reach of this test — defect 67: an edge is a write.
  const pane = mount();
  const at = new Date(2026, 8, 19, 9, 42).getTime();
  pane.view.setStatus({ phase: 'connected', paired: true }, at - 60_000);
  pane.view.setStatus({ phase: 'idle', paired: true }, at);
  pane.view.setStatus({ phase: 'idle', paired: true }, at + 5_000);
  assert.equal(pane.security.card.dataset.state, 'disconnected');
  assert.match(pane.security.body.textContent, /ended at 09:42/, 'the time of the END, not of the latest redraw');
  assert.ok(!/^Encrypted/.test(pane.security.title.textContent));
  assert.deepEqual(actionsOf(pane), ['reconnect', 'troubleshoot']);
  assert.equal(pane.security.card.dataset.layout, 'stacked');
});

test('a Mac that never saw a session end names no time', () => {
  const pane = mount();
  pane.view.setStatus({ phase: 'idle', paired: true });
  assert.ok(!/ended at/.test(pane.security.body.textContent));
});

test('each action does exactly its one thing', async () => {
  const pane = mount();
  pane.view.setStatus({ phase: 'connected', paired: true });
  pane.security.actions.children[0]!.click();
  pane.view.setStatus({ phase: 'idle', paired: true });
  const [reconnect, troubleshoot] = pane.security.actions.children;
  reconnect!.click();
  troubleshoot!.click();
  await settle();
  assert.deepEqual(pane.bridge.calls, ['disconnect', 'reconnect']);
  assert.deepEqual(pane.routed, ['settings/connection']);
});

test('connecting offers nothing to press', () => {
  const pane = mount();
  pane.view.setStatus({ phase: 'handshaking', paired: true });
  assert.equal(pane.security.card.dataset.state, 'connecting');
  assert.equal(pane.security.actions.children.length, 0);
  assert.equal(pane.security.actions.hidden, true);
});

test('Recent keeps its rows while the phone is away, and the caption says why nothing new arrives', () => {
  const pane = mount();
  pane.view.setStatus({ phase: 'connected', paired: true });
  const live = pane.recentSub.textContent;
  pane.view.setStatus({ phase: 'idle', paired: true });
  assert.notEqual(pane.recentSub.textContent, live);
  assert.match(pane.recentSub.textContent, /away/);
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
    assert.equal(cell.querySelector('.vital-fill'), null);
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
  const a = never.ringRow.children[0].querySelector('.vital-caption').textContent;
  const b = cannot.ringRow.children[0].querySelector('.vital-caption').textContent;
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
  assert.notEqual(battery.querySelector('.vital-fill'), null);
  assert.equal(battery.querySelector('.vital-value').textContent, '72%');
  assert.equal(battery.querySelector('.vital-caption').textContent, 'Charging');
  // Free space everywhere (component 14): the value is what is free, the caption the capacity.
  assert.equal(storage.querySelector('.vital-value').textContent, '41.2 GB');
  assert.equal(storage.querySelector('.vital-caption').textContent, 'free of 511 GB · 8%');
});

test('O4 — a low battery is toned differently from a healthy one', () => {
  const low = mount();
  (low.view as unknown as Vitals).setVitals({ level: 5, charging: false, capacityUnknown: false }, null);
  assert.equal(low.ringRow.children[0].dataset.tone, 'low');
});

// ---- N-M5 / N-M6, the native-macOS pass: motion that has something to travel from ---------------

/**
 * A frame clock the test owns. The view waits two frames before releasing a start value; holding
 * them lets a test read the start value, which is the only place these two defects are visible —
 * the end state was always correct.
 */
function holdFrames(): { flush(): void; release(): void } {
  const g = globalThis as Record<string, unknown>;
  const queue: Array<() => void> = [];
  g.requestAnimationFrame = (fn: () => void) => queue.push(fn);
  return {
    flush() {
      while (queue.length) queue.shift()!();
    },
    release() {
      delete g.requestAnimationFrame;
    },
  };
}

test('N-M5 — a new reading starts where the last one was, so the bar travels', () => {
  // The defect: the row is rebuilt on every update, and the old ring arc was born at its final value
  // each time, so its transition had nothing to move from. It never animated, for as long as it existed.
  const frames = holdFrames();
  try {
    const pane = mount();
    const vitals = pane.view as unknown as Vitals;
    vitals.setVitals({ level: 72, charging: true, capacityUnknown: false }, null);
    frames.flush();
    vitals.setVitals({ level: 50, charging: true, capacityUnknown: false }, null);
    const fill = pane.ringRow.children[0].querySelector('.vital-fill');
    assert.equal(fill.style.transform, 'scaleX(0.72)', 'starts from the previous reading');
    frames.flush();
    assert.equal(fill.style.transform, 'scaleX(0.5)', 'and arrives at the new one');
  } finally {
    frames.release();
  }
});

test('N-M6 — only a row that was not on screen before arrives; first paint is still', async () => {
  // Keyed on `seq`. Keyed on index, every row reads as new and the card animates all five on every event.
  const frames = holdFrames();
  try {
    const pane = mount([1, 2, 3].map((n) => event(n)));
    await pane.view.refresh();
    assert.equal(pane.recent.queryAll('.recent-row').length, 3, 'control: three rows drawn');
    assert.equal(pane.recent.queryAll('.is-arriving').length, 0, 'first paint does not animate');
    frames.flush();

    pane.bridge.events = [1, 2, 3, 4].map((n) => event(n));
    await pane.view.refresh();
    const arriving = pane.recent.queryAll('.is-arriving');
    assert.equal(arriving.length, 1, 'one new event, one arriving row');
    assert.equal(arriving[0].dataset.seq, '4');
    frames.flush();
    assert.equal(pane.recent.queryAll('.is-arriving').length, 0, 'released after two frames');
  } finally {
    frames.release();
  }
});
