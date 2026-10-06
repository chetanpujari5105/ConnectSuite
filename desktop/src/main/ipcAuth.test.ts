import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ResourceGrants, WindowRegistry, guardIpc, type ChannelPolicy, type IpcEventLike } from './ipcAuth';
import { NONE, obj, str } from '../shared/ipcSchema';

/**
 * Audit S4: the guard every IPC handler is registered through. These drive `guardIpc` and
 * `WindowRegistry` directly with stand-in senders; `ipcWiring.test.ts` drives the same guard through
 * the real `main.ts` registrations, and the isolated Electron run in
 * `docs/evidence/s4-ipc-2026-10-06/` drives it from real windows.
 */

const DIR = join('/', 'App', 'dist', 'renderer');
const PAGE = { main: join(DIR, 'index.html'), float: join(DIR, 'float.html'), share: join(DIR, 'share-window.html') };
const url = (p: string) => pathToFileURL(p).href;

class Contents {
  destroyed = false;
  isDestroyed() { return this.destroyed; }
}

function event(sender: Contents, page: string, parent: unknown = null): IpcEventLike {
  return { sender, senderFrame: { url: url(page), parent } };
}

function harness() {
  const windows = new WindowRegistry();
  const main = new Contents();
  const float = new Contents();
  const share = new Contents();
  windows.register('main', main, PAGE.main);
  windows.register('float', float, PAGE.float);
  windows.register('share', share, PAGE.share);
  const handlers = new Map<string, (event: IpcEventLike, ...args: unknown[]) => unknown>();
  const warnings: string[] = [];
  const policy: Record<string, ChannelPolicy> = {
    'sms-send': { roles: ['main'], effect: 'action', args: [obj({ threadId: str({ min: 1, max: 64 }), body: str({ max: 100 }) })] },
    'float-state': { roles: ['main', 'float'], effect: 'read', args: NONE },
  };
  const calls: string[] = [];
  const ipc = guardIpc(
    {
      handle: (c, l) => handlers.set(c, l),
      on: (c, l) => handlers.set(c, l),
    },
    windows,
    policy,
    { warn: (m) => warnings.push(m) },
  );
  ipc.handle('sms-send', (_e, payload) => { calls.push(`sms ${JSON.stringify(payload)}`); return { ok: true }; });
  ipc.handle('float-state', () => { calls.push('float-state'); return { open: true }; });
  return { windows, main, float, share, handlers, calls, warnings, ipc };
}

const valid = { threadId: 't1', body: 'hello' };

test('control: the main window with a valid payload reaches the handler', () => {
  const h = harness();
  assert.deepEqual(h.handlers.get('sms-send')!(event(h.main, PAGE.main), valid), { ok: true });
  assert.deepEqual(h.calls, [`sms ${JSON.stringify(valid)}`]);
  assert.deepEqual(h.ipc.counts(), { allowed: 1, refused: 0 });
});

test('a window whose role is not allowed is refused before the handler runs', () => {
  const h = harness();
  for (const [sender, page] of [[h.float, PAGE.float], [h.share, PAGE.share]] as const) {
    const r = h.handlers.get('sms-send')!(event(sender, page), valid) as { refused: boolean; reason: string };
    assert.equal(r.refused, true);
    assert.match(r.reason, /not allowed from the (float|share) window/);
  }
  assert.deepEqual(h.calls, [], 'zero side effects');
  assert.deepEqual(h.handlers.get('float-state')!(event(h.float, PAGE.float)), { open: true }, 'control: float may read its own state');
});

test('an unknown sender, a destroyed window, a replaced window, a subframe and a wrong page are all refused', () => {
  const h = harness();
  const stranger = new Contents();
  const cases: Array<[string, IpcEventLike, RegExp]> = [
    ['unknown sender', event(stranger, PAGE.main), /unknown sender/],
    ['subframe', event(h.main, PAGE.main, { some: 'parent frame' }), /subframe/],
    ['wrong page', event(h.main, join(DIR, 'evil.html')), /own page/],
    ['the float page claiming the main role', event(h.main, PAGE.float), /own page/],
    ['no frame', { sender: h.main, senderFrame: null }, /no sender frame/],
  ];
  for (const [name, e, why] of cases) {
    const r = h.handlers.get('sms-send')!(e, valid) as { refused: boolean; reason: string };
    assert.equal(r.refused, true, name);
    assert.match(r.reason, why, name);
  }
  // replaced: a new main window registers; the old renderer is now a stranger.
  const old = h.main;
  const replacement = new Contents();
  h.windows.register('main', replacement, PAGE.main);
  assert.match((h.handlers.get('sms-send')!(event(old, PAGE.main), valid) as { reason: string }).reason, /unknown sender/);
  assert.deepEqual(h.handlers.get('sms-send')!(event(replacement, PAGE.main), valid), { ok: true }, 'control: the replacement works');
  // destroyed
  replacement.destroyed = true;
  assert.match((h.handlers.get('sms-send')!(event(replacement, PAGE.main), valid) as { reason: string }).reason, /gone/);
  // unregistered on close
  const fresh = new Contents();
  h.windows.register('main', fresh, PAGE.main);
  h.windows.unregister('main', fresh);
  assert.match((h.handlers.get('sms-send')!(event(fresh, PAGE.main), valid) as { reason: string }).reason, /unknown sender/);
  assert.equal(h.calls.length, 1, 'only the control call ran');
});

test('an invalid payload is refused with zero side effects, and the log names the channel and rule, never the value', () => {
  const h = harness();
  const secretish = '+15551234567 my bank code is 4242';
  const bad: unknown[][] = [
    [{ threadId: 't1' }],
    [{ threadId: 't1', body: secretish, extra: 'field' }],
    [{ threadId: 't1', body: 'x'.repeat(101) }],
    [{ threadId: 42, body: 'hi' }],
    [valid, 'a second argument'],
    ['not an object'],
    [],
  ];
  for (const args of bad) {
    const r = h.handlers.get('sms-send')!(event(h.main, PAGE.main), ...args) as { refused?: boolean };
    assert.equal(r.refused, true, JSON.stringify(args).slice(0, 60));
  }
  assert.deepEqual(h.calls, []);
  assert.equal(h.ipc.counts().refused, bad.length);
  assert.ok(h.warnings.every((w) => !w.includes('5551234567') && !w.includes('bank')), 'no payload in a log line');
  assert.ok(h.warnings.every((w) => /refused sms-send: .* — \d+ refused \/ \d+ allowed since launch/.test(w)), 'control: the line carries its denominator');
});

test('a channel with no policy cannot be registered at all', () => {
  const h = harness();
  assert.throws(() => h.ipc.handle('not-in-the-table', () => 1), /has no policy/);
});

test('resource grants are exact and bounded', () => {
  const g = new ResourceGrants(3);
  g.grant('/a'); g.grant('/b'); g.grant('/c'); g.grant('/d');
  assert.equal(g.size(), 3);
  assert.equal(g.has('/a'), false, 'the oldest grant went first');
  assert.equal(g.has('/d'), true);
  assert.equal(g.has('/d/'), false, 'exact paths, no prefix matching');
  assert.equal(g.has('/D'), false);
});
