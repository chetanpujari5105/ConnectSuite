import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
import './icons';
import './stateBlock';
import './photos';

/**
 * The photos pane's view class, driven for real.
 *
 * Its debt-list reason was *"the grid paged and measured through `probe.mjs`; no view-level test
 * yet"*, and the probe reading stays the stronger evidence for the **grid** — 33 pages over 16,369
 * items, with 6 of 32 boundaries landing inside a tie group. Nothing in a double can produce that.
 *
 * What this covers is the half the probe could not isolate, and every one of these was a real
 * defect first:
 *
 *  - the **cursor** is the last row echoed back untouched, `before` *and* `beforeId`. Rebuilding it
 *    from anything else starts skipping the rows that share a second — a burst on a camera roll,
 *    which makes it certain rather than unlucky;
 *  - the scroll trigger requires **something to scroll**. A grid shorter than its own viewport
 *    satisfies "near the bottom" permanently, and the first version fetched page after page with
 *    `scrollTop` at 0 — 240 tiles became 360 while nobody touched it;
 *  - `loading` clears **after** the state is updated. Clearing it first left a window in which a
 *    scroll started a second fetch with the same cursor, and the page came back twice;
 *  - a repeat is **counted and warned about**, never silently dropped. A repeat is exactly what a
 *    broken cursor looks like, and a pane that de-duplicated in silence would hide it.
 */

type Bucket = { bucketId: string; bucketName: string; count: number; newestMs: number; coverId: string };
type Item = { id: string; dateMs: number; mimeType: string; width: number; height: number; durationMs?: number };

class FakeBridge {
  buckets: Bucket[] = [];
  bucketsFail: { reason: string; fixHint?: string } | null = null;
  /** Pages handed out in order, so a cursor can be checked against what was asked for. */
  pages: { items: Item[]; hasMore: boolean }[] = [];
  readonly listCalls: { bucketId?: string; before?: number; beforeId?: string }[] = [];
  readonly thumbCalls: string[][] = [];
  thumbs: Array<[string, string]> = [];
  originals: { path: string; bytes: number; elapsedMs: number } | null = null;

  async mediaBuckets() {
    if (this.bucketsFail) return { ok: false as const, ...this.bucketsFail };
    return { ok: true as const, data: this.buckets };
  }
  async mediaList(options: { bucketId?: string; before?: number; beforeId?: string }) {
    this.listCalls.push({ ...options });
    const page = this.pages.shift() ?? { items: [], hasMore: false };
    return { ok: true as const, data: page };
  }
  async mediaThumbs(options: { ids: string[] }) {
    this.thumbCalls.push(options.ids);
    return { ok: true as const, data: this.thumbs };
  }
  async mediaOriginal() {
    if (!this.originals) return { ok: false as const, reason: 'no' };
    return { ok: true as const, data: this.originals };
  }
}

installFakeDocument();
installFakeWindow();

interface Pane {
  bridge: FakeBridge;
  card: FakeElement;
  banner: FakeElement;
  note: FakeElement;
  rail: FakeElement;
  tiles: FakeElement;
  detail: FakeElement;
  view: { setAdvertised(on: boolean): void; refresh(): Promise<void> };
}

function mount(): Pane {
  const bridge = new FakeBridge();
  const parts = {
    card: el('div'),
    banner: el('div'),
    note: el('p'),
    rail: el('div'),
    tiles: el('div'),
    detail: el('aside'),
  };
  const View = (globalThis as Record<string, unknown>).PhotosView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    bridge,
    parts.card,
    parts.banner,
    parts.note,
    parts.rail,
    parts.tiles,
    parts.detail,
  );
  return { bridge, ...parts, view };
}

const item = (id: string, dateMs: number): Item => ({
  id,
  dateMs,
  mimeType: 'image/jpeg',
  width: 4000,
  height: 3000,
});
const bucket = (id: string, count: number): Bucket => ({
  bucketId: id,
  bucketName: `Album ${id}`,
  count,
  newestMs: 2_000,
  coverId: `${id}-cover`,
});

// ---- The cursor ----------------------------------------------------------------------------------

test('the cursor is the last row echoed back untouched — both fields', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 3)];
  // Two items sharing a second: the exact shape a burst produces, and the reason `beforeId` exists.
  pane.bridge.pages = [
    { items: [item('c', 1000), item('b', 1000)], hasMore: true },
    { items: [item('a', 900)], hasMore: false },
  ];
  await pane.view.refresh();

  assert.equal(pane.bridge.listCalls.length, 1, 'control: one page has been asked for');
  assert.deepEqual(pane.bridge.listCalls[0].before, undefined, 'the first page carries no cursor');

  // Force the second page the way the scroll would, through the pane's own trigger.
  pane.tiles.scrollHeight = 2000;
  pane.tiles.clientHeight = 500;
  pane.tiles.scrollTop = 1600;
  pane.tiles.dispatch('scroll');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(pane.bridge.listCalls.length, 2);
  // Rounding this, or rebuilding it from anything but the row the phone sent, is how a boundary
  // starts skipping the rows that share a second with it.
  assert.equal(pane.bridge.listCalls[1].before, 1000);
  assert.equal(pane.bridge.listCalls[1].beforeId, 'b');
});

test('a grid with nothing to scroll does not page itself forever', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 100)];
  pane.bridge.pages = [{ items: [item('a', 1000)], hasMore: true }];
  await pane.view.refresh();
  assert.equal(pane.bridge.listCalls.length, 1, 'control: the first page was fetched');

  // `scrollTop + clientHeight >= scrollHeight - 400` is true the moment a short pane opens. The
  // first version had only that, and 240 tiles became 360 while nobody touched it.
  pane.tiles.scrollHeight = 300;
  pane.tiles.clientHeight = 300;
  pane.tiles.scrollTop = 0;
  pane.tiles.dispatch('scroll');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pane.bridge.listCalls.length, 1, 'a scroll trigger must require something to scroll');
});

test('a repeated id is counted and warned about, never silently dropped', async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (line: string) => warnings.push(line);
  try {
    const pane = mount();
    pane.bridge.buckets = [bucket('camera', 3)];
    pane.bridge.pages = [
      { items: [item('a', 1000)], hasMore: true },
      { items: [item('a', 1000), item('b', 900)], hasMore: false },
    ];
    await pane.view.refresh();
    pane.tiles.scrollHeight = 2000;
    pane.tiles.clientHeight = 500;
    pane.tiles.scrollTop = 1600;
    pane.tiles.dispatch('scroll');
    await new Promise((r) => setTimeout(r, 0));

    // Drawn once — but the point is the line, not the de-duplication. A repeat is exactly what a
    // broken cursor looks like, and a pane that de-duplicated in silence would hide it.
    assert.equal(pane.tiles.queryAll('.photos-tile').length, 2);
    assert.equal(warnings.length, 1, 'the repeat was dropped without a word');
    assert.match(warnings[0], /1 ids already held/);
    assert.match(warnings[0], /2 distinct drawn/);
  } finally {
    console.warn = realWarn;
  }
});

// ---- The states ----------------------------------------------------------------------------------

test('a refused fetch replaces the grid; a partial capability sits above a working one', async () => {
  const refused = mount();
  refused.bridge.bucketsFail = { reason: 'Photos permission is not granted.', fixHint: 'Grant it on the phone.' };
  await refused.view.refresh();
  assert.equal(refused.banner.hidden, false);
  assert.match(refused.banner.textContent, /not sharing its photos/);
  assert.match(refused.banner.textContent, /Photos permission is not granted/);
  assert.match(refused.banner.textContent, /Grant it on the phone/);
  // The grid is gone, because a refusal is about the whole pane.
  assert.equal(refused.tiles.queryAll('.photos-tile').length, 0);

  // Not advertised is **partial**, not refused: the three read verbs answer either way and what the
  // capability decides is whether full-size originals work. So the notice sits above a grid that
  // still draws — which is the distinction P5 exists for.
  const partial = mount();
  partial.bridge.buckets = [bucket('camera', 1)];
  partial.bridge.pages = [{ items: [item('a', 1000)], hasMore: false }];
  await partial.view.refresh();
  assert.equal(partial.banner.hidden, false, 'control: a notice is drawn while unadvertised');
  assert.equal(partial.tiles.queryAll('.photos-tile').length, 1, 'the grid still works');
  assert.ok(!partial.banner.textContent.includes('not sharing its photos'));
});

test('a full capability says nothing about itself at all', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 1)];
  pane.bridge.pages = [{ items: [item('a', 1000)], hasMore: false }];
  pane.view.setAdvertised(true);
  await pane.view.refresh();
  // No banner. There is nothing left to explain, and a pane that narrated its own health in the
  // healthy case would train people to ignore the line that matters.
  assert.equal(pane.banner.hidden, true);
});

test('an empty album is a different sentence from a pane with no feature', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 0)];
  pane.bridge.pages = [{ items: [], hasMore: false }];
  pane.view.setAdvertised(true);
  await pane.view.refresh();
  assert.equal(pane.tiles.queryAll('.photos-empty').length, 1);
  assert.equal(pane.banner.hidden, true, 'an empty album is not a broken pane');
});

// ---- The rail ------------------------------------------------------------------------------------

test('All photos is a synthetic album whose count is the sum, and it leads', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 120), bucket('screenshots', 30)];
  pane.bridge.pages = [{ items: [], hasMore: false }];
  await pane.view.refresh();

  const names = pane.rail.queryAll('.photos-album-name').map((n) => n.textContent);
  assert.deepEqual(names, ['All photos', 'Album camera', 'Album screenshots']);
  // The count is the denominator a page-by-page fetch has to sum to — it is the only number that
  // can tell a working pager from one that stalls after its first page.
  assert.match(pane.rail.textContent, /150/);
});

test('no albums means no synthetic All photos row', async () => {
  const pane = mount();
  pane.bridge.buckets = [];
  await pane.view.refresh();
  // The control on the test above: an "All photos" row over an empty phone would be an album that
  // does not exist, with a count of zero, at the top of an empty rail.
  assert.equal(pane.rail.queryAll('.photos-album-name').length, 0);
});

// ---- Thumbnails ----------------------------------------------------------------------------------

test('thumbnails are asked for once per page, for that page’s ids', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 2)];
  pane.bridge.pages = [{ items: [item('a', 1000), item('b', 900)], hasMore: false }];
  await pane.view.refresh();
  assert.deepEqual(pane.bridge.thumbCalls, [['a', 'b']]);
});

// ---- Defect 88: the shape the fix rests on --------------------------------------------------------

/**
 * The tiles live inside a `.photos-grid` inside a `.photos-group` inside the scroller — never as
 * direct children of the scroller itself.
 *
 * **This test would not have caught defect 88 and it is important to say so.** The defect was two
 * CSS declarations in one rule; a DOM double has no layout, so a grid whose rows have collapsed and
 * a grid whose rows are correct produce the identical tree. `stylesheets.test.ts` is where that
 * check lives, because that is the only file in the repo that can see a stylesheet.
 *
 * What this covers is the *other half* of the same fix: the structure the CSS now assumes. If the
 * grouping is ever flattened back to tiles-under-the-scroller, `.photos-grid` stops existing, every
 * tile becomes a child of an element with `max-height` and no `display: grid`, and the pane silently
 * reverts to a single column. That is reachable from here, and it is the half a stylesheet check
 * cannot see.
 */
test('tiles are grouped by day, inside a grid that is not the scroller', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 3)];
  // Anchored to **local midnight**, not to `now - N hours`. The first version used hours-ago and
  // went red on its own control at 01:44, because "one hour ago" and "two hours ago" straddled
  // midnight and produced three groups. A test whose result depends on the hour the suite runs at
  // is a test that will be green on the machine that wrote it and red at 00:30 on somebody else's.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const todayAt = (h: number) => new Date(midnight).setHours(h);
  const daysBack = (d: number) => new Date(midnight).setDate(midnight.getDate() - d);
  pane.bridge.pages = [
    {
      items: [
        item('a', todayAt(11)),
        item('b', todayAt(9)),
        // Far enough back to be a different heading whatever day of the week the suite runs on.
        item('c', daysBack(40)),
      ],
      hasMore: false,
    },
  ];
  await pane.view.refresh();

  const groups = pane.tiles.queryAll('.photos-group');
  assert.equal(groups.length, 2, 'control: three items across two days made two groups');
  assert.equal(groups[0]!.queryAll('.photos-group-title').length, 1, 'a group has one heading');

  // The load-bearing assertion: every tile has a `.photos-grid` parent, and the scroller has none
  // of its own.
  const grids = pane.tiles.queryAll('.photos-grid');
  assert.equal(grids.length, 2, 'one grid per day-group');
  const tilesInGrids = grids.reduce((n, g) => n + g.queryAll('.photos-tile').length, 0);
  assert.equal(tilesInGrids, 3, 'every tile sits inside a grid');
  assert.equal(
    pane.tiles.children.every((child) => child.className.includes('photos-group')),
    true,
    'the scroller holds only groups — a tile directly under it is defect 88 coming back',
  );
});

test('an album with nothing in it draws no groups and no grids at all', async () => {
  // The control for the test above: it must be able to see zero, or "two groups" says nothing.
  const pane = mount();
  pane.bridge.buckets = [bucket('empty', 0)];
  pane.bridge.pages = [{ items: [], hasMore: false }];
  await pane.view.refresh();
  assert.equal(pane.tiles.queryAll('.photos-group').length, 0);
  assert.equal(pane.tiles.queryAll('.photos-grid').length, 0);
  assert.equal(pane.tiles.queryAll('.photos-empty').length, 1, 'and the empty sentence is drawn');
});

// ---- A page is appended, not the whole grid rebuilt ----------------------------------------------
//
// Measured by the overnight UI harness (2026-10-06, synthetic 6,000-photo roll, this Mac): every page
// rebuilt every tile already drawn — twice, once for the page and once when its thumbnails arrived —
// so the 31st page cost 417 ms with a 336 ms main-thread block, growing linearly with the scroll.
// Selecting a tile rebuilt the grid too. These pin the incremental path and, as the control that it
// draws the same thing, compare it with a full draw of the same items in one page.

function walk(node: FakeElement, out: FakeElement[] = []): FakeElement[] {
  for (const child of node.children) {
    out.push(child);
    walk(child, out);
  }
  return out;
}
const tilesOf = (pane: Pane) =>
  walk(pane.tiles).filter((e) => (e.className ?? '').split(' ').includes('photos-tile'));
const headingsOf = (pane: Pane) =>
  walk(pane.tiles).filter((e) => e.className === 'photos-group-title').map((e) => e.textContent);
const scrollToBottom = async (pane: Pane) => {
  pane.tiles.scrollHeight = 2000;
  pane.tiles.clientHeight = 500;
  pane.tiles.scrollTop = 1600;
  pane.tiles.dispatch('scroll');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const DAY = 86_400_000;
const noon = (daysAgo: number, minute = 0) => {
  const d = new Date();
  d.setHours(12, minute, 0, 0);
  return d.getTime() - daysAgo * DAY;
};

test('a second page is appended: the first page’s tiles stay, and the grid matches a full draw', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 5)];
  // The page boundary falls inside one day, so the append has to join that day's grid.
  pane.bridge.pages = [
    { items: [item('a', noon(3, 30)), item('b', noon(3, 20))], hasMore: true },
    { items: [item('c', noon(3, 10)), item('d', noon(5)), item('e', noon(6))], hasMore: false },
  ];
  await pane.view.refresh();
  const first = new Map(tilesOf(pane).map((t) => [t.dataset.id, t]));
  assert.deepEqual([...first.keys()], ['a', 'b'], 'control: the first page is drawn');

  await scrollToBottom(pane);
  const after = tilesOf(pane);
  assert.deepEqual(after.map((t) => t.dataset.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(after[0], first.get('a'), 'tile a was rebuilt by the second page');
  assert.equal(after[1], first.get('b'), 'tile b was rebuilt by the second page');

  // The control: one page holding all five draws the same headings in the same order.
  const whole = mount();
  whole.bridge.buckets = [bucket('camera', 5)];
  whole.bridge.pages = [{ items: ['a', 'b', 'c', 'd', 'e'].map((id, i) => item(id, [noon(3, 30), noon(3, 20), noon(3, 10), noon(5), noon(6)][i]!)), hasMore: false }];
  await whole.view.refresh();
  assert.deepEqual(headingsOf(pane), headingsOf(whole), 'the appended grid is grouped differently from a full draw');
  assert.equal(headingsOf(pane).length, 3, 'control: three days, three headings');
});

test('thumbnails arriving fill the tiles already drawn, in place', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 2)];
  pane.bridge.pages = [
    { items: [item('a', noon(1))], hasMore: true },
    { items: [item('b', noon(2))], hasMore: false },
  ];
  await pane.view.refresh();
  const a = tilesOf(pane)[0]!;
  assert.ok(walk(a).some((e) => e.className === 'photos-thumb-pending'), 'control: no thumbnail yet');
  pane.bridge.thumbs = [['a', 'QUFBQQ=='], ['b', 'QkJCQg==']];
  await scrollToBottom(pane);
  const [a2, b2] = tilesOf(pane);
  assert.equal(a2, a, 'tile a was rebuilt when thumbnails arrived');
  assert.ok(walk(a2!).some((e) => e.tagName.toUpperCase() === 'IMG'), 'tile a never got its thumbnail');
  assert.ok(walk(b2!).some((e) => e.tagName.toUpperCase() === 'IMG'), 'tile b never got its thumbnail');
  assert.ok(!walk(a2!).some((e) => e.className === 'photos-thumb-pending'), 'the placeholder stayed beside the image');
});

test('selecting a tile moves the highlight without rebuilding the grid', async () => {
  const pane = mount();
  pane.bridge.buckets = [bucket('camera', 2)];
  pane.bridge.pages = [{ items: [item('a', noon(1)), item('b', noon(1, 5))], hasMore: false }];
  await pane.view.refresh();
  const [a, b] = tilesOf(pane);
  a!.click();
  b!.click();
  const [a2, b2] = tilesOf(pane);
  assert.equal(a2, a, 'selection rebuilt tile a');
  assert.equal(b2, b, 'selection rebuilt tile b');
  assert.ok(b2!.className.split(' ').includes('on'), 'the selected tile is not marked');
  assert.ok(!a2!.className.split(' ').includes('on'), 'the previous selection is still marked');
});
