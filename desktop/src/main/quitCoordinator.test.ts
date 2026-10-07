import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installQuitCoordinator, QUIT_CLEANUP_BOUND_MS, type QuitTimers, type QuitWork } from './quitCoordinator';

/**
 * Defect 200, through the production `installQuitCoordinator` — the function `main.ts` calls.
 *
 * - **STAND-IN (labelled):** `FakeApp` is not Electron. It follows the documented order of `app.quit()` —
 *   `before-quit` first, and only if nobody prevented it, `will-quit` and exit — and nothing else: no
 *   windows, no run loop. `ManualClock` is a fake timer.
 * - **NOT REACHED, and not reachable from here:** whether Electron's process actually exits after the
 *   re-issued `quit()`. That is the stage the 2026-10-07 observation (windows gone, process alive) points
 *   at, and these tests cannot see it. They prove the coordinator's decisions — hold or not, clean up
 *   once, bound the wait, re-issue once, log each stage — and nothing about the process.
 */

class FakeApp extends EventEmitter {
  quitCalls = 0;
  exits = 0;
  prevented = 0;
  quit(): void {
    this.quitCalls += 1;
    let stopped = false;
    this.emit('before-quit', { preventDefault: () => { stopped = true; this.prevented += 1; } });
    if (stopped) return;
    this.emit('will-quit');
    this.exits += 1;
  }
}

class ManualClock implements QuitTimers {
  private t = 0;
  private seq = 0;
  private pending = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  armed(): number {
    return this.pending.size;
  }
  advance(ms: number): void {
    this.t += ms;
    for (const [id, p] of [...this.pending].sort((a, b) => a[1].at - b[1].at)) {
      if (p.at > this.t) continue;
      this.pending.delete(id);
      p.fn();
    }
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rig(work: (QuitWork & { cleanups?: number })[]) {
  const app = new FakeApp();
  const clock = new ManualClock();
  const lines: string[] = [];
  let teardowns = 0;
  const coordinator = installQuitCoordinator({
    app,
    work,
    teardown: () => {
      teardowns += 1;
    },
    timers: clock,
    log: { info: (tag, m) => lines.push(`I [${tag}] ${m}`), warn: (tag, m) => lines.push(`W [${tag}] ${m}`) },
  });
  return { app, clock, lines, coordinator, teardowns: () => teardowns };
}

/** A work item whose cleanup is the given promise, counting its calls. */
function item(name: string, busy: boolean, cleanup: () => Promise<void>, detail?: () => string | null) {
  const w = {
    name,
    calls: 0,
    pending: () => busy,
    cleanup: () => {
      w.calls += 1;
      return cleanup();
    },
    detail,
  };
  return w;
}

const has = (lines: string[], re: RegExp) => lines.some((l) => re.test(l));

test('idle: nothing pending — the quit is not held, the teardown runs once, cleanup is never called', async () => {
  const webcam = item('webcam', false, () => Promise.resolve());
  const spike = item('webcam-spike', false, () => Promise.resolve());
  const r = rig([webcam, spike]);
  r.app.quit();
  await flush();
  assert.equal(r.app.prevented, 0, 'not held');
  assert.equal(r.app.exits, 1, 'the one quit proceeded');
  assert.equal(r.app.quitCalls, 1, 'nothing re-issued it');
  assert.equal(webcam.calls + spike.calls, 0, 'no cleanup for an idle quit');
  assert.equal(r.teardowns(), 1);
  assert.equal(r.clock.armed(), 0, 'no deadline armed');
  assert.ok(has(r.lines, /\[quit\] quit requested; nothing to wait for \(2 checked\) — proceeding/));
  assert.ok(has(r.lines, /\[quit\] will-quit reached/));
});

test('successful cleanup: held, the link left up until it settles, then one teardown and one re-issued quit', async () => {
  const d = deferred();
  const webcam = item('webcam', true, () => d.promise);
  const idle = item('webcam-spike', false, () => Promise.resolve());
  const r = rig([webcam, idle]);
  r.app.quit();
  assert.equal(r.app.prevented, 1, 'held');
  assert.equal(r.app.exits, 0);
  assert.equal(webcam.calls, 1, 'cleanup started at once');
  assert.equal(idle.calls, 0, 'only the busy item is cleaned up');
  assert.equal(r.teardowns(), 0, 'the link stays up while the webcam stops');
  assert.equal(r.coordinator.phase(), 'held');
  r.clock.advance(250);
  d.resolve();
  await flush();
  assert.equal(r.teardowns(), 1);
  assert.equal(r.app.quitCalls, 2, 'the user’s quit and exactly one re-issue');
  assert.equal(r.app.exits, 1);
  assert.equal(r.clock.armed(), 0, 'the deadline was cleared');
  assert.ok(has(r.lines, /quit held for webcam; bound 10000 ms/));
  assert.ok(has(r.lines, /webcam cleanup finished in 250 ms$/));
  assert.ok(has(r.lines, /quit re-issued \(cleanup settled\) 250 ms after it was requested/));
  assert.ok(!has(r.lines, /^W /), 'no warning on the clean path');
});

test('rejected cleanup: logged by error name only, never by message, and the quit still proceeds once', async () => {
  const webcam = item('webcam', true, () => Promise.reject(new TypeError('/Users/someone/private/path 10.0.0.7')));
  const thrower = item('webcam-spike', true, () => {
    throw new RangeError('synchronous');
  });
  const r = rig([webcam, thrower]);
  r.app.quit();
  await flush();
  assert.equal(r.app.exits, 1);
  assert.equal(r.app.quitCalls, 2);
  assert.equal(r.teardowns(), 1);
  assert.ok(has(r.lines, /^W \[quit\] webcam cleanup failed \(TypeError\) after 0 ms$/));
  assert.ok(has(r.lines, /^W \[quit\] webcam-spike cleanup failed \(RangeError\)/), 'a synchronous throw is a failure, not a crash');
  assert.ok(!r.lines.some((l) => l.includes('/Users/') || l.includes('10.0.0.7') || l.includes('synchronous')), 'no message content in the log');
});

test('never-settling cleanup: held until exactly the bound, then one warning naming what is unfinished, one teardown, one quit', async () => {
  const webcam = item('webcam', true, () => new Promise<void>(() => undefined), () => 'bridge pid 4242');
  const r = rig([webcam]);
  r.app.quit();
  await flush();
  r.clock.advance(QUIT_CLEANUP_BOUND_MS - 1);
  await flush();
  assert.equal(r.app.exits, 0, 'still held one millisecond before the bound');
  assert.equal(r.teardowns(), 0);
  r.clock.advance(1);
  await flush();
  assert.equal(r.app.exits, 1);
  assert.equal(r.app.quitCalls, 2);
  assert.equal(r.teardowns(), 1);
  assert.equal(webcam.calls, 1);
  assert.ok(has(r.lines, /^W \[quit\] cleanup bound of 10000 ms reached with webcam \(bridge pid 4242\) unfinished; quitting without it — anything it was stopping may outlive the app$/));
  assert.ok(has(r.lines, /quit re-issued \(bound reached\) 10000 ms after it was requested/));
});

test('a cleanup that settles after the bound: logged as late, and nothing is re-issued or torn down again', async () => {
  const d = deferred();
  const webcam = item('webcam', true, () => d.promise);
  const r = rig([webcam]);
  r.app.quit();
  r.clock.advance(QUIT_CLEANUP_BOUND_MS);
  await flush();
  r.clock.advance(500);
  d.resolve();
  await flush();
  assert.equal(r.app.quitCalls, 2);
  assert.equal(r.teardowns(), 1);
  assert.ok(has(r.lines, /webcam cleanup finished in 10500 ms, after the quit was re-issued/));
});

test('repeated quit events: each held again, nothing restarted, one teardown and one re-issue in all', async () => {
  const d = deferred();
  const webcam = item('webcam', true, () => d.promise);
  const r = rig([webcam]);
  r.app.quit();
  r.app.quit();
  r.app.quit();
  await flush();
  assert.equal(r.app.prevented, 3, 'a repeat during cleanup does not slip through');
  assert.equal(webcam.calls, 1, 'cleanup started once');
  assert.equal(r.teardowns(), 0, 'no early teardown from a repeat');
  assert.equal(r.clock.armed(), 1, 'one deadline, not one per click');
  assert.equal(r.lines.filter((l) => l.includes('quit requested again while cleanup runs')).length, 2);
  d.resolve();
  await flush();
  assert.equal(r.app.exits, 1);
  assert.equal(r.app.quitCalls, 4, 'three requests and exactly one re-issue');
  assert.equal(r.teardowns(), 1);
  // A before-quit after release (Electron emitting again) is let through and changes nothing.
  r.app.quit();
  assert.equal(r.teardowns(), 1);
  assert.equal(webcam.calls, 1);
});

test('a work item that cannot say whether it is busy is treated as busy, and the quit still ends within the bound', async () => {
  const unsure: QuitWork = {
    name: 'webcam',
    pending: () => {
      throw new Error('state unreadable');
    },
    cleanup: () => new Promise<void>(() => undefined),
  };
  const r = rig([unsure]);
  r.app.quit();
  assert.equal(r.app.prevented, 1);
  r.clock.advance(QUIT_CLEANUP_BOUND_MS);
  await flush();
  assert.equal(r.app.exits, 1);
  assert.ok(has(r.lines, /webcam: could not tell whether it has work \(Error\); treating it as busy/));
});

// ---- main.ts installs this, and nothing else listens to before-quit ------------------------------------

test('main.ts: the coordinator is the only before-quit writer, with the webcam, the spike and the link teardown', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Control: the file was read and stripped, and still has its other app listener.
  assert.ok(main.includes("app.on('will-quit', () => clearPreviews('app quit'))"), 'control: main.ts as expected');
  assert.equal(main.match(/before-quit/g)?.length ?? 0, 0, 'no before-quit listener outside the coordinator');
  const start = main.indexOf('installQuitCoordinator({');
  assert.ok(start > 0, 'main.ts installs the coordinator');
  const call = main.slice(start, main.indexOf('\n});', start));
  for (const piece of [
    "name: 'webcam'",
    'pending: () => webcam?.busy() ?? false',
    'cleanup: () => webcam?.dispose() ?? Promise.resolve()',
    'webcam?.bridgePid()',
    "name: 'webcam-spike'",
    'pending: () => webcamSpike?.busy() ?? false',
    'cleanup: () => webcamSpike?.dispose() ?? Promise.resolve()',
    "video?.close('app quit')",
    "link?.stop('app quit')",
  ]) {
    assert.ok(call.includes(piece), `the coordinator call lacks ${piece}`);
  }
});
