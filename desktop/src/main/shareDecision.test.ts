import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { acceptAllowed, displayFolder, handleShareDecision, parseShareDecision, type Decider, type WindowFacts } from './shareDecision';
import type { ReceiveState } from './share';

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const front: WindowFacts = { exists: true, visible: true, minimized: false, focused: true };

class FakeDecider implements Decider {
  calls: string[] = [];
  // No default: `new FakeDecider(undefined)` must mean "never held", not fall through to a default.
  constructor(public current: ReceiveState | undefined) {}
  state(): ReceiveState | undefined {
    return this.current;
  }
  async decide(offerId: string, decision: 'accept' | 'decline'): Promise<void> {
    this.calls.push(`${offerId}:${decision}`);
    this.current = decision === 'accept' ? 'saved' : 'declined';
  }
}

test('control: an offer id and a word, from a window in front, reaches decide', async () => {
  const d = new FakeDecider('awaiting-decision');
  assert.deepEqual(await handleShareDecision({ offerId: id, decision: 'accept' }, front, d), { ok: true, state: 'saved' });
  assert.deepEqual(d.calls, [`${id}:accept`]);
});

test('a renderer-supplied path, name or payload beside a valid id is refused whole — nothing is decided', async () => {
  for (const extra of [{ path: '/Users/x/.ssh' }, { folder: '/tmp' }, { savedAs: 'a' }, { offer: {} }]) {
    const d = new FakeDecider('awaiting-decision');
    const r = await handleShareDecision({ offerId: id, decision: 'accept', ...extra }, front, d);
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.deepEqual(d.calls, []);
  }
});

test('malformed input is refused', () => {
  for (const raw of [null, 'accept', [], { offerId: id }, { offerId: 'nope', decision: 'accept' },
    { offerId: id, decision: 'save' }, { offerId: `${id}/../x`, decision: 'accept' }]) {
    assert.equal(parseShareDecision(raw).ok, false, JSON.stringify(raw));
  }
});

test('hidden window: an Accept is refused and the offer keeps waiting; a Decline still goes through', async () => {
  const hidden: WindowFacts[] = [
    { ...front, visible: false },
    { ...front, minimized: true },
    { ...front, focused: false },
    { exists: false, visible: false, minimized: false, focused: false },
  ];
  for (const w of hidden) {
    const d = new FakeDecider('awaiting-decision');
    const r = await handleShareDecision({ offerId: id, decision: 'accept' }, w, d);
    assert.equal(r.ok, false, JSON.stringify(w));
    assert.match((r as { reason: string }).reason, /still waiting/);
    assert.deepEqual(d.calls, [], 'nothing decided');
    assert.equal(d.current, 'awaiting-decision');
    assert.deepEqual(await handleShareDecision({ offerId: id, decision: 'decline' }, w, d), { ok: true, state: 'declined' });
  }
});

test('a decision for an offer that is no longer waiting (expired, stale, already decided) is refused before decide', async () => {
  for (const state of ['expired', 'ended', 'declined', 'saved', undefined] as const) {
    const d = new FakeDecider(state);
    const r = await handleShareDecision({ offerId: id, decision: 'accept' }, front, d);
    assert.equal(r.ok, false, String(state));
    assert.deepEqual(d.calls, []);
  }
});

test('the Accept gate: only a visible, unminimised, focused window', () => {
  assert.equal(acceptAllowed(front).ok, true);
  assert.equal(acceptAllowed({ ...front, visible: false }).ok, false);
  assert.equal(acceptAllowed({ ...front, focused: false }).ok, false);
});

/**
 * Owner decisions: no macOS notification and no Dock bounce for an incoming share (v1, restated in
 * the receive-window brief), and **one decision surface** — the receive window, which appears without
 * focus (docs/feature-a-receive-window.md §4.2). Both live in files that need Electron and no test can
 * load, so these read their **code** (comments stripped: the comments explaining the decisions name
 * the very calls they forbid).
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function bodyAfter(code: string, marker: string): string {
  const start = code.indexOf(marker);
  assert.ok(start >= 0, `control: ${marker} is in main.ts`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}

test('no macOS notification, window raising or Dock bounce for an incoming share', () => {
  const code = codeOf(readFileSync(join(__dirname, 'main.ts'), 'utf8'));
  const electronImport = code.slice(0, code.indexOf("from 'electron';"));
  assert.ok(electronImport.includes('BrowserWindow'), 'control: the electron import was read');
  assert.doesNotMatch(electronImport, /\bNotification\b/, 'main.ts imports Notification');
  assert.doesNotMatch(code, /\bapp\.dock\b|\.bounce\(/, 'a Dock bounce');
  const handler = bodyAfter(code, 'shareReceiver.onChange(');
  assert.ok(handler.includes("send('share-offers'"), 'control: the handler body was found');
  // An arriving offer may do exactly one thing to a window: present the receive window inactive.
  assert.ok(handler.includes('receiveWindow.presentInactive('), 'control: the arrival path was found');
  assert.doesNotMatch(handler, /Notification|\.show\(|\.focus\(|\.restore\(|moveTop|setAlwaysOnTop|flashFrame|openFromUser/);
});

test('the receive window appears without focus, at the normal level — only a person’s Show may focus it', () => {
  const code = codeOf(readFileSync(join(__dirname, 'shareWindow.ts'), 'utf8'));
  const present = bodyAfter(code, 'presentInactive(offerId: string): void');
  assert.ok(present.includes('showInactive()'), 'control: the arrival path was read');
  assert.doesNotMatch(present, /\.show\(|\.focus\(|moveTop|setAlwaysOnTop|flashFrame|'active'/);
  // The one path that may show-and-focus is the person's Show; the 'active' reveal is set nowhere else.
  const open = bodyAfter(code, 'openFromUser(offerId: string): void');
  assert.ok(open.includes("ensure('active')"), 'control: the Show path was read');
  assert.equal(code.split("ensure('active')").length - 1, 1);
  assert.equal(code.split("this.reveal = 'active'").length - 1, 1);
  // Not above other apps, not on every Space, and a first click only focuses.
  assert.match(code, /alwaysOnTop: false/);
  assert.match(code, /acceptFirstMouse: false/);
  assert.doesNotMatch(code, /setAlwaysOnTop|VisibleOnAllWorkspaces|Notification|app\.dock|\.bounce\(/);
});

test('only the receive window may decide; the main window may only ask to Show', () => {
  const code = codeOf(readFileSync(join(__dirname, 'main.ts'), 'utf8'));
  const decide = bodyAfter(code, "ipcMain.handle('share-decide'");
  assert.ok(decide.includes('handleShareDecision('), 'control: the decide handler was read');
  assert.match(decide, /event\.sender !== receiveWindow\.webContents\(\)/);
  assert.match(decide, /receiveWindow\.facts\(\)/, 'the Accept gate reads the window that was clicked');
  const show = bodyAfter(code, "ipcMain.handle('share-window-show'");
  assert.ok(show.includes('parseOfferRequest('), 'control: the Show handler was read');
  assert.match(show, /event\.sender !== window\.webContents/);
  assert.doesNotMatch(show, /decide\(/);
});

test('the folder is shown with ~ for the home folder, and only for a real prefix', () => {
  assert.equal(displayFolder('/Users/a/Downloads/Sidekick', '/Users/a'), '~/Downloads/Sidekick');
  assert.equal(displayFolder('/Users/ab/Downloads', '/Users/a'), '/Users/ab/Downloads');
  assert.equal(displayFolder('/Volumes/X', '/Users/a'), '/Volumes/X');
});

test('Open, Show in Finder, Cancel and Try again: receive window only, {offerId} only, the path looked up in main', () => {
  const code = codeOf(readFileSync(join(__dirname, 'main.ts'), 'utf8'));
  // Sliced between two markers: `bodyAfter` would take the arrow's return *type* as its body.
  const gate = code.slice(code.indexOf('const fromReceiveWindow = ('), code.indexOf("ipcMain.handle('share-cancel'"));
  assert.ok(gate.length > 60 && gate.length < 800, `control: the gate was read (${gate.length} chars)`);
  assert.match(gate, /event\.sender !== receiveWindow\.webContents\(\)/);
  assert.match(gate, /parseOfferRequest\(raw\)/);
  for (const channel of ['share-cancel', 'share-retry', 'share-open', 'share-reveal']) {
    const body = bodyAfter(code, `ipcMain.handle('${channel}'`);
    assert.match(body, /fromReceiveWindow\(event, raw\)/, channel);
    assert.doesNotMatch(body, /raw\s*\.|raw\[|as \{ path/, `${channel} reads nothing else from the page`);
  }
  for (const channel of ['share-open', 'share-reveal']) {
    const body = bodyAfter(code, `ipcMain.handle('${channel}'`);
    assert.match(body, /shareReceiver\.publishedFile\(r\.offerId\)/, `${channel} acts only on the re-verified publication`);
    assert.match(body, /if \(!file\.ok\)/, `${channel} refuses when the file changed`);
  }
  assert.match(bodyAfter(code, "ipcMain.handle('share-retry'"), /acceptAllowed\(receiveWindow\.facts\(\)\)/, 'a retry pulls, so it is gated like Accept');
});
