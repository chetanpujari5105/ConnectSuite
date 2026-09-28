import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeElement, installFakeDocument, installFakeWindow } from './domDouble.testkit';

installFakeDocument();
const win = installFakeWindow();
require('./icons');
require('../shared/shareReceiveCopy');
require('../shared/shareWindowModel');
import './shareWindow';

/**
 * **F4** (docs/feature-a-v3-production-enablement.md §6): a waiting file that arrives out of sight.
 * The real `ShareQueueView` over the DOM double. The double has no layout, so each test **states** the
 * layout it assumes through the view's `rectOf` and `mayGrow` seams — a 520 px list band and 170 px
 * cards, which puts the 4th and 5th arrivals below the fold as the harness measured at the 560 px cap. Whether the real
 * page lays out that way, and whether a reveal really brings the card into view, is the harness's
 * reading (`docs/evidence/…`), not this file's.
 */

const g = globalThis as Record<string, any>;
const ShareQueueView = g.ShareQueueView as new (n: unknown, bridge: unknown, env?: unknown) => { update(p: unknown): void };
const { shareWinArrivalMove, shareWinFullyInView, shareWinMoreLabel, SHARE_WIN_SCROLL_QUIET_MS } = g as {
  shareWinArrivalMove: (s: { inView: boolean; focused: boolean; hovered: boolean; msSinceScroll: number }) => string;
  shareWinFullyInView: (c: { top: number; bottom: number }, l: { top: number; bottom: number }) => boolean;
  shareWinMoreLabel: (labels: string[]) => { text: string; aria: string } | null;
  SHARE_WIN_SCROLL_QUIET_MS: number;
};
const ids = ['A', 'B', 'C', 'D', 'E'].map((c) => `s-${c.repeat(22)}`);
const [A, B, C, D, E] = ids as [string, string, string, string, string];
const T0 = new Date(2026, 8, 28, 15, 0, 0).getTime();

const offer = (offerId: string, seq: number, over: Record<string, unknown> = {}) => ({
  offerId, from: 'Synthetic Phone', name: `synthetic-${offerId[2]!.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: 0, savedAs: null, reason: null, priorCopy: null,
  queueMode: true, arrivalSeq: seq, arrivedAtMs: T0 + seq * 1000, filesAhead: null, canRetry: false,
  ...over,
});

function setup() {
  const n = {
    root: new FakeElement('main'), one: new FakeElement('div'), queue: new FakeElement('ol'),
    close: new FakeElement('button'), live: new FakeElement('div'), more: new FakeElement('button'),
  };
  n.more.type = 'button';
  n.more.hidden = true;
  // The capped list the harness measured: content taller than the band, so the indicator's slot is reserved.
  n.queue.scrollHeight = 1000;
  n.queue.clientHeight = 520;
  n.root.append(n.close, n.one, n.queue, n.more);
  const calls: string[] = [];
  const bridge = {
    shareDecide: (offerId: string, decision: string) => { calls.push(`${decision}:${offerId}`); return Promise.resolve({ ok: true }); },
    shareAct: (action: string, offerId: string) => { calls.push(`${action}:${offerId}`); return Promise.resolve({ ok: true }); },
    shareWindowClose: () => calls.push('close-window'),
  };
  let clock = T0;
  let scrolled = 0; // the list's scroll offset the test says the browser is at
  const list = { top: 40, bottom: 560 };
  let growing = false;
  const resizers: (() => void)[] = [];
  const rectOf = (el: FakeElement) => {
    if (el === n.queue) return list;
    const seq = ids.indexOf(el.dataset.offerId ?? '') + 1;
    const top = 40 + (seq - 1) * 170 - scrolled;
    return { top, bottom: top + 166 };
  };
  const view = new ShareQueueView(n, bridge, { now: () => clock, rectOf, mayGrow: () => growing, onResize: (cb: () => void) => resizers.push(cb) });
  let focused = false;
  (globalThis.document as unknown as { hasFocus: () => boolean }).hasFocus = () => focused;
  let offers: Record<string, unknown>[] = [];
  const draw = (os: Record<string, unknown>[], subject: string | null = null) => {
    offers = os;
    view.update({ subject, offers: os, phone: 'Synthetic Phone', thumb: null });
  };
  const arrive = (seq: number) => draw([...offers, offer(ids[seq - 1]!, seq)], ids[seq - 1]!);
  const card = (id: string) => n.queue.queryAll('li').find((c) => c.dataset.offerId === id)!;
  const button = (id: string, action: string) => card(id).queryAll('button').find((b) => b.dataset.action === action);
  const scrolls = () => Object.fromEntries(ids.map((id) => [id[2], n.queue.queryAll('li').find((c) => c.dataset.offerId === id)?.scrollCount ?? null]));
  const focuses = () => [n.root, n.close, n.more, ...n.queue.queryAll('li'), ...n.queue.queryAll('button')].reduce((s, e) => s + e.focusCount, 0);
  return {
    n, calls, draw, arrive, card, button, scrolls, focuses, list,
    setFocused: (v: boolean) => { focused = v; },
    tick: (ms: number) => { clock += ms; },
    scrollTo: (px: number) => { scrolled = px; n.queue.dispatch('scroll'); },
    setGrowing: (v: boolean) => { growing = v; },
    resized: (bottom: number) => { list.bottom = bottom; for (const cb of resizers) cb(); },
  };
}

/** Whether the indicator is on screen: its slot shown **and** not an empty, invisible one. */
const shown = (t: ReturnType<typeof setup>) => !t.n.more.hidden && t.n.more.dataset.empty !== 'true';

/** Three waiting files, all in view — the state the 4th arrives into. */
function threeWaiting() {
  const t = setup();
  t.arrive(1); t.arrive(2); t.arrive(3);
  assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: null, E: null }, 'control: three in view, nothing scrolled');
  assert.equal(shown(t), false, 'control: no indicator while everything waiting is in view');
  return t;
}

// ---- the rule, alone -----------------------------------------------------------------------------

test('F4 rule: in view → nothing; nobody using the window → reveal; focused, hovered or scrolled lately → indicate', () => {
  const idle = { inView: false, focused: false, hovered: false, msSinceScroll: Infinity };
  assert.equal(shareWinArrivalMove({ ...idle, inView: true }), 'none');
  assert.equal(shareWinArrivalMove(idle), 'reveal');
  assert.equal(shareWinArrivalMove({ ...idle, focused: true }), 'indicate');
  assert.equal(shareWinArrivalMove({ ...idle, hovered: true }), 'indicate');
  assert.equal(shareWinArrivalMove({ ...idle, msSinceScroll: SHARE_WIN_SCROLL_QUIET_MS - 1 }), 'indicate');
  assert.equal(shareWinArrivalMove({ ...idle, msSinceScroll: SHARE_WIN_SCROLL_QUIET_MS }), 'reveal', 'the quiet period is a boundary, not a guess');
  assert.equal(shareWinFullyInView({ top: 380, bottom: 546 }, { top: 40, bottom: 560 }), true);
  assert.equal(shareWinFullyInView({ top: 550, bottom: 716 }, { top: 40, bottom: 560 }), false, 'partly out is out');
  assert.equal(shareWinMoreLabel([]), null);
});

// ---- nobody using the window: the arrival is revealed, nothing is focused -------------------------

test('F4: the 4th arrival, out of view with nobody using the window, is scrolled into view — no focus, no request', () => {
  const t = threeWaiting();
  t.arrive(4);
  assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: 1, E: null }, 'only the arrival is scrolled to');
  assert.equal(t.focuses(), 0, 'nothing asked for focus');
  assert.deepEqual(t.calls, [], 'nothing decided, nothing closed');
  assert.ok(t.button(D, 'accept') && t.button(D, 'decline'), 'D keeps its own Accept and Decline');
  t.scrollTo(170); // what the browser does for block:'nearest'
  assert.equal(t.n.more.textContent, '1 more file waiting', 'D is in view now; A, still waiting, scrolled off the top');
  assert.match(t.n.more.getAttribute('aria-label')!, /synthetic-a\.png \(file 1/);
});

test('F4: the 5th arrival is revealed too — the newest, since cards arrive at the end in arrival order', () => {
  const t = threeWaiting();
  t.arrive(4); t.scrollTo(170);
  t.arrive(5);
  assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: 1, E: 1 });
  assert.equal(t.focuses(), 0);
  assert.deepEqual(t.calls, []);
});

// ---- somebody is using the window: the list stays still, the indicator says so -------------------

for (const [how, engage] of [
  ['focused', (t: ReturnType<typeof setup>) => t.setFocused(true)],
  ['hovered', (t: ReturnType<typeof setup>) => t.n.root.dispatch('pointerenter')],
  ['being scrolled (wheel)', (t: ReturnType<typeof setup>) => t.n.queue.dispatch('wheel')],
  ['being scrolled (scrollbar press)', (t: ReturnType<typeof setup>) => t.n.queue.dispatch('pointerdown')],
  ['being scrolled (PageDown)', (t: ReturnType<typeof setup>) => t.n.queue.dispatch('keydown', { key: 'PageDown' })],
] as const) {
  test(`F4: window ${how} — the 4th and 5th arrivals do not move the list; the indicator names the first and counts both`, () => {
    const t = threeWaiting();
    engage(t);
    t.arrive(4);
    assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: 0, E: null }, 'the list did not jump');
    assert.equal(shown(t), true);
    assert.equal(t.n.more.textContent, '1 more file waiting');
    assert.equal(t.n.more.getAttribute('aria-label'), '1 more file is waiting, out of view: synthetic-d.png (file 4, arrived 15:00:04). Show it.');
    t.arrive(5);
    assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: 0, E: 0 }, 'still no jump');
    assert.equal(t.n.more.textContent, '2 more files waiting');
    assert.match(t.n.more.getAttribute('aria-label')!, /^2 more files are waiting, out of view\. Show the newest: synthetic-e\.png \(file 5/);
    assert.equal(t.focuses(), 0, 'nothing asked for focus');
    assert.deepEqual(t.calls, []);
  });
}

test('F4: scroll input stops counting after the quiet period, and a key that does not scroll never counted', () => {
  const t = threeWaiting();
  t.n.queue.dispatch('keydown', { key: 'a' });
  t.n.queue.dispatch('wheel');
  t.tick(SHARE_WIN_SCROLL_QUIET_MS - 1);
  t.arrive(4);
  assert.equal(t.scrolls().D, 0, 'inside the quiet period: indicate');
  t.tick(1);
  t.arrive(5);
  assert.equal(t.scrolls().E, 1, 'after it: reveal the newest');
});

// ---- the indicator: keyboard and screen reader -----------------------------------------------------

test('F4: the indicator is a real button; pressing it (Enter, Space or a click all arrive as click) scrolls to the newest waiting card out of view and focuses it', () => {
  const t = threeWaiting();
  t.setFocused(true);
  t.arrive(4); t.arrive(5);
  assert.equal(t.n.more.tagName, 'button');
  assert.equal(t.n.more.type, 'button');
  assert.match(t.n.live.textContent, /Synthetic Phone wants to send synthetic-e\.png/, 'the arrival is still announced');
  t.n.more.click();
  assert.equal(t.card(E).scrollCount, 1, 'scrolled to the newest out of view — E, the file that just arrived');
  assert.equal(t.card(E).focusCount, 1, 'keyboard focus moved to it, because a person asked');
  assert.equal(t.card(E).getAttribute('tabindex'), '-1', 'focusable by script, not an extra tab stop');
  assert.equal(t.card(D).focusCount, 0);
  assert.deepEqual(t.calls, [], 'showing a file decides nothing');
  t.scrollTo(340); // E brought to the bottom edge: D and C in view, A and B scrolled off the top
  assert.equal(t.n.more.textContent, '2 more files waiting');
  assert.match(t.n.more.getAttribute('aria-label')!, /Show the newest: synthetic-b\.png \(file 2/);
});

test('F4: a file that stops waiting leaves the indicator — declined, accepted and queued, or gone', () => {
  const t = threeWaiting();
  t.setFocused(true);
  t.arrive(4); t.arrive(5);
  const base = [offer(A, 1), offer(B, 2), offer(C, 3)];
  t.draw([...base, offer(D, 4, { state: 'declined' }), offer(E, 5)]);
  assert.equal(t.n.more.textContent, '1 more file waiting');
  assert.match(t.n.more.getAttribute('aria-label')!, /synthetic-e\.png/);
  t.draw([...base, offer(D, 4, { state: 'declined' }), offer(E, 5, { state: 'queued', filesAhead: 1 })]);
  assert.equal(shown(t), false, 'E was accepted: it keeps its queued card, and is no longer a waiting file');
  assert.equal(t.card(E).dataset.state, 'queued');
});

test('F4: only a waiting arrival counts — a card first drawn queued or receiving moves nothing', () => {
  const t = threeWaiting();
  t.draw([offer(A, 1), offer(B, 2), offer(C, 3), offer(D, 4, { state: 'receiving', receivedBytes: 1 }), offer(E, 5, { state: 'queued', filesAhead: 1 })]);
  assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: 0, E: 0 });
  assert.equal(shown(t), false);
});

test('F4: an arrival already in view moves nothing and indicates nothing, whoever is using the window', () => {
  const t = setup();
  t.setFocused(true);
  t.arrive(1); t.arrive(2); t.arrive(3);
  assert.deepEqual(t.scrolls(), { A: 0, B: 0, C: 0, D: null, E: null });
  assert.equal(shown(t), false);
});

// ---- the window is still growing: judge the arrival against the band it is about to have -----------

test('F4: while the window can still grow, the arrival waits — and a resize that brings it into view moves nothing', () => {
  const t = threeWaiting();
  t.setGrowing(true);
  t.arrive(4);
  assert.equal(t.scrolls().D, 0, 'no scroll against a band about to get larger');
  t.setGrowing(false);
  t.resized(720); // the window grew; D now fits
  assert.equal(t.scrolls().D, 0, 'in view after the growth: nothing to reveal');
  assert.equal(shown(t), false, 'and nothing to indicate — the indicator is recomputed on resize');
});

test('F4: while the window can still grow, the arrival waits — and is revealed once the window is at its cap', () => {
  const t = threeWaiting();
  t.setGrowing(true);
  t.arrive(4);
  assert.equal(t.scrolls().D, 0);
  t.setGrowing(false);
  t.resized(560); // at the cap, D still below the fold
  assert.equal(t.scrolls().D, 1);
  assert.equal(t.focuses(), 0);
});

test('F4: a window that never grows still places the arrival, after the wait', () => {
  const t = threeWaiting();
  t.setGrowing(true);
  const before = win.timers.length;
  t.arrive(4);
  const wait = win.timers.slice(before).find((x) => x.delay === 700);
  assert.ok(wait, 'control: the fallback was scheduled');
  assert.equal(t.scrolls().D, 0);
  win.fireTimer(wait!.id);
  assert.equal(t.scrolls().D, 1, 'placed without the resize that never came');
});

test('F4: one update bringing a waiting file and a card first drawn receiving — the waiting one is the arrival placed', () => {
  const t = threeWaiting();
  t.draw([offer(A, 1), offer(B, 2), offer(C, 3), offer(D, 4), offer(E, 5, { state: 'receiving', receivedBytes: 1 })]);
  assert.equal(t.scrolls().D, 1, 'D, waiting and out of view, is revealed');
  assert.equal(t.scrolls().E, 0, 'E is not an arrival that needs a person');
});

test('F4: while the window can still grow the indicator stays hidden — its own height would hold the list short', () => {
  // Seen in the harness: the indicator drawn mid-growth added 40 px the window then grew to hold, which
  // kept the arrival 14 px outside a band it would otherwise have fitted, so the indicator never left.
  const t = threeWaiting();
  t.setFocused(true);
  t.setGrowing(true);
  t.arrive(4);
  assert.equal(shown(t), false, 'no indicator measured against a band about to change');
  t.setGrowing(false);
  t.resized(560); // at the cap, D still out of view, and the window is in use
  assert.equal(t.scrolls().D, 0, 'in use: not revealed');
  assert.equal(shown(t), true, 'so now it is indicated');
  assert.equal(t.n.more.textContent, '1 more file waiting');
});

test('F4: the slot is reserved whenever the list is capped, so the indicator appearing or leaving never moves the list', () => {
  const t = threeWaiting();
  assert.equal(t.n.more.hidden, false, 'capped: the slot is there');
  assert.equal(t.n.more.dataset.empty, 'true', 'and empty — invisible, not tabbable, not read');
  assert.equal(t.n.more.getAttribute('aria-label'), null);
  t.setFocused(true);
  t.arrive(4);
  assert.equal(t.n.more.hidden, false);
  assert.equal(t.n.more.dataset.empty, 'false', 'the same slot now carries the indicator');
  t.n.queue.scrollHeight = 400; // everything fits (cards left): no slot at all
  t.draw([offer(A, 1)]);
  assert.equal(t.n.more.hidden, true);
});
