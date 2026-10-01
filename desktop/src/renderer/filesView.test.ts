import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import '../shared/filesRoots';
import '../shared/sendBatch';
import '../shared/filesListing';
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
  /** Every send, in order — the assertion that nothing moved before Send is on this list. */
  readonly sent: string[] = [];
  /** How a send resolves. Each call takes the next; the default is a plain success. */
  sendResults: Array<{ ok: boolean; reason?: string; code?: string; sentAs?: string }> = [];
  /** Called when a send is agreed, so a test can play the phone's events against the right id. */
  onAgreed: ((source: string) => void) | null = null;
  async fsSend(options: { source: string }) {
    this.sent.push(options.source);
    this.onAgreed?.(options.source);
    return this.sendResults.shift() ?? { ok: true };
  }
  picked: Array<{ source: string; name: string; size: number }> = [];
  async fsPickSend() {
    return { ok: true as const, data: { files: this.picked, skipped: 0 } };
  }
  readonly cancelled: string[] = [];
  async fsCancel(options: { transferId: string }) {
    this.cancelled.push(options.transferId);
    return { ok: true };
  }
  pathForFile(file: { name: string; path?: string }) {
    return file.path ?? '';
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
  tools: FakeElement;
  view: {
    refresh(): Promise<void>;
    setAdvertised(on: boolean, reason: string | null): void;
    setPhoneName(name: string): void;
    pickAndOffer(): Promise<void>;
    onPushAgreed(agreed: { source: string; transferId: string; name: string }): void;
    onTransferEvent(envelope: unknown): void;
  };
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
    tools: el('div'),
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
    parts.tools,
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
      .queryAll('.state-body')
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
      empty.state.queryAll('.state-headline').length === 1,
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

    const card = (pane: Pane) => pane.state.queryAll('.state-block')[0]!;
    assert.notEqual(card(empty).dataset.state, card(failed).dataset.state, 'different state ids');
    /*
     * The tone is `data-tone` now, written by the component from the kind, rather than a class the
     * caller chose. That is a stronger assertion than the class string it replaces: a pane cannot
     * set it to anything, so `empty` and `error` cannot be made to agree by a caller's mistake.
     */
    assert.notEqual(card(empty).dataset.tone, card(failed).dataset.tone, 'different tone');
    assert.equal(card(empty).dataset.kind, 'empty');
    assert.equal(card(failed).dataset.kind, 'error');
    assert.notEqual(
      empty.state.queryAll('.state-headline')[0]!.textContent,
      failed.state.queryAll('.state-headline')[0]!.textContent,
      'different headline',
    );
    assert.equal(empty.state.queryAll('.state-action').length, 0, 'no retry on an empty pane');
    assert.equal(failed.state.queryAll('.state-action').length, 1, 'a retry on a failed one');
    assert.ok(
      failed.state.queryAll('.state-code')[0]!.textContent.includes('TIMEOUT'),
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

// ---- Feature B: Send to phone (2026-09-23) -------------------------------------------------------

/** The button that confirms or ends a send, found by its role in the card rather than a pixel. */
function cardButton(pane: Pane, label: string): FakeElement {
  const found = pane.detail.queryAll('button').filter((b) => b.textContent === label);
  assert.equal(found.length, 1, `exactly one "${label}" button on the send card`);
  return found[0]!;
}

async function readyToSend(pane: Pane, roots: RootRow[] = [DOWNLOADS, TREE]): Promise<void> {
  pane.view.setAdvertised(true, null);
  pane.bridge.roots = roots;
  pane.bridge.push = true;
  pane.view.setPhoneName('Samsung SM-S938B');
  await pane.view.refresh();
}

test('picking files sends nothing until Send is pressed, and the card names phone and folder', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [
      { source: '/m/a.jpg', name: 'a.jpg', size: 2048 },
      { source: '/m/b.pdf', name: 'b.pdf', size: 4096 },
    ];
    await pane.view.pickAndOffer();
    assert.deepEqual(pane.bridge.sent, [], 'a confirmation, not a send');
    const text = pane.detail.textContent;
    assert.ok(text.includes('Send 2 files to Samsung SM-S938B?'), text);
    assert.ok(text.includes('DCIM'), 'the destination is the folder open in the pane');
    assert.ok(text.includes('arrives as “name (2)”'), 'the collision rule is stated before sending');

    cardButton(pane, 'Cancel').click();
    assert.deepEqual(pane.bridge.sent, [], 'Cancel sends nothing');
    assert.equal(pane.detail.textContent.includes('Send 2 files'), false, 'and the card is gone');
  } finally {
    pane.restore();
  }
});

test('the bar and "arrived" come from the phone’s events, never from the Mac finishing its write', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [{ source: '/m/v.mov', name: 'v.mov', size: 1000 }];
    // The phone acks before the bytes move; the pane learns the id at that moment.
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: 't-1', name: 'v.mov' });
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(pane.bridge.sent, ['/m/v.mov']);
    const phaseOf = () => pane.detail.queryAll('.files-send-item')[0]!.dataset.phase;
    assert.equal(phaseOf(), 'confirming', 'the Mac has written; the phone has not answered');
    assert.equal(pane.detail.textContent.includes('arrived on'), false);

    pane.view.onTransferEvent({ type: 'fs.transfer.progress', payload: { transferId: 't-other', bytes: 900 } });
    const bar = pane.detail.queryAll('progress')[0]!;
    assert.equal((bar as unknown as { value: number }).value, 0, 'another transfer’s bytes move nothing');

    pane.view.onTransferEvent({
      type: 'fs.transfer.done',
      payload: { transferId: 't-1', ok: true, bytes: 1000, verified: true },
    });
    assert.equal(phaseOf(), 'arrived');
    assert.ok(pane.detail.textContent.includes('1 file arrived on Samsung SM-S938B'));
    assert.ok(pane.detail.textContent.includes('checksum matched'));
  } finally {
    pane.restore();
  }
});

test('a drop is an offer too, and a file with no path on disk is counted rather than sent', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.drop.dispatch('drop', {
      dataTransfer: {
        files: [
          { name: 'real.txt', size: 5, path: '/m/real.txt' },
          { name: 'from-a-browser.png', size: 9 },
        ],
      },
    });
    assert.deepEqual(pane.bridge.sent, [], 'dropping is not sending');
    const text = pane.detail.textContent;
    assert.ok(text.includes('Send 1 file to'), text);
    assert.ok(text.includes('1 item was left out'), 'the pathless file is named, not dropped silently');
  } finally {
    pane.restore();
  }
});

test('Send to phone… is drawn only where the drop tile is — push served and a writable folder', async () => {
  for (const [label, roots, push, expected] of [
    ['push served, writable', [DOWNLOADS, TREE], true, 1],
    ['push not served', [DOWNLOADS, TREE], false, 0],
    ['read-only folder', [{ ...TREE, writable: false }], true, 0],
  ] as const) {
    const pane = mount();
    try {
      pane.view.setAdvertised(true, null);
      pane.bridge.roots = roots as RootRow[];
      pane.bridge.push = push;
      await pane.view.refresh();
      // The Send button specifically — the toolbar also holds sort and view controls now.
      const send = pane.tools.queryAll('.files-send-button');
      assert.equal(send.length, 1, 'built once, shown or hidden');
      assert.equal(send[0]!.hidden ? 0 : 1, expected, label);
      assert.equal(pane.drop.hidden, expected === 0, `${label}: the tile agrees with the button`);
    } finally {
      pane.restore();
    }
  }
});

test('Stop cancels every file in flight on the phone and starts nothing queued', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [1, 2, 3, 4, 5].map((n) => ({ source: `/m/${n}.bin`, name: `${n}.bin`, size: 10 }));
    const releases: Array<() => void> = [];
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: `t-${source}`, name: source.slice(3) });
    // Hold every send open so Stop lands while they are in flight.
    const original = pane.bridge.fsSend.bind(pane.bridge);
    pane.bridge.fsSend = async (options: { source: string }) => {
      const result = original(options);
      await new Promise<void>((r) => { releases.push(r); });
      return result;
    };
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/m/1.bin', '/m/2.bin', '/m/3.bin'], 'three in flight, two queued');
    cardButton(pane, 'Stop').click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.cancelled, ['t-/m/1.bin', 't-/m/2.bin', 't-/m/3.bin'], 'every live transfer is cancelled by id');
    for (const r of releases) r();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/m/1.bin', '/m/2.bin', '/m/3.bin'], 'the queued files never started');
    const phases = pane.detail.queryAll('.files-send-item').map((li) => li.dataset.phase);
    assert.deepEqual(phases.slice(3), ['cancelled', 'cancelled']);
  } finally {
    pane.restore();
  }
});

test('three sends at once: each finished write lets the next file start while the phone commits', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [1, 2, 3, 4, 5].map((n) => ({ source: `/m/${n}.bin`, name: `${n}.bin`, size: 10 }));
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: `t-${source}`, name: source.slice(3) });
    const releases: Array<() => void> = [];
    const original = pane.bridge.fsSend.bind(pane.bridge);
    pane.bridge.fsSend = async (options: { source: string }) => {
      const result = original(options);
      await new Promise<void>((r) => { releases.push(r); });
      return result;
    };
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/m/1.bin', '/m/2.bin', '/m/3.bin'], 'three writing, not the whole batch');
    releases.shift()!();
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    const phaseOf = (n: number) => pane.detail.queryAll('.files-send-item')[n]!.dataset.phase;
    assert.equal(phaseOf(0), 'confirming', 'the Mac wrote it; the phone has not answered');
    assert.deepEqual(pane.bridge.sent, ['/m/1.bin', '/m/2.bin', '/m/3.bin', '/m/4.bin'], 'its writing slot went to the fourth');
    while (releases.length) { releases.shift()!(); for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); }
    for (const n of [1, 2, 3, 4, 5]) {
      pane.view.onTransferEvent({ type: 'fs.transfer.done', payload: { transferId: `t-/m/${n}.bin`, ok: true, bytes: 10, verified: true } });
    }
    assert.ok(pane.detail.textContent.includes('5 files arrived on Samsung SM-S938B'), pane.detail.textContent);
  } finally {
    pane.restore();
  }
});

test('two files that could reach one name on the phone are never in flight together', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [
      { source: '/a/x.jpg', name: 'x.jpg', size: 10 },
      { source: '/b/X.JPG', name: 'X.JPG', size: 10 },
      { source: '/c/y.jpg', name: 'y.jpg', size: 10 },
    ];
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: `t-${source}`, name: source.slice(3) });
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/a/x.jpg', '/c/y.jpg'], 'X.JPG waits: the phone reuses a pending item of that name');
    pane.view.onTransferEvent({ type: 'fs.transfer.done', payload: { transferId: 't-/a/x.jpg', ok: true, bytes: 10, verified: true } });
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/a/x.jpg', '/c/y.jpg', '/b/X.JPG'], 'then it goes, and meets TARGET_STALE as an ordinary clash');
  } finally {
    pane.restore();
  }
});

test('Stop pressed before a file’s agreement arrives still cancels it once its id is known', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [{ source: '/m/1.bin', name: '1.bin', size: 10 }];
    let agree: (() => void) | null = null;
    pane.bridge.onAgreed = (source) => {
      agree = () => pane.view.onPushAgreed({ source, transferId: 't-late', name: '1.bin' });
    };
    const original = pane.bridge.fsSend.bind(pane.bridge);
    let release: (() => void) | null = null;
    pane.bridge.fsSend = async (options: { source: string }) => {
      const result = original(options);
      await new Promise<void>((r) => { release = r; });
      return result;
    };
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    await new Promise((r) => setImmediate(r));
    cardButton(pane, 'Stop').click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.cancelled, [], 'no id yet, nothing to name');
    agree!();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.cancelled, ['t-late'], 'the moment the phone names it, it is stopped');
    release!();
  } finally {
    pane.restore();
  }
});

test('Stop after the Mac has finished writing still cancels on the phone — the confirming gap', async () => {
  // Measured live on 2026-09-23: a 60 MB send was `confirming` at 866 ms with the phone reporting
  // 30%. The Mac's write finishes long before the phone has the bytes, so a Stop that looked only
  // for `sending` left the phone receiving a file the person had stopped.
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [{ source: '/m/big.bin', name: 'big.bin', size: 1000 }];
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: 't-big', name: 'big.bin' });
    await pane.view.pickAndOffer();
    cardButton(pane, 'Send').click();
    await new Promise((r) => setImmediate(r));
    pane.view.onTransferEvent({ type: 'fs.transfer.progress', payload: { transferId: 't-big', bytes: 300 } });
    const item = pane.detail.queryAll('.files-send-item')[0]!;
    assert.equal(item.dataset.phase, 'confirming', 'the write resolved; the phone is still counting');
    assert.ok(item.textContent.includes('on the phone'), 'the phone’s count is still drawn: ' + item.textContent);

    cardButton(pane, 'Stop').click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.cancelled, ['t-big']);
    pane.view.onTransferEvent({
      type: 'fs.transfer.done',
      payload: { transferId: 't-big', ok: false, code: 'TRANSFER_FAILED', message: 'cancelled' },
    });
    assert.equal(pane.detail.queryAll('.files-send-item')[0]!.dataset.phase, 'cancelled');
  } finally {
    pane.restore();
  }
});

// ---- Feature D: list/grid, sort, filter (2026-09-23) ---------------------------------------------

const D_ENTRIES = [
  { id: 'd1', name: 'Camera', dir: true, size: 0, mtimeMs: 5, mime: 'inode/directory' },
  { id: 'f1', name: 'IMG_10.jpg', dir: false, size: 300, mtimeMs: 1, mime: 'image/jpeg' },
  { id: 'f2', name: 'IMG_2.jpg', dir: false, size: 900, mtimeMs: 9, mime: 'image/jpeg' },
  { id: 'f3', name: 'report.pdf', dir: false, size: 10, mtimeMs: 3, mime: 'application/pdf' },
];

async function loaded(pane: Pane): Promise<void> {
  pane.view.setAdvertised(true, null);
  pane.bridge.roots = [TREE];
  pane.bridge.entries = D_ENTRIES;
  await pane.view.refresh();
}

const drawnNames = (pane: Pane) =>
  pane.table.queryAll('.files-row').filter((r) => !r.className.includes('files-row--head'))
    .map((r) => r.queryAll('.files-cell-name span')[1]!.textContent);

test('sorting reorders what is drawn, folders first, and the header column reverses it', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    assert.deepEqual(drawnNames(pane), ['Camera', 'IMG_2.jpg', 'IMG_10.jpg', 'report.pdf'], 'natural name order');
    const sizeHead = pane.table.queryAll('.files-head-sort')[2]!;
    sizeHead.click();
    assert.deepEqual(drawnNames(pane), ['Camera', 'report.pdf', 'IMG_10.jpg', 'IMG_2.jpg']);
    pane.table.queryAll('.files-head-sort')[2]!.click();
    assert.deepEqual(drawnNames(pane), ['Camera', 'IMG_2.jpg', 'IMG_10.jpg', 'report.pdf'], 'pressed again: largest first');
  } finally {
    pane.restore();
  }
});

test('a shift-click selects the range as drawn, not as the phone returned it', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    pane.table.queryAll('.files-head-sort')[2]!.click(); // size ascending: report, IMG_10, IMG_2
    const rows = () => pane.table.queryAll('.files-row').filter((r) => !r.className.includes('files-row--head'));
    rows()[1]!.dispatch('click'); // report.pdf
    rows()[3]!.dispatch('click', { shiftKey: true }); // IMG_2.jpg
    const selected = rows().filter((r) => r.className.includes('is-selected')).map((r) => r.queryAll('.files-cell-name span')[1]!.textContent);
    assert.deepEqual(selected, ['report.pdf', 'IMG_10.jpg', 'IMG_2.jpg']);
  } finally {
    pane.restore();
  }
});

test('grid tiles carry a real extension badge, and only images and videos are asked for a picture', async () => {
  const pane = mount();
  try {
    const asked: string[][] = [];
    pane.bridge.fsThumbs = (async (o: { ids: string[] }) => { asked.push(o.ids); return { ok: true, entries: [] }; }) as never;
    await loaded(pane);
    pane.tools.queryAll('.files-view-button')[1]!.click();
    assert.equal(pane.table.queryAll('.files-tile').length, 4);
    assert.deepEqual(pane.table.queryAll('.files-tile-badge').map((b) => b.textContent), ['JPG', 'JPG', 'PDF']);
    assert.deepEqual(asked, [['f2', 'f1']], 'one batch, the two images, in drawn order — never the PDF or the folder');
  } finally {
    pane.restore();
  }
});

test('a render inside the filter’s debounce does not erase what was just typed', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const search = pane.tools.queryAll('input')[0]! as unknown as FakeElement & { value: string };
    search.value = 'IMG';
    search.dispatch('input');
    // Something redraws before the debounce fires — here, the view toggle.
    pane.tools.queryAll('.files-view-button')[1]!.click();
    assert.equal(search.value, 'IMG', 'the typed text survives the redraw');
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(pane.table.queryAll('.files-tile').length, 2, 'and the filter it asked for is applied');
  } finally {
    pane.restore();
  }
});

test('a pull refused for an unavailable receive folder says what to do, not only what broke', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    pane.bridge.fsPull = (async () => ({
      ok: false,
      reason: 'The receive folder /Volumes/X is not available — it may have been moved, renamed, or be on a drive that is not connected.',
      fixHint: 'Choose another folder in Settings → File transfer, or reconnect the drive.',
    })) as never;
    const report = pane.table.queryAll('.files-row').find((r) => r.textContent.includes('report.pdf'))!;
    report.dispatch('click'); // select — the card that carries the status line describes this row
    report.dispatch('dblclick');
    await new Promise((r) => setImmediate(r));
    const text = pane.detail.textContent;
    assert.ok(text.includes('/Volumes/X is not available'), text);
    assert.ok(text.includes('Choose another folder in Settings → File transfer'), 'the fix hint reaches the pane');
  } finally {
    pane.restore();
  }
});

// ---- D review (2026-09-23): found live on the phone ----------------------------------------------

test('changing to another shared folder clears the filter — every root’s top level is path ""', async () => {
  const pane = mount();
  try {
    pane.view.setAdvertised(true, null);
    pane.bridge.roots = [DOWNLOADS, TREE];
    pane.bridge.entries = D_ENTRIES;
    await pane.view.refresh();
    const view = pane.view as unknown as { query: string; render(): void };
    view.query = 'IMG';
    view.render();
    const other = pane.rail.queryAll('.files-root').find((r) => r.textContent.includes('ConnectSuite'))!;
    other.click();
    await new Promise((r) => setImmediate(r));
    assert.equal(view.query, '', 'the filter typed over one folder does not follow you into another');
  } finally {
    pane.restore();
  }
});

test('a folder the phone lists as empty says so — and claims only what the phone said', async () => {
  const pane = mount();
  try {
    pane.view.setAdvertised(true, null);
    pane.bridge.roots = [TREE];
    pane.bridge.entries = [];
    await pane.view.refresh();
    const block = pane.table.queryAll('.state-block')[0];
    assert.ok(block, 'a sentence, not a bare header');
    assert.equal(block!.dataset.state, 'listed-empty');
    assert.ok(block!.textContent.includes('The phone returned nothing for this folder.'));
    assert.equal(block!.textContent.includes('is empty'), false, 'emptiness is not claimed — the phone only reported none');
  } finally {
    pane.restore();
  }
});

// ---- keyboard access (2026-09-23): one tab stop, arrows, Space, Enter = the double-click ---------

const bodyRows = (pane: Pane) =>
  pane.table.queryAll('.files-row').filter((r) => !r.className.includes('files-row--head'));

test('the listing is one tab stop, and every row says what it is', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const stops = bodyRows(pane).filter((r) => r.tabIndex === 0);
    assert.equal(stops.length, 1, 'exactly one row carries tabindex 0 — the roving stop');
    assert.equal(bodyRows(pane).filter((r) => r.tabIndex === -1).length, D_ENTRIES.length - 1);
    const labels = bodyRows(pane).map((r) => r.getAttribute('aria-label'));
    assert.equal(labels[0], 'Camera, folder');
    assert.match(String(labels[1]), /^IMG_2\.jpg, 900 B/);
  } finally {
    pane.restore();
  }
});

test('ArrowDown selects the next row as drawn, and moves the tab stop with it', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    bodyRows(pane)[1]!.dispatch('keydown', { key: 'ArrowDown' });
    const selected = bodyRows(pane).filter((r) => r.className.includes('is-selected'));
    assert.equal(selected.length, 1);
    assert.match(String(selected[0]!.getAttribute('aria-label')), /^IMG_10\.jpg/, 'the next drawn row, natural order');
    assert.equal(selected[0]!.tabIndex, 0, 'the tab stop follows the selection');
  } finally {
    pane.restore();
  }
});

test('Enter does what a double-click does and nothing else: a file is copied, a folder opened', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const pulls: string[] = [];
    pane.bridge.fsPull = (async (o: { name: string }) => { pulls.push(o.name); return { ok: true, path: '/tmp/x' }; }) as never;
    bodyRows(pane)[3]!.dispatch('keydown', { key: 'Enter' }); // report.pdf
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pulls, ['report.pdf'], 'Copy to Mac — the existing double-click action');
    const lists = pane.bridge.calls.filter((c) => c === 'fsList').length;
    bodyRows(pane)[0]!.dispatch('keydown', { key: 'Enter' }); // Camera, a folder
    await new Promise((r) => setImmediate(r));
    assert.equal(pane.bridge.calls.filter((c) => c === 'fsList').length, lists + 1, 'the folder was opened');
    assert.deepEqual(pulls, ['report.pdf'], 'a folder is never copied');
  } finally {
    pane.restore();
  }
});

test('Space selects, like a click; keys the rows do not use change nothing', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    bodyRows(pane)[2]!.dispatch('keydown', { key: ' ' });
    assert.equal(bodyRows(pane).filter((r) => r.className.includes('is-selected')).length, 1);
    const before = pane.bridge.calls.length;
    bodyRows(pane)[2]!.dispatch('keydown', { key: 'a' });
    assert.equal(pane.bridge.calls.length, before, 'an unused key asks the phone for nothing');
  } finally {
    pane.restore();
  }
});

test('a finished pull says how it was checked: block by block, agreed in advance, or not at all', () => {
  const say = (globalThis as Record<string, unknown>).pullCheckSentence as (r: { verified?: boolean; verifiedBy?: string }) => string;
  assert.match(say({ verified: true, verifiedBy: 'blocks' }), /block by block/);
  assert.doesNotMatch(say({ verified: true, verifiedBy: 'blocks' }), /agreed before/, 'nothing was agreed before a block pull');
  assert.match(say({ verified: true, verifiedBy: 'prehash' }), /agreed before the copy/);
  assert.match(say({ verified: true }), /agreed before the copy/, 'an older Mac main process without verifiedBy');
  assert.match(say({ verified: false, verifiedBy: 'blocks' }), /nothing compared/, 'never upgraded when not verified');
  assert.match(say({}), /nothing compared/);
});

// ---- fs.blocks (L1/L2 slice 5c): Pause, Cancel, Resume and what the pane says ----------------------

type PausedRow = { rootId: string; id: string; name: string; size: number; verifiedBytes: number; updatedAtMs: number };

/** Adds the three `fs.blocks` bridge calls to the double, recording every call. */
function withPullControls(pane: Pane) {
  const b = pane.bridge as unknown as Record<string, unknown>;
  const calls: string[] = [];
  let paused: PausedRow[] = [];
  b.fsPullStop = async (o: { transferId: string; how: string }) => { calls.push(`stop:${o.transferId}:${o.how}`); return { stopped: true }; };
  b.fsPausedPulls = async () => { calls.push('paused'); return paused; };
  b.fsCancelPaused = async (o: { rootId: string; id: string }) => { calls.push(`cancelPaused:${o.rootId}:${o.id}`); paused = []; return { removed: true, partial: 'partial deleted' }; };
  return { calls, setPaused: (rows: PausedRow[]) => { paused = rows; } };
}

/** Starts a pull of report.pdf whose result the test decides later. */
async function startPull(pane: Pane): Promise<(result: Record<string, unknown>) => Promise<void>> {
  let resolve!: (r: unknown) => void;
  pane.bridge.fsPull = (() => new Promise((r) => { resolve = r; })) as never;
  const row = pane.table.queryAll('.files-row').find((r) => r.textContent.includes('report.pdf'))!;
  row.dispatch('click');
  row.dispatch('dblclick');
  await new Promise((r) => setImmediate(r));
  return async (result) => { resolve(result); for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };
}

const view5c = (pane: Pane) => pane.view as unknown as {
  onPullAgreed(i: { transferId: string; rootId: string; id: string; name: string; resumedFrom: number; blocks: boolean }): void;
  onPullFinished(i: { rootId: string; id: string; name: string; result: Record<string, unknown> }): void;
};
const one = (pane: Pane, id: string) => pane.detail.queryAll(`#${id}`);

test('5c: a block pull in flight offers Pause and Cancel, and each sends that transfer and that choice', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const { calls } = withPullControls(pane);
    const finish = await startPull(pane);
    assert.equal(one(pane, 'files-pull-pause').length, 0, 'control: nothing to pause before the phone agreed');
    view5c(pane).onPullAgreed({ transferId: 't-7', rootId: TREE.rootId, id: 'f3', name: 'report.pdf', resumedFrom: 0, blocks: true });
    const pause = one(pane, 'files-pull-pause');
    const cancel = one(pane, 'files-pull-cancel');
    assert.equal(pause.length, 1);
    assert.equal(cancel.length, 1);
    assert.match(pause[0]!.getAttribute('aria-label') ?? '', /Pause copying report\.pdf; what has arrived is kept/);
    pause[0]!.click();
    cancel[0]!.click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.filter((c) => c.startsWith('stop:')), ['stop:t-7:pause', 'stop:t-7:cancel']);
    await finish({ ok: false, cancelled: true, reason: 'Cancelled. Nothing was saved.' });
    assert.equal(one(pane, 'files-pull-pause').length, 0, 'the controls go when the pull is over');
    assert.match(pane.detail.textContent, /cancelled\. Nothing was saved, and the part that had arrived was deleted/);
  } finally {
    pane.restore();
  }
});

test('5c: an old-path pull (no fs.blocks) never offers Pause or Cancel', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    withPullControls(pane);
    const finish = await startPull(pane);
    view5c(pane).onPullAgreed({ transferId: 't-8', rootId: TREE.rootId, id: 'f3', name: 'report.pdf', resumedFrom: 0, blocks: false });
    assert.equal(one(pane, 'files-pull-pause').length, 0);
    assert.equal(one(pane, 'files-pull-cancel').length, 0);
    await finish({ ok: true, path: '/tmp/report.pdf', verified: false });
    assert.match(pane.detail.textContent, /nothing compared the bytes/, 'an unverified pull is never dressed as verified');
  } finally {
    pane.restore();
  }
});

test('5c: a paused pull shows what is kept, its button reads Resume, and Cancel removes only that paused copy', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const { calls, setPaused } = withPullControls(pane);
    const finish = await startPull(pane);
    view5c(pane).onPullAgreed({ transferId: 't-9', rootId: TREE.rootId, id: 'f3', name: 'report.pdf', resumedFrom: 0, blocks: true });
    setPaused([{ rootId: TREE.rootId, id: 'f3', name: 'report.pdf', size: 256 * 1024 * 1024, verifiedBytes: 128 * 1024 * 1024, updatedAtMs: 1 }]);
    await finish({ ok: false, paused: true, reason: 'Paused.' });
    assert.match(pane.detail.textContent, /report\.pdf paused — Paused\. What had arrived is kept; Resume continues from there\./);
    const note = one(pane, 'files-pull-paused');
    assert.equal(note.length, 1);
    assert.match(note[0]!.textContent, /^Paused: .+ of .+ is on this Mac, checked block by block\./);
    const copy = one(pane, 'files-copy-to-mac')[0]!;
    assert.equal(copy.textContent, 'Resume');
    assert.equal(copy.getAttribute('aria-label'), 'Resume copying report.pdf to this Mac');
    one(pane, 'files-pull-cancel-paused')[0]!.click();
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
    assert.ok(calls.includes(`cancelPaused:${TREE.rootId}:f3`));
    assert.equal(one(pane, 'files-pull-paused').length, 0, 'nothing paused is drawn once cancelled');
    assert.equal(one(pane, 'files-copy-to-mac')[0]!.textContent, 'Copy to Mac');
  } finally {
    pane.restore();
  }
});

test('5c: Resume starts the same pull again', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    const { setPaused } = withPullControls(pane);
    const pulls: string[] = [];
    setPaused([{ rootId: TREE.rootId, id: 'f3', name: 'report.pdf', size: 10, verifiedBytes: 5, updatedAtMs: 1 }]);
    pane.view.setPhoneName('Phone'); // a (re)connect refreshes the paused list
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
    const row = pane.table.queryAll('.files-row').find((r) => r.textContent.includes('report.pdf'))!;
    row.dispatch('click');
    pane.bridge.fsPull = (async (o: { id: string; name: string }) => { pulls.push(`${o.id}:${o.name}`); return { ok: true, path: '/tmp/r', verified: true, verifiedBy: 'blocks', resumedFrom: 5 }; }) as never;
    one(pane, 'files-copy-to-mac')[0]!.click();
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
    assert.deepEqual(pulls, ['f3:report.pdf']);
    assert.match(pane.detail.textContent, /Verified block by block.*It continued from where it had paused\./);
  } finally {
    pane.restore();
  }
});

test('5c: a pull the Mac resumed by itself after a reconnect reports its result on the pane', async () => {
  const pane = mount();
  try {
    await loaded(pane);
    withPullControls(pane);
    const row = pane.table.queryAll('.files-row').find((r) => r.textContent.includes('report.pdf'))!;
    row.dispatch('click');
    view5c(pane).onPullFinished({ rootId: TREE.rootId, id: 'f3', name: 'report.pdf', result: { ok: true, path: '/tmp/report.pdf', verified: true, verifiedBy: 'blocks', resumedFrom: 1024 } });
    assert.match(pane.detail.textContent, /report\.pdf is on this Mac.*Verified block by block.*continued from where it had paused/);
    assert.equal(one(pane, 'files-copy-to-mac')[0]!.textContent, 'Copy again', 'the local copy is known');
  } finally {
    pane.restore();
  }
});

test('5c: every way a pull ends has its own truthful sentence', () => {
  const say = (globalThis as Record<string, unknown>).pullOutcomeText as (n: string, r: Record<string, unknown>) => string;
  const n = 'clip.mov';
  assert.match(say(n, { ok: true, verified: true, verifiedBy: 'blocks' }), /Verified block by block/);
  assert.doesNotMatch(say(n, { ok: true, verified: true, verifiedBy: 'blocks' }), /continued/, 'not resumed, not claimed');
  assert.match(say(n, { ok: false, paused: true, noSpace: true, reason: 'Not enough space left on "Macintosh HD": 1 GB more is needed.' }), /Not enough space.*free some space, then choose Resume/);
  assert.match(say(n, { ok: false, paused: true, reason: 'The phone disconnected.' }), /paused — The phone disconnected\. What had arrived is kept/);
  assert.match(say(n, { ok: false, cancelled: true }), /cancelled\. Nothing was saved/);
  assert.match(say(n, { ok: false, sourceChanged: true, reason: 'clip.mov changed on the phone while it was being sent, so it was not saved.' }), /changed on the phone.*Nothing was saved\./);
  assert.doesNotMatch(say(n, { ok: false, sourceChanged: true, reason: 'x' }), /paused|Resume/, 'a changed source is not a pause');
  assert.match(say(n, { ok: false, reason: 'The receive folder is not available.', fixHint: 'Choose another folder.' }), /not available\. Choose another folder\./);
});

test('158: a reason with no full stop does not run into the next sentence', () => {
  const say = (globalThis as Record<string, unknown>).pullOutcomeText as (n: string, r: Record<string, unknown>) => string;
  const n = 'sidekick-t5-source-change-200mb.bin';
  // The exact reason the pane showed on hardware (2026-10-01 23:40), when a refusal was still called a pause.
  const interrupted = say(n, { ok: false, paused: true, reason: 'the phone closed after 0 of 109051904 bytes' });
  assert.doesNotMatch(interrupted, /bytes What/, 'the run-on sentence seen on hardware');
  assert.match(interrupted, /109051904 bytes\. What had arrived is kept; Resume continues from there\.$/);
  assert.match(say(n, { ok: false, paused: true, reason: 'The phone disconnected.' }), /disconnected\. What/, 'control: a reason with its own stop gets no second one');
  const rejected = say(n, { ok: false, sourceChanged: true, reason: `${n} changed on the phone since the transfer paused, so it has to start again.` });
  assert.doesNotMatch(rejected, /^\S+ paused|Resume continues/, 'a source rejection is not worded as a pause');
  assert.match(rejected, /Nothing was saved\.$/);
});
