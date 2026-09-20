import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import '../shared/filesRoots';
import './icons';
import './stateBlock';
import './files';

/**
 * The Files pane's **view class**, driven for real — the first entry off the renderer-view debt
 * list, and the reason that list exists.
 *
 * ### What broke, twice, in opposite directions
 *
 * The `Download` wall has two homes: inside the state card when the pane has at most one root, and
 * as a line in the rail otherwise. Slice 7 drew it in the wrong one; slice 9 drew it in the *other*
 * wrong one, when a second grant-free root made `roots.length > 1` permanently true and the state
 * card stopped being drawn at all. Both shipped green.
 *
 * The fix put the decision in `shared/filesRoots.ts` — `downloadWallHome` answers one value and
 * `wallHomeVisibility` turns it into two complementary flags — and `filesRoots.test.ts` asserts
 * exactly one is true. **That is a test of the rule, not of the drawing.** Four tests went red on
 * the mutation that broke it the second time, and none of them touched the renderer. This file is
 * the half that was missing: it asserts the wall is *on screen exactly once*, in every state the
 * pane can be in, by reading the elements the pane actually wrote to.
 *
 * The DOM is the double; `domDouble.testkit.ts` says which half that leaves unmeasured.
 */

type RootRow = { rootId: string; label: string; kind: string; writable: boolean; freeBytes: number | null };

const TREE: RootRow = { rootId: 'saf:DCIM', label: 'DCIM', kind: 'tree', writable: true, freeBytes: 1e10 };
const DOWNLOADS: RootRow = { rootId: 'downloads:connectsuite', label: 'ConnectSuite', kind: 'downloads', writable: true, freeBytes: 1e10 };
const APP: RootRow = { rootId: 'app:files', label: 'App files', kind: 'app', writable: true, freeBytes: 1e10 };

class FakeBridge {
  roots: RootRow[] = [];
  grantHint: string | null = null;
  push: boolean | undefined = true;
  rootsResult: { ok: boolean; data?: unknown; reason?: string; code?: string } | null = null;
  entries: unknown[] = [];
  listOk = true;
  readonly calls: string[] = [];

  async fsRoots() {
    this.calls.push('fsRoots');
    if (this.rootsResult) return this.rootsResult as never;
    return {
      ok: true as const,
      data: { roots: this.roots, grantHint: this.grantHint, push: this.push },
    };
  }
  async fsList() {
    this.calls.push('fsList');
    if (!this.listOk) return { ok: false as const, reason: 'fs.list timed out', code: 'TIMEOUT' };
    return { ok: true as const, data: { entries: this.entries, hasMore: false } };
  }
  async fsPush() {
    return { ok: true as const, bytes: 1 };
  }
  async fsPull() {
    return { ok: true as const, path: '/tmp/x' };
  }
  fsDrag() {
    /* nothing to do in a double */
  }
  async fsThumbs() {
    return { ok: true as const, data: { thumbs: [] } };
  }
}

interface Pane {
  bridge: FakeBridge;
  banner: FakeElement;
  rail: FakeElement;
  hint: FakeElement;
  wall: FakeElement;
  crumbs: FakeElement;
  state: FakeElement;
  table: FakeElement;
  footer: FakeElement;
  drop: FakeElement;
  detail: FakeElement;
  view: { refresh(): Promise<void>; setAdvertised(on: boolean, reason: string | null): void };
  restore: () => void;
}

function mount(): Pane {
  const fake = installFakeDocument();
  const bridge = new FakeBridge();
  const parts = {
    banner: el('div'),
    rail: el('div'),
    hint: el('div'),
    wall: el('p'),
    crumbs: el('div'),
    state: el('div'),
    table: el('div'),
    footer: el('div'),
    drop: el('div'),
    detail: el('div'),
  };
  const View = (globalThis as Record<string, unknown>).FilesView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(
    bridge,
    parts.banner,
    parts.rail,
    parts.hint,
    parts.wall,
    parts.crumbs,
    parts.state,
    parts.table,
    parts.footer,
    parts.drop,
    parts.detail,
  );
  return { bridge, ...parts, view, restore: fake.restore };
}

/**
 * Where the `Download` wall is actually on screen, counted from the drawn tree.
 *
 * Not from `downloadWallHome` — asking the rule where it put the wall is asking the thing under
 * test to describe itself, which is the model-instead-of-call fault. This reads the two elements the
 * pane writes to.
 */
function wallHomes(pane: Pane): { railLine: boolean; stateCard: boolean } {
  const railLine = !pane.wall.hidden && pane.wall.textContent.length > 0;
  const stateCard =
    !pane.state.hidden &&
    pane.state
      .queryAll('.files-state-body')
      .some((p) => p.textContent.toLowerCase().includes('download'));
  return { railLine, stateCard };
}

/**
 * Every state the pane can reach, with what the wall should do in it.
 *
 * `expectWall: true` means *on screen exactly once*; `false` means *deliberately absent*.
 *
 * **The two `false` rows were a surprise and are the useful part of this file.**
 * `wallHomeVisibility` answers `stateCard: true` for M4 and M5 — and those two cards' bodies carry
 * no wall copy at all, so the wall is on screen **zero** times there. That is correct behaviour:
 * when the pane could not load, or the phone is not offering Files, the user's problem is the
 * failure and not a note about which folder Android refuses to share. But it means
 * `wallHomeVisibility` is a claim about **which container the wall would live in**, not a claim
 * that a wall is drawn — and reading it as the second is exactly how somebody would conclude the
 * wall is covered in five states when it appears in three.
 *
 * Measured before it was asserted, by evaluating `filesPaneView` over all five inputs:
 *
 * ```
 * unavailable        id=M5 shared=0 home=state-card bodyMentionsDownload=false
 * ready 0 roots      id=M2 shared=0 home=state-card bodyMentionsDownload=true
 * ready 2 grant-free id=M2 shared=0 home=state-card bodyMentionsDownload=true
 * ready with a tree  id=M3 shared=1 home=rail-line  bodyMentionsDownload=true
 * failed             id=M4 shared=0 home=state-card bodyMentionsDownload=false
 * ```
 */
const WALL_STATES: { name: string; expectWall: boolean; setup: (pane: Pane) => Promise<void> }[] = [
  {
    name: 'M5 — unavailable, the phone is not offering files',
    expectWall: false,
    setup: async (pane) => {
      pane.view.setAdvertised(false, 'Storage permission is off on the phone.');
    },
  },
  {
    name: 'M2 — ready with no granted folders at all',
    expectWall: true,
    setup: async (pane) => {
      pane.view.setAdvertised(true, null);
      pane.bridge.roots = [];
      await pane.view.refresh();
    },
  },
  {
    name: 'M2 — ready with only the two grant-free roots (the slice-9 break)',
    expectWall: true,
    setup: async (pane) => {
      pane.view.setAdvertised(true, null);
      pane.bridge.roots = [DOWNLOADS, APP];
      await pane.view.refresh();
    },
  },
  {
    name: 'M3 — ready with a granted tree',
    expectWall: true,
    setup: async (pane) => {
      pane.view.setAdvertised(true, null);
      pane.bridge.roots = [DOWNLOADS, APP, TREE];
      await pane.view.refresh();
    },
  },
  {
    name: 'M4 — the roots fetch failed',
    expectWall: false,
    setup: async (pane) => {
      pane.view.setAdvertised(true, null);
      pane.bridge.rootsResult = { ok: false, reason: 'fs.list timed out after 10000ms', code: 'TIMEOUT' };
      await pane.view.refresh();
    },
  },
];

test('the Download wall has exactly one home wherever it is drawn, and none where it should not be', async () => {
  // The regression that broke twice, asserted over the whole state space rather than the one state
  // somebody happened to be looking at. Slice 7 and slice 9 each had a state where this holds and a
  // state where it does not, which is why one screenshot could not have caught either.
  //
  // The two `expectWall: false` rows are asserted as firmly as the three `true` ones: a change that
  // starts drawing the wall over a failed fetch is a regression in the other direction, and this is
  // what would catch it.
  for (const scenario of WALL_STATES) {
    const pane = mount();
    try {
      await scenario.setup(pane);
      const homes = wallHomes(pane);
      const count = Number(homes.railLine) + Number(homes.stateCard);
      assert.equal(
        count,
        scenario.expectWall ? 1 : 0,
        `${scenario.name}: the wall is on screen ${count} time(s), expected ` +
          `${scenario.expectWall ? 1 : 0} — railLine=${homes.railLine} stateCard=${homes.stateCard}`,
      );
    } finally {
      pane.restore();
    }
  }
});

test('control — the wall detector can see a wall, so its zeroes mean something', async () => {
  // Without this, a `wallHomes` that always returned false would pass both `expectWall: false` rows
  // and, worse, would make the three `true` rows the only thing keeping it honest.
  const pane = mount();
  try {
    pane.view.setAdvertised(true, null);
    pane.bridge.roots = [DOWNLOADS, APP, TREE];
    await pane.view.refresh();
    assert.equal(wallHomes(pane).railLine, true, 'the rail-line home is detectable');
    assert.ok(pane.wall.textContent.length > 20, 'and it has the wall copy in it');
  } finally {
    pane.restore();
  }
  const empty = mount();
  try {
    empty.view.setAdvertised(true, null);
    empty.bridge.roots = [];
    await empty.view.refresh();
    assert.equal(wallHomes(empty).stateCard, true, 'the state-card home is detectable too');
  } finally {
    empty.restore();
  }
});

test('the state card is drawn in the almost-empty states and not over a populated rail', async () => {
  // The slice-9 break in its own right: two grant-free roots made `roots.length > 1` permanently
  // true and the M2 card stopped being drawn — no headline, no guidance, on the one screen where
  // the user has done nothing yet.
  const empty = mount();
  try {
    empty.view.setAdvertised(true, null);
    empty.bridge.roots = [DOWNLOADS, APP];
    await empty.view.refresh();
    assert.equal(empty.state.hidden, false, 'a phone with nothing shared must still get a card');
    assert.ok(
      empty.state.queryAll('.files-state-headline').length === 1,
      'exactly one headline',
    );
  } finally {
    empty.restore();
  }

  const populated = mount();
  try {
    populated.view.setAdvertised(true, null);
    populated.bridge.roots = [DOWNLOADS, APP, TREE];
    await populated.view.refresh();
    assert.equal(populated.state.hidden, true, 'a populated rail needs no state card');
    assert.equal(wallHomes(populated).railLine, true, 'and the wall moves to its other home');
  } finally {
    populated.restore();
  }
});

test('empty and failed are visibly different — four ways, in the drawn tree', async () => {
  const empty = mount();
  const failed = mount();
  try {
    empty.view.setAdvertised(true, null);
    empty.bridge.roots = [];
    await empty.view.refresh();

    failed.view.setAdvertised(true, null);
    failed.bridge.rootsResult = { ok: false, reason: 'the phone did not answer', code: 'TIMEOUT' };
    await failed.view.refresh();

    const card = (pane: Pane) => pane.state.queryAll('.files-state-card')[0]!;
    assert.notEqual(card(empty).dataset.state, card(failed).dataset.state, 'different state ids');
    assert.notEqual(card(empty).className, card(failed).className, 'different tone class');
    assert.notEqual(
      empty.state.queryAll('.files-state-headline')[0]!.textContent,
      failed.state.queryAll('.files-state-headline')[0]!.textContent,
      'different headline',
    );
    assert.equal(empty.state.queryAll('.files-retry').length, 0, 'no retry on an empty pane');
    assert.equal(failed.state.queryAll('.files-retry').length, 1, 'a retry on a failed one');
    assert.ok(
      failed.state.queryAll('.files-state-code')[0]!.textContent.includes('TIMEOUT'),
      'the phone’s code reaches the user — diagnosable beats tidy',
    );
  } finally {
    empty.restore();
    failed.restore();
  }
});

test('the drop tile appears only when the phone says it will receive files', async () => {
  // Never a constant and never a guess: a phone built before push shipped omits the field, and an
  // absent field must read as false or the tile appears over a phone that answers FEATURE_UNAVAILABLE.
  for (const [push, expected] of [
    [true, false],
    [false, true],
    [undefined, true],
  ] as const) {
    const pane = mount();
    try {
      pane.view.setAdvertised(true, null);
      pane.bridge.roots = [DOWNLOADS, TREE];
      pane.bridge.push = push;
      await pane.view.refresh();
      assert.equal(
        pane.drop.hidden,
        expected,
        `push=${String(push)} must leave the drop tile ${expected ? 'hidden' : 'shown'}`,
      );
    } finally {
      pane.restore();
    }
  }
});

test('an unavailable pane shows the phone’s own sentence and no drop tile', async () => {
  const pane = mount();
  try {
    pane.view.setAdvertised(false, 'Storage permission is off on the phone.');
    assert.equal(pane.drop.hidden, true, 'nothing to drop onto a phone that is not offering files');
    assert.ok(
      pane.state.textContent.includes('Storage permission is off on the phone.'),
      'the phone knows which grant is missing and this side does not — so it is quoted verbatim',
    );
  } finally {
    pane.restore();
  }
});

test('two refreshes at once join the run in flight — the race that produced the empty table', async () => {
  // A route opening and a capability arriving both called refresh() within a frame; one listed 28
  // entries and the other reset the listing underneath it and timed out, and the pane settled on an
  // empty table with no error — the one outcome the tagged union was built to make impossible.
  const pane = mount();
  try {
    pane.view.setAdvertised(true, null);
    pane.bridge.roots = [DOWNLOADS, TREE];
    await Promise.all([pane.view.refresh(), pane.view.refresh(), pane.view.refresh()]);
    assert.equal(
      pane.bridge.calls.filter((c) => c === 'fsRoots').length,
      1,
      'the second and third callers joined rather than starting another run',
    );
  } finally {
    pane.restore();
  }
});

test('control — the harness can see a rail row, so an absence above means something', async () => {
  const pane = mount();
  try {
    pane.view.setAdvertised(true, null);
    pane.bridge.roots = [DOWNLOADS, APP, TREE];
    await pane.view.refresh();
    assert.equal(pane.rail.queryAll('.files-root').length, 3, 'three roots, three rows');
    assert.deepEqual(
      pane.rail.queryAll('.files-root-name').map((n) => n.textContent),
      ['ConnectSuite', 'App files', 'DCIM'],
      'and the labels are the phone’s, in the phone’s order',
    );
  } finally {
    pane.restore();
  }
});
