import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import './icons';
import './stateBlock';
import './trial';

/**
 * The trial's screen and entry, driven for real against the DOM double. Every verdict here is what the
 * main process sends; this view only draws it. What the double cannot show — layout, the real dialog,
 * the Keychain — is reached by the live run recorded in `docs/testing.md`.
 */

type Verdict = {
  state: 'not-enforced' | 'no-key' | 'none' | 'clock-back' | 'not-yet' | 'expired' | 'valid';
  blocks: boolean;
  label: string | null;
  notAfter: string | null;
  daysLeft: number;
  headline: string;
  body: string;
  line: string;
  notice: { days: 7 | 1; text: string } | null;
};

const v = (over: Partial<Verdict>): Verdict => ({
  state: 'valid', blocks: false, label: 'Tester One', notAfter: '2026-11-26T00:00:00.000Z', daysLeft: 44,
  headline: 'Beta access', body: '', line: 'Beta access until 26 Nov 2026 · 44 days left · for Tester One', notice: null, ...over,
});
const EXPIRED = v({ state: 'expired', blocks: true, daysLeft: 0, headline: 'Your beta access ended on 26 Nov 2026', body: 'Thank you for testing Sidekick. To keep using it, ask for a new token. Nothing has been deleted.', line: 'Beta access ended on 26 Nov 2026.' });
const NONE = v({ state: 'none', blocks: true, label: null, notAfter: null, daysLeft: 0, headline: 'Enter your beta token', body: 'This test build needs a beta token.', line: 'No beta token entered.' });

class FakeBridge {
  next: { ok: boolean; message: string; data: Verdict; cancelled?: boolean } | null = null;
  readonly entered: string[] = [];
  readonly opened: number[] = [];
  readonly shown: number[] = [];
  async trialStatus() { return { ok: true, data: NONE }; }
  async trialEnter(text: string) { this.entered.push(text); return this.next!; }
  async trialOpenFile() { this.opened.push(1); return this.next!; }
  async trialNoticeShown(days: 7 | 1) { this.shown.push(days); return { ok: true }; }
}

function mount(paired = true, settingsHost: FakeElement | null = null) {
  const fake = installFakeDocument();
  const bridge = new FakeBridge();
  const gate = el('div');
  const toasts: string[] = [];
  const routed: string[] = [];
  let changes = 0;
  const View = (globalThis as Record<string, unknown>).TrialView as new (...a: unknown[]) => {
    apply(v: Verdict): void; covers(id: string): boolean; settingsBlock(): FakeElement; load(): Promise<void>;
  };
  const view = new View(bridge, gate, { toast: (t: string) => toasts.push(t), route: (id: string) => routed.push(id), paired: () => paired, changed: () => {
    changes += 1;
    // What renderer.ts does: Settings › About is rebuilt from settingsBlock() on every verdict.
    if (settingsHost) settingsHost.replaceChildren(view.settingsBlock());
  } });
  return { view, bridge, gate, toasts, routed, changes: () => changes, restore: fake.restore };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const button = (root: FakeElement, id: string) => root.queryAll('button').find((b) => b.id === id)!;

test('expired: the screen covers phone panes, never Activity or Settings, and says nothing is lost', () => {
  const m = mount();
  try {
    m.view.apply(EXPIRED);
    for (const id of ['overview', 'mirror', 'files', 'messages', 'pairing']) assert.equal(m.view.covers(id), true, id);
    for (const id of ['activity', 'settings']) assert.equal(m.view.covers(id), false, id);
    assert.match(m.gate.textContent, /ended on 26 Nov 2026/);
    assert.equal((m.view as unknown as { subtitle(): string }).subtitle(), 'Beta access ended on 26 Nov 2026.', 'the page subtitle is the trial\'s, not the covered pane\'s');
    assert.match(m.gate.textContent, /Nothing has been deleted/);
    assert.ok(button(m.gate, 'trial-use-gate'), 'the token entry is on the screen');
    const doors = m.gate.queryAll('.trial-doors button').map((b) => b.textContent);
    assert.deepEqual(doors, ['Open Activity', 'Open Settings']);
    m.gate.queryAll('.trial-doors button')[0]!.click();
    assert.deepEqual(m.routed, ['activity']);
  } finally {
    m.restore();
  }
});

test('first run, unpaired: the screen asks for a token and offers no doors the pairing lock would refuse', () => {
  const m = mount(false);
  try {
    m.view.apply(NONE);
    assert.match(m.gate.textContent, /Enter your beta token/);
    assert.equal(m.gate.queryAll('.trial-doors').length, 0);
  } finally {
    m.restore();
  }
});

test('valid: nothing is covered, the gate is empty, and Settings carries the quiet days-left line', () => {
  const m = mount();
  try {
    m.view.apply(v({}));
    assert.equal(m.view.covers('overview'), false);
    assert.equal(m.gate.children.length, 0);
    const block = m.view.settingsBlock();
    assert.match(block.textContent, /44 days left/);
    assert.ok(button(block, 'trial-use-settings'), 'a new token can be entered from Settings');
  } finally {
    m.restore();
  }
});

test('entering a token: what was pasted is sent, and a refusal is shown in its own words and kept', async () => {
  const m = mount();
  try {
    m.view.apply(NONE);
    const field = m.gate.queryAll('textarea')[0]!;
    field.value = '  SIDEKICK-TRIAL-1.abc.def  ';
    m.bridge.next = { ok: false, message: 'This token wasn’t issued for this copy of Sidekick.', data: NONE };
    button(m.gate, 'trial-use-gate').click();
    await settle();
    assert.deepEqual(m.bridge.entered, ['SIDEKICK-TRIAL-1.abc.def']);
    assert.match(m.gate.textContent, /wasn’t issued for this copy/);
    assert.equal(m.view.covers('overview'), true);
  } finally {
    m.restore();
  }
});

test('entering a good token lifts the screen and thanks the person', async () => {
  const m = mount();
  try {
    m.view.apply(NONE);
    m.gate.queryAll('textarea')[0]!.value = 'SIDEKICK-TRIAL-1.good.sig';
    m.bridge.next = { ok: true, message: 'Thank you — beta access until 26 Nov 2026.', data: v({}) };
    button(m.gate, 'trial-use-gate').click();
    await settle();
    assert.equal(m.view.covers('overview'), false);
    assert.equal(m.gate.children.length, 0);
    assert.ok(m.toasts.some((t) => /Thank you/.test(t)));
  } finally {
    m.restore();
  }
});

test('an empty paste is answered without a round trip; Open token file asks the main process', async () => {
  const m = mount();
  try {
    m.view.apply(NONE);
    button(m.gate, 'trial-use-gate').click();
    await settle();
    assert.deepEqual(m.bridge.entered, []);
    assert.match(m.gate.textContent, /Paste the token first/);
    m.bridge.next = { ok: false, cancelled: true, message: '', data: NONE };
    button(m.gate, 'trial-open-gate').click();
    await settle();
    assert.equal(m.bridge.opened.length, 1);
  } finally {
    m.restore();
  }
});

test('a notice is shown once as a toast and acknowledged, so the main process records it', async () => {
  const m = mount();
  try {
    m.view.apply(v({ daysLeft: 7, notice: { days: 7, text: 'Your Sidekick beta access ends in 7 days, on 26 Nov 2026.' } }));
    await settle();
    assert.equal(m.toasts.length, 1);
    assert.deepEqual(m.bridge.shown, [7]);
    assert.equal(m.view.covers('overview'), false, 'a notice never blocks');
  } finally {
    m.restore();
  }
});

test('not enforced (development): no screen, and Settings says it is not checked, with no entry', () => {
  const m = mount();
  try {
    m.view.apply(v({ state: 'not-enforced', blocks: false, line: 'Development build — beta access is not checked.' }));
    assert.equal(m.view.covers('overview'), false);
    const block = m.view.settingsBlock();
    assert.match(block.textContent, /not checked/);
    assert.equal(block.queryAll('textarea').length, 0);
  } finally {
    m.restore();
  }
});

const CLOCK_BACK = v({ state: 'clock-back', blocks: true, daysLeft: 0, headline: 'This Mac’s date looks earlier than before', body: 'It can’t check your beta access until the date is right.', line: 'Waiting for this Mac’s date to be right.' });

test('a refusal in Settings while access is valid is shown, not lost (2026-10-12: it vanished and threw)', async () => {
  const host = el('div');
  const m = mount(true, host);
  const thrown: unknown[] = [];
  const onRejection = (e: unknown) => thrown.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    m.view.apply(v({}));
    host.queryAll('textarea').find((f) => f.id === 'trial-token-settings')!.value = 'SIDEKICK-TRIAL-1.cut';
    m.bridge.next = { ok: false, message: 'That doesn’t look like a Sidekick beta token.', data: v({}) };
    button(host, 'trial-use-settings').click();
    await settle();
    assert.deepEqual(thrown, [], 'the entry threw while answering');
    assert.match(host.textContent, /doesn’t look like a Sidekick beta token/, 'the person pressed the button and got no answer');
    assert.match(host.textContent, /44 days left/, 'a refusal changes nothing');
  } finally {
    process.off('unhandledRejection', onRejection);
    m.restore();
  }
});

test('a thank-you belongs to the moment it answered: a later clock-back or expiry does not keep it (2026-10-12)', async () => {
  const host = el('div');
  const m = mount(true, host);
  try {
    m.view.apply(NONE);
    m.gate.queryAll('textarea')[0]!.value = 'SIDEKICK-TRIAL-1.good.sig';
    m.bridge.next = { ok: true, message: 'Thank you — beta access until 26 Nov 2026.', data: v({}) };
    button(m.gate, 'trial-use-gate').click();
    await settle();
    assert.match(host.textContent, /Thank you/, 'control: the thank-you is shown while it is true');
    for (const later of [CLOCK_BACK, EXPIRED]) {
      m.view.apply(later);
      assert.doesNotMatch(m.gate.textContent, /Thank you — beta access until/, `${later.state}: the screen still thanks the person for access it is refusing`);
      assert.doesNotMatch(host.textContent, /Thank you — beta access until/, `${later.state}: Settings still thanks the person`);
      assert.match(m.gate.textContent, new RegExp(later.headline), `${later.state}: control — the screen is drawn`);
    }
  } finally {
    m.restore();
  }
});
