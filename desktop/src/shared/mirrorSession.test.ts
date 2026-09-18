import { test } from 'node:test';
import assert from 'node:assert/strict';
const { mirrorSessionAfter, mirrorButtons } = require('./mirrorSession.ts');

/*
 * The defect: `renderer.ts` enabled Start *and* Stop from one fact — whether the phone advertises
 * `mirror` — so the inspector offered both at full weight while nothing was running. The tests walk
 * the **transitions** a real session goes through, rather than handing `mirrorButtons` a
 * hand-built session: what went wrong was never the decision, it was that no state existed to decide
 * from.
 */

test('idle offers Start and not Stop', () => {
  const b = mirrorButtons(true, 'idle');
  assert.deepEqual(b, { startShown: true, startEnabled: true, stopShown: false });
});

test('a start request offers Stop immediately, before the phone answers', () => {
  // The consent tap can take as long as the person takes to reach their phone. Stop is the way out.
  const session = mirrorSessionAfter('idle', 'start-requested');
  assert.equal(session, 'starting');
  assert.deepEqual(mirrorButtons(true, session), { startShown: false, startEnabled: false, stopShown: true });
});

test('a running phase makes the session active', () => {
  const session = mirrorSessionAfter(mirrorSessionAfter('idle', 'start-requested'), 'phone-running');
  assert.equal(session, 'active');
  assert.equal(mirrorButtons(true, session).stopShown, true);
  assert.equal(mirrorButtons(true, session).startShown, false);
});

test('a refused start returns to idle', () => {
  const session = mirrorSessionAfter(mirrorSessionAfter('idle', 'start-requested'), 'start-failed');
  assert.equal(session, 'idle');
  assert.equal(mirrorButtons(true, session).startShown, true);
});

test('a session-ending stop from the phone returns to idle; a transient one does not', () => {
  const active = 'active';
  assert.equal(mirrorSessionAfter(active, 'stopped'), 'idle');
  // SECURE_SURFACE leaves the session running (defect 23). Offering Start there would offer a
  // second session on top of a live one.
  assert.equal(mirrorSessionAfter(active, 'stopped-transient'), 'active');
});

test('a stop the Mac asked for returns to idle', () => {
  assert.equal(mirrorSessionAfter('active', 'stop-requested'), 'idle');
  assert.equal(mirrorSessionAfter('starting', 'stop-requested'), 'idle');
});

test('a phone that stops advertising mirror still lets a live session be stopped', () => {
  // The capability can drop mid-session. Removing Stop then would strand a running capture.
  assert.deepEqual(mirrorButtons(false, 'active'), { startShown: false, startEnabled: false, stopShown: true });
  assert.deepEqual(mirrorButtons(false, 'idle'), { startShown: true, startEnabled: false, stopShown: false });
});

test('never both at once, in any reachable state', () => {
  const events = ['start-requested', 'phone-running', 'start-failed', 'stopped', 'stopped-transient', 'stop-requested'];
  const seen = new Set<string>(['idle']);
  let frontier = ['idle'];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier) for (const e of events) {
      const t = mirrorSessionAfter(s, e);
      if (!seen.has(t)) { seen.add(t); next.push(t); }
    }
    frontier = next;
  }
  assert.deepEqual([...seen].sort(), ['active', 'idle', 'starting']);
  for (const s of seen) for (const can of [true, false]) {
    const b = mirrorButtons(can, s);
    assert.notEqual(b.startShown, b.stopShown, `${s}/${can}: exactly one of Start and Stop is on screen`);
  }
});
