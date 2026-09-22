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

test('Stop cancels the file in flight on the phone and starts nothing queued', async () => {
  const pane = mount();
  try {
    await readyToSend(pane);
    pane.bridge.picked = [
      { source: '/m/1.bin', name: '1.bin', size: 10 },
      { source: '/m/2.bin', name: '2.bin', size: 10 },
    ];
    let release: (() => void) | null = null;
    pane.bridge.onAgreed = (source) =>
      pane.view.onPushAgreed({ source, transferId: `t-${source}`, name: source.slice(3) });
    // Hold the first send open so Stop lands while it is in flight.
    const original = pane.bridge.fsSend.bind(pane.bridge);
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
    assert.deepEqual(pane.bridge.cancelled, ['t-/m/1.bin'], 'the live transfer is cancelled by id');
    release!();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pane.bridge.sent, ['/m/1.bin'], 'the queued file never started');
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
