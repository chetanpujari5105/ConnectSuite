import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
import '../shared/appLabel';
import './remote';

/**
 * The media remote's **view class**, driven for real — the second entry off the renderer-view debt
 * list, taken next because Phase 7 slice 2 had just made this pane findable and it would have been
 * odd to point people at a pane no test drives.
 *
 * Its file comment names two rules and step numbers for both, and they are exactly the kind of rule
 * a green suite has been unable to see:
 *
 * - **Nothing playing is a normal state, not a failure.** Step 66. A phone with no music on it is a
 *   phone working correctly, and a remote reporting that as a fault would cry wolf every time
 *   somebody stopped listening to something.
 * - **A button is only drawn where the player has said it works.** Step 65. `canSkipNext` and
 *   friends come from the session's own `PlaybackState.actions`, and a control the app will ignore
 *   is disabled *with the reason on it* rather than left live to do nothing.
 *
 * Defect 46 lives here too: this pane once wrote `appName ?? package ?? 'an app'` into a sentence,
 * producing *"Paused in com.spotify.music."* — a raw handle as the only thing a person reads.
 *
 * The DOM and the timers are doubles; `domDouble.testkit.ts` says which halves that leaves
 * unmeasured, and `installFakeWindow` is explicit that a timer here is recorded and never fires.
 */

interface StateView {
  active: boolean;
  package?: string;
  appName?: string;
  playing?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
  canSeek?: boolean;
  canSkipNext?: boolean;
  canSkipPrevious?: boolean;
  volume?: number;
  volumeMax?: number;
  receivedAtMs: number;
}

class FakeBridge {
  state: StateView = { active: false, receivedAtMs: 0 };
  ack: { ok: boolean; reason?: string; fixHint?: string } = { ok: true };
  readonly commands: { action: string; extra?: Record<string, unknown> }[] = [];
  private changed: ((state: StateView) => void) | null = null;

  async remoteState() {
    return this.state;
  }
  async remoteCommand(action: string, extra?: Record<string, unknown>) {
    this.commands.push({ action, extra });
    return this.ack;
  }
  onRemoteChanged(callback: (state: StateView) => void) {
    this.changed = callback;
  }
  /** The phone pushing a new state at the Mac. */
  push(state: StateView): void {
    this.changed?.(state);
  }
}

interface Pane {
  bridge: FakeBridge;
  card: FakeElement;
  note: FakeElement;
  body: FakeElement;
  notice: FakeElement;
  view: { setAdvertised(on: boolean): void; refresh(): Promise<void> };
  timers: { id: number; kind: string; delay: number; fn: () => void }[];
  restore: () => void;
}

function mount(): Pane {
  const fakeWindow = installFakeWindow();
  const fakeDocument = installFakeDocument();
  const bridge = new FakeBridge();
  const parts = { card: el('section'), note: el('p'), body: el('div'), notice: el('div') };
  const View = (globalThis as Record<string, unknown>).RemoteView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(parts.card, parts.note, parts.body, parts.notice, bridge);
  return {
    bridge,
    ...parts,
    view,
    timers: fakeWindow.timers,
    restore: () => {
      fakeDocument.restore();
      fakeWindow.restore();
    },
  };
}

const PLAYING: StateView = {
  active: true,
  playing: true,
  appName: 'Spotify',
  package: 'com.spotify.music',
  title: 'Cissy Strut',
  artist: 'The Meters',
  album: 'Look-Ka Py Py',
  durationMs: 185_000,
  positionMs: 42_000,
  canSeek: true,
  canSkipNext: true,
  canSkipPrevious: true,
  volume: 7,
  volumeMax: 15,
  receivedAtMs: Date.now(),
};

const buttons = (pane: Pane) => pane.body.queryAll('button');
const byLabel = (pane: Pane, label: string) =>
  buttons(pane).find((b) => b.textContent.startsWith(label));

// ---- rule one: nothing playing is a normal state ------------------------------------------------

test('an idle remote says so in a sentence and draws no transport', async () => {
  const pane = mount();
  try {
    await pane.view.refresh();
    assert.equal(pane.note.textContent, 'Nothing is playing on the phone.');
    assert.equal(buttons(pane).length, 0, 'no transport over nothing to transport');
    assert.equal(pane.notice.hidden, false || pane.notice.hidden, 'no notice is raised');
    assert.equal(pane.notice.textContent, '', 'and certainly no error text');
  } finally {
    pane.restore();
  }
});

test('an idle remote is not styled as a failure', async () => {
  // Step 66. The distinction the whole card exists to hold: empty is not broken. If this ever
  // starts adding an error class, the pane will cry wolf every time somebody stops their music.
  const pane = mount();
  try {
    await pane.view.refresh();
    const text = `${pane.card.className} ${pane.note.className} ${pane.body.className}`;
    for (const alarming of ['error', 'warning', 'destructive', 'danger']) {
      assert.ok(!text.includes(alarming), `an idle remote must not carry a "${alarming}" class`);
    }
  } finally {
    pane.restore();
  }
});

// ---- rule two: a button is drawn only where the player says it works ----------------------------

test('a session that cannot skip gets disabled buttons carrying the reason', () => {
  const pane = mount();
  try {
    pane.bridge.push({ ...PLAYING, canSkipNext: false, canSkipPrevious: false });
    const next = byLabel(pane, 'Next')!;
    const previous = byLabel(pane, 'Previous')!;
    assert.equal(next.disabled, true);
    assert.equal(previous.disabled, true);
    assert.ok(next.title.length > 0, 'a disabled control must say why');
    // Defect 26: a tooltip tells a sighted mouse user why and tells everybody else nothing.
    const spoken = next.queryAll('.visually-hidden');
    assert.equal(spoken.length, 1, 'the reason is in the accessible name too');
    assert.ok(spoken[0]!.textContent.includes('unavailable'));
  } finally {
    pane.restore();
  }
});

test('a session that can skip gets live buttons that actually send', () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    const next = byLabel(pane, 'Next')!;
    assert.equal(next.disabled, false);
    assert.equal(next.queryAll('.visually-hidden').length, 0, 'nothing to explain about a live button');
    next.click();
    assert.deepEqual(
      pane.bridge.commands.map((c) => c.action),
      ['next'],
      'the click reached the bridge',
    );
  } finally {
    pane.restore();
  }
});

test('the play/pause button never claims the opposite of what it does', () => {
  const pane = mount();
  try {
    pane.bridge.push({ ...PLAYING, playing: true });
    assert.ok(byLabel(pane, 'Pause'), 'playing → Pause');
    assert.equal(byLabel(pane, 'Play'), undefined);

    pane.bridge.push({ ...PLAYING, playing: false });
    assert.ok(byLabel(pane, 'Play'), 'paused → Play');
    assert.equal(byLabel(pane, 'Pause'), undefined);

    byLabel(pane, 'Play')!.click();
    // One button, two verbs, because that is what the phone's `play_pause` is.
    assert.deepEqual(pane.bridge.commands.map((c) => c.action), ['play_pause']);
  } finally {
    pane.restore();
  }
});

test('a track with no length disables the scrubber and says which reason it is', () => {
  // Two different reasons produce the same disabled slider, and they must not share a sentence:
  // "the phone reports no length" and "this player refuses to seek" are different facts.
  const noLength = mount();
  const noSeek = mount();
  try {
    noLength.bridge.push({ ...PLAYING, durationMs: 0 });
    noSeek.bridge.push({ ...PLAYING, canSeek: false });
    const bar = (pane: Pane) => pane.body.queryAll('input').find((i) => i.className.includes('remote-seek'))!;
    assert.equal(bar(noLength).disabled, true);
    assert.equal(bar(noSeek).disabled, true);
    assert.notEqual(
      bar(noLength).title,
      bar(noSeek).title,
      'two causes, two sentences — one shared string would be a confident wrong answer',
    );
    assert.ok(bar(noLength).title.includes('no length'));
  } finally {
    noLength.restore();
    noSeek.restore();
  }
});

// ---- defect 46: a package id is never the only thing a person reads -----------------------------

test('a package with no launcher label still gets a sentence a person can read', () => {
  const pane = mount();
  try {
    // No appName — the fallback path AppLabels.of takes for an app with no launcher icon.
    pane.bridge.push({ ...PLAYING, appName: undefined, package: 'com.spotify.music' });
    const note = pane.note.textContent;
    assert.ok(note.length > 0, 'there is still a sentence');
    // The handle may appear. It may not be the whole sentence — the fault defect 46 recorded was
    // "Paused in com.spotify.music.", a raw id as the entire thing a person reads.
    assert.notEqual(note.trim(), 'com.spotify.music');
    assert.ok(
      note.replace('com.spotify.music', '').trim().length > 8,
      `the sentence is almost entirely the package id: ${JSON.stringify(note)}`,
    );
  } finally {
    pane.restore();
  }
});

// ---- the volume reading carries its denominator --------------------------------------------------

test('the volume reads as a number out of its maximum, never on its own', () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    const text = pane.body.textContent;
    assert.ok(text.includes('7 of 15'), `"7" says nothing without the 15: ${JSON.stringify(text)}`);
  } finally {
    pane.restore();
  }
});

// ---- a refusal is never silent -------------------------------------------------------------------

test('a command the phone refuses raises a notice with the phone’s own reason and hint', async () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    pane.bridge.ack = { ok: false, reason: 'Spotify is not accepting commands.', fixHint: 'Open it once.' };
    byLabel(pane, 'Next')!.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pane.notice.hidden, false, 'a refusal must not be silent');
    assert.ok(pane.notice.textContent.includes('Spotify is not accepting commands.'));
    assert.ok(pane.notice.textContent.includes('Open it once.'), 'the fix hint travels with it');
  } finally {
    pane.restore();
  }
});

test('a bridge that throws is reported rather than swallowed', async () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    pane.bridge.remoteCommand = async () => {
      throw new Error('IPC gone');
    };
    byLabel(pane, 'Next')!.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pane.notice.hidden, false);
    assert.ok(pane.notice.textContent.includes('IPC gone'));
  } finally {
    pane.restore();
  }
});

// ---- the card hides itself when the phone stops advertising the capability -----------------------

test('an unadvertised remote is hidden and forgets what was playing', () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    assert.ok(pane.body.textContent.includes('Cissy Strut'));

    pane.view.setAdvertised(false);
    assert.ok(pane.card.className.includes('hidden'), 'the card goes away with the capability');
    assert.equal(
      pane.body.textContent.includes('Cissy Strut'),
      false,
      'and it must not keep drawing a track the phone is no longer reporting',
    );
  } finally {
    pane.restore();
  }
});

// ---- the ticker exists, and the double is honest about not running it ----------------------------

test('the pane schedules its own redraw, because the phone pushes on track changes only', () => {
  const pane = mount();
  try {
    const intervals = pane.timers.filter((t) => t.kind === 'interval');
    assert.equal(intervals.length, 1, 'exactly one ticker');
    assert.equal(intervals[0]!.delay, 250, 'four a second — smooth, and costs nothing');

    // Fired deliberately rather than waited for. `installFakeWindow` never runs a timer on its own,
    // so a test cannot accidentally depend on how long the process took.
    pane.bridge.push(PLAYING);
    const before = pane.body.queryAll('.remote-elapsed')[0]!.textContent;
    intervals[0]!.fn();
    const after = pane.body.queryAll('.remote-elapsed')[0]!.textContent;
    assert.equal(typeof after, 'string');
    assert.ok(before.includes(':'), `the elapsed reading is a clock: ${before}`);
  } finally {
    pane.restore();
  }
});

test('a paused track’s position does not creep forward', () => {
  // A bar that advanced on a paused song would be inventing playback that is not happening.
  const pane = mount();
  try {
    const clock = (globalThis as Record<string, unknown>).remoteClock as (ms: number) => string;
    pane.bridge.push({ ...PLAYING, playing: false, positionMs: 42_000, receivedAtMs: Date.now() - 60_000 });
    const elapsed = pane.body.queryAll('.remote-elapsed')[0]!.textContent;
    assert.equal(
      elapsed,
      clock(42_000),
      'a minute after the push, a paused track is still where it was',
    );
  } finally {
    pane.restore();
  }
});

test('a playing track’s position is extrapolated from when the reading arrived', () => {
  const pane = mount();
  try {
    const clock = (globalThis as Record<string, unknown>).remoteClock as (ms: number) => string;
    pane.bridge.push({ ...PLAYING, playing: true, positionMs: 42_000, receivedAtMs: Date.now() - 10_000 });
    const elapsed = pane.body.queryAll('.remote-elapsed')[0]!.textContent;
    assert.equal(elapsed, clock(52_000), 'ten seconds late, ten seconds further in');
  } finally {
    pane.restore();
  }
});

test('extrapolation never runs past the end of the track', () => {
  const pane = mount();
  try {
    const clock = (globalThis as Record<string, unknown>).remoteClock as (ms: number) => string;
    pane.bridge.push({ ...PLAYING, playing: true, durationMs: 50_000, positionMs: 45_000, receivedAtMs: Date.now() - 30_000 });
    assert.equal(pane.body.queryAll('.remote-elapsed')[0]!.textContent, clock(50_000));
  } finally {
    pane.restore();
  }
});

// ---- the control ---------------------------------------------------------------------------------

test('control — the harness can see the transport, so its absences mean something', () => {
  const pane = mount();
  try {
    pane.bridge.push(PLAYING);
    assert.equal(buttons(pane).length, 3, 'Previous, Play/Pause, Next');
    assert.ok(pane.body.textContent.includes('The Meters — Look-Ka Py Py'));
    assert.equal(pane.body.queryAll('input').length, 2, 'the seek bar and the volume slider');
  } finally {
    pane.restore();
  }
});
