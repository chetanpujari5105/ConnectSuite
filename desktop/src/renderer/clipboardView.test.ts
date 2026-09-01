import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
// A plain side-effecting import, and it is safe because `clipboard.ts` touches no DOM at module
// scope — it only hangs its class and its two pure functions on `globalThis`. The document double
// goes in around each mount instead, where the drawing actually happens.
import './clipboard';

/**
 * The clipboard pane's **view class**, driven for real.
 *
 * `clipboard.test.ts` covers the two pure row functions and explicitly deletes
 * `class ClipboardView` from the source before evaluating it. Both of the renderer defects this
 * project has recorded — 58, the Restore row that did not appear, and 59, the watcher send that
 * never reached the list — lived in that deleted class, and both shipped with a green suite.
 *
 * This file imports the module rather than regex-stripping it, so the code under test is the code
 * that runs. What is faked is the DOM, and `domDouble.testkit.ts` says at length which half that
 * leaves unmeasured.
 */

type Row = { kind: string; text?: string; atMs: number; source: string; applied?: boolean };

/** A bridge that records what was asked of it and hands back what a test tells it to. */
class FakeBridge {
  history: Row[] = [];
  watching = true;
  readonly calls: string[] = [];
  private arrived: ((entry: Row) => void) | null = null;
  private changed: (() => void) | null = null;

  async clipSend() {
    this.calls.push('clipSend');
    return { ok: true as const, data: { bytes: 1 } };
  }
  async clipRequest() {
    this.calls.push('clipRequest');
    return { ok: true as const, data: this.history[0] as Row };
  }
  async clipHistory() {
    this.calls.push('clipHistory');
    return { ok: true as const, data: this.history };
  }
  async clipUse(text: string) {
    this.calls.push(`clipUse:${text}`);
    return { ok: true as const, data: null };
  }
  async clipWatching() {
    return { ok: true as const, data: { watching: this.watching } };
  }
  async clipSetWatching(on: boolean) {
    this.watching = on;
    this.calls.push(`clipSetWatching:${on}`);
    return { ok: true as const, data: { watching: on } };
  }
  onClipArrived(cb: (entry: Row) => void) {
    this.arrived = cb;
  }
  onClipChanged(cb: () => void) {
    this.changed = cb;
  }

  /** The main process pushing an arrival at the renderer. */
  fireArrived(entry: Row): void {
    this.arrived?.(entry);
  }
  /** The main process saying the history moved with nobody clicking — a watcher send. */
  fireChanged(): void {
    this.changed?.();
  }
}

interface Pane {
  bridge: FakeBridge;
  list: FakeElement;
  notice: FakeElement;
  wall: FakeElement;
  phoneWall: FakeElement;
  watch: FakeElement;
}

// Installed for the whole file rather than around each mount. The first version restored it when
// `mount` returned — and the view's drawing is *asynchronous*, so every `draw()` ran after the
// document had been taken away and every test failed on `createElement` of undefined. A fixture
// torn down before the thing it supports has finished is the sampling-window fault from
// `CLAUDE.md` wearing a test-harness costume.
installFakeDocument();

function mount(history: Row[] = [], watching = true): Pane {
  const bridge = new FakeBridge();
  bridge.history = history;
  // Set **before** construction, because the view reads it in its constructor. The first version of
  // the toggle test assigned it afterwards and then asserted on the value the view had already
  // read — the test was measuring its own late write, not the view.
  bridge.watching = watching;
  const list = el('div');
  const wall = el('div');
  const phoneWall = el('div');
  const notice = el('div');
  const send = el('button');
  const request = el('button');
  const watch = el('input');
  const View = (globalThis as Record<string, unknown>).ClipboardView as new (...args: unknown[]) => unknown;
  new View(bridge, list, wall, phoneWall, notice, send, request, watch);
  return { bridge, list, notice, wall, phoneWall, watch };
}

/** The view's async work is fire-and-forget promises; this lets them settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('defect 59 — a watcher send reaches the list with nobody clicking', async () => {
  // The break: the pane refreshed only on its own button clicks, and the watcher clicks nothing, so
  // the list sat at "Nothing yet" over a history with entries in it. Fired here the way the main
  // process fires it, through the real subscription the real class registers.
  const pane = mount([]);
  await settle();
  assert.match(pane.list.textContent, /Nothing yet/);

  pane.bridge.history = [{ kind: 'text', text: 'copied on the Mac', atMs: 1, source: 'mac' }];
  pane.bridge.fireChanged();
  await settle();

  assert.match(pane.list.textContent, /copied on the Mac/);
  assert.equal(pane.list.queryAll('.clip-row').length, 1);
});

test('defect 58 — an arrival draws its Restore row without a second click', async () => {
  // The break: `onClipArrived` carries the arriving entry and not the `displaced` one created
  // beside it, so the pane showed the new clip and no way back to what it replaced. The fix
  // reconciles from the main process after every arrival; this drives that path.
  const pane = mount([]);
  await settle();

  // What the main process holds after an auto-apply: the arrival, and the clipboard it displaced.
  pane.bridge.history = [
    { kind: 'text', text: 'from the phone', atMs: 2, source: 'phone' },
    { kind: 'displaced', text: 'what I was about to paste', atMs: 2, source: 'mac' },
  ];
  pane.bridge.fireArrived({ kind: 'text', text: 'from the phone', atMs: 2, source: 'phone', applied: true });
  await settle();

  const buttons = pane.list.queryAll('button').map((b) => b.textContent);
  assert.deepEqual(buttons, ['Use this', 'Restore'], 'the undo must be on screen with the arrival');
});

test('a displaced row never renders the text it holds, even here', async () => {
  // The safeguard the concealed-marker check is explicitly *not* relied on for. Asserted against
  // the drawn tree rather than against `clipRowText`, because the row could leak it by any other
  // route — a title, a second body, a debug span — and only the tree can say it did not.
  const secret = 'correct-horse-battery-staple';
  const pane = mount([{ kind: 'displaced', text: secret, atMs: 1, source: 'mac' }]);
  await settle();

  assert.ok(!pane.list.textContent.includes(secret), 'the pane drew a displaced entry’s text');
  assert.equal(pane.list.queryAll('button')[0]?.textContent, 'Restore');
});

test('an applied arrival says it is pasteable; one that was not applied says it is not', async () => {
  const pane = mount([]);
  await settle();

  pane.bridge.fireArrived({ kind: 'text', text: 'x', atMs: 1, source: 'phone', applied: true });
  await settle();
  assert.match(pane.notice.textContent, /⌘V/);

  // A `sensitive` entry arrives and is **not** applied. A pane that announced "ready to paste" over
  // it would be telling somebody something false about their own clipboard.
  pane.bridge.fireArrived({ kind: 'sensitive', atMs: 2, source: 'phone', applied: false });
  await settle();
  assert.match(pane.notice.textContent, /Nothing was put on this Mac’s clipboard/);
  assert.ok(!pane.notice.textContent.includes('⌘V'));
});

test('the watch toggle reports the main process’s state, not its own markup', async () => {
  // The checkbox is `checked` in index.html. If the preference is off at launch, a pane that
  // trusted the markup would draw "on" for a session where nothing is being watched — a control
  // that lies about the thing it controls.
  const off = mount([], false);
  const on = mount([], true);
  await settle();

  assert.equal(off.watch.checked, false, 'a watcher that is off must not draw as on');
  // The control: the same code path with the other answer, so "always false" cannot pass.
  assert.equal(on.watch.checked, true);
});

test('turning the toggle off tells the main process, and says so', async () => {
  const pane = mount([], true);
  await settle();

  pane.watch.checked = false;
  pane.watch.dispatch('change');
  await settle();

  assert.ok(pane.bridge.calls.includes('clipSetWatching:false'));
  assert.match(pane.notice.textContent, /Stopped watching/);
});

test('both walls carry standing copy, and the limit names Android as its owner', async () => {
  // Drawn in the constructor, before anything is asked — so this also proves they are not attached
  // to a failure path that a working link would never reach.
  const pane = mount([]);
  await settle();

  assert.match(pane.wall.textContent, /goes to your phone on its own/);
  assert.match(pane.phoneWall.textContent, /Android’s rule, not an unfinished feature/);
  assert.ok(pane.phoneWall.textContent.includes('every app'), 'the limit must not read as ours alone');
});
