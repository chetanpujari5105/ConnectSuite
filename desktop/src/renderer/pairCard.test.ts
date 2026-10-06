import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeElement, installFakeDocument, installFakeWindow } from './domDouble.testkit';

installFakeDocument();
installFakeWindow();
import './icons';
import './stateBlock';
import './pairCard';

const g = globalThis as Record<string, any>;
const pairCardView = g.pairCardView as (reachable: boolean) => any;
const applyPairCard = g.applyPairCard as (nodes: any, view: any, recheck: () => void) => void;

function nodes() {
  return {
    title: new FakeElement('h2'),
    sub: new FakeElement('p'),
    qr: new FakeElement('img'),
    note: new FakeElement('p'),
    offline: new FakeElement('div'),
    button: new FakeElement('button'),
  };
}

test('with an address, the card is the code and nothing explains an absence', () => {
  const n = nodes();
  applyPairCard(n, pairCardView(true), () => {});
  assert.equal(n.title.textContent, 'Scan this with your phone');
  assert.equal(n.qr.hidden, false);
  assert.equal(n.note.hidden, false);
  assert.equal(n.sub.hidden, false);
  assert.equal(n.button.hidden, false);
  assert.equal(n.button.textContent, 'Show a fresh code');
  assert.equal(n.offline.hidden, true);
  assert.equal(n.offline.children.length, 0);
});

/**
 * The defect this screen exists for: with no address the old card drew a real QR of `0.0.0.0`
 * under *"Scan this with your phone"*. Both halves are asserted — the instruction is gone **and**
 * the plate is gone — because either one alone passes with the other still wrong.
 */
test('with no address, the code is replaced by the explanation', () => {
  const n = nodes();
  applyPairCard(n, pairCardView(false), () => {});
  assert.equal(n.title.textContent, 'This Mac is not on a network');
  assert.doesNotMatch(n.title.textContent, /[Ss]can/);
  assert.equal(n.qr.hidden, true, 'a code of 0.0.0.0 was still on the card');
  assert.equal(n.note.hidden, true);
  assert.equal(n.sub.hidden, true);
  assert.equal(n.offline.hidden, false);

  const block = n.offline.children[0]!;
  assert.equal(block.dataset.kind, 'blocked');
  assert.equal(block.dataset.tone, 'warning', 'the handoff: failure on this screen is amber');
  assert.notEqual(block.dataset.tone, 'danger');
});

/** One control, not two. `Show a fresh code` over a card saying there is no code cannot be pressed honestly. */
test('the card offers exactly one action in each shape, and it is a real one', () => {
  const offline = nodes();
  let rechecks = 0;
  applyPairCard(offline, pairCardView(false), () => { rechecks += 1; });
  assert.equal(offline.button.hidden, true, 'Show a fresh code was still drawn');
  const actions = offline.offline.children[0]!.queryAll('.state-action');
  assert.equal(actions.length, 1);
  actions[0]!.click();
  assert.equal(rechecks, 1, 'the one control did nothing');

  const coded = nodes();
  applyPairCard(coded, pairCardView(true), () => {});
  assert.equal(coded.button.hidden, false);
});

/**
 * The half that a screenshot cannot catch and defect 67 is about: a screen that **enters** a state
 * correctly and never leaves it. Every node is written on every call, so this runs the transition
 * in both directions over the same nodes rather than building fresh ones.
 */
test('the card comes back when the network does', () => {
  const n = nodes();
  applyPairCard(n, pairCardView(false), () => {});
  applyPairCard(n, pairCardView(true), () => {});
  assert.equal(n.title.textContent, 'Scan this with your phone');
  assert.equal(n.qr.hidden, false);
  assert.equal(n.note.hidden, false);
  assert.equal(n.sub.hidden, false);
  assert.equal(n.button.hidden, false);
  assert.equal(n.offline.hidden, true);
  assert.equal(n.offline.children.length, 0, 'the explanation outlived the state it explained');
});

test('and it goes away again — the transition is not one-way in either direction', () => {
  const n = nodes();
  applyPairCard(n, pairCardView(true), () => {});
  applyPairCard(n, pairCardView(false), () => {});
  assert.equal(n.qr.hidden, true);
  assert.equal(n.offline.children.length, 1);
});

// ---- 2026-10-07: a code that could not be made (found by the isolated harness's `failing` mode) ------

test('a code that could not be made replaces the plate with an explanation and a Try again', () => {
  const n = nodes();
  let rechecks = 0;
  applyPairCard(n, (g.pairCardView as (r: boolean | 'failed') => any)('failed'), () => { rechecks += 1; });
  assert.equal(n.title.textContent, 'No pairing code yet');
  assert.doesNotMatch(n.title.textContent, /[Ss]can/, 'no instruction to scan a code that does not exist');
  assert.equal(n.qr.hidden, true);
  assert.equal(n.button.hidden, true);
  assert.equal(n.offline.hidden, false);
  const block = n.offline.children[0]!;
  assert.match(block.textContent, /could not make a pairing code/);
  assert.match(block.textContent, /Nothing was paired/);
  assert.doesNotMatch(block.textContent, /network|Wi-Fi/, 'not a network claim — nothing said it was one');
  block.queryAll('button')[0]!.click();
  assert.equal(rechecks, 1);
});

test('failed → code: the card leaves the failed shape completely', () => {
  const n = nodes();
  const view = g.pairCardView as (r: boolean | 'failed') => any;
  applyPairCard(n, view('failed'), () => {});
  applyPairCard(n, view(true), () => {});
  assert.equal(n.title.textContent, 'Scan this with your phone');
  assert.equal(n.qr.hidden, false);
  assert.equal(n.offline.hidden, true);
  assert.equal(n.offline.children.length, 0);
});

/** `showQr` lives in renderer.ts, which no test can construct; this holds the catch in place. */
test('showQr catches a rejected pairing-qr and draws the failed shape', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const code = readFileSync(join(__dirname, 'renderer.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
  const start = code.indexOf('async function showQr(');
  const body = code.slice(start, code.indexOf('\n}\n', start));
  assert.match(body, /try \{\s*made = await connect\.pairingQr\(rotate\);\s*\} catch \{[\s\S]*applyPairShape\('failed'\);\s*return;\s*\}/);
});
