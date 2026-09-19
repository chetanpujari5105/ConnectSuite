import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installFakeDocument, installFakeWindow, FakeElement } from './domDouble.testkit';

/**
 * The status island against the connected-device strip, driven through the **real** `ShellView`.
 *
 * ### The failure this exists for
 *
 * The island said random things while the phone was connected, and showed errors that were not
 * happening, two inches from a strip reading `Connected` and a live latency. One statement did it:
 *
 * ```ts
 * this.setIsland(this.events[this.eventIndex]!, toneOf(this.status));   // shell.ts, deleted
 * ```
 *
 * **Text from a six-slot history ring on a 5.2-second timer, tone from the live link.** Two clocks
 * in one pill. The ring had no clock at all — `ActivityEvent.at` was dropped at the boundary and
 * the ring was never cleared on disconnect, reconnect or a pairing change — so a refusal from the
 * start of the session cycled in green beside `Connected · 12 ms` for the rest of it.
 *
 * ### Why this file exists as well as `shared/islandState.test.ts`
 *
 * That one proves the **decision** over a cross-product of every link state. This one proves the
 * **write** — that the two elements actually receive it, together, on every path that touches
 * either.
 *
 * `CLAUDE.md` records why both are needed and the case is defect 67: eleven tests, six mutations,
 * both sides of a threshold, green throughout, over a feature that had never once worked, because
 * the rule was right and the *write* was somewhere no test could reach. The island was that shape
 * exactly — `islandRota.ts` had nine tests and they were all correct. The contradiction lived in
 * `setStatus` and in a `setInterval`, and nothing could see either.
 *
 * So the assertions below read `#island-text` and the sidebar device card's `#device-state` **as the shell wrote them**,
 * after every status in a sequence, and again after firing every timer the shell has scheduled.
 * The DOM is `domDouble.testkit.ts`, which says which half that leaves unmeasured.
 */

const require_ = createRequire(import.meta.url);

type Pairing = { kind: 'unpaired' | 'paired' | 'repudiated' };
interface Status {
  phase: string;
  deviceName?: string;
  address?: string;
  via?: string;
  rttMs?: number;
  lastError?: string;
  lastFailureKind?: string;
  paired: boolean;
  pairing?: Pairing;
}

interface Shell {
  setStatus(status: Status | null): void;
  setWork(work: { verb: string; subject: string } | null): void;
}

/** Every sentence the app can use to name a connection state, derived from the two live functions. */
function connectionLabels(): string[] {
  const { linkToneLabel, pairingLabel } = require_('../shared/linkTone.ts') as {
    linkToneLabel: (p?: string, h?: Pairing, l?: boolean) => string;
    pairingLabel: (h?: Pairing) => string;
  };
  const out = new Set<string>();
  for (const phase of [undefined, 'idle', 'searching', 'connecting', 'handshaking', 'connected', 'reconnecting', 'disconnected']) {
    for (const pairing of [undefined, { kind: 'unpaired' }, { kind: 'paired' }, { kind: 'repudiated' }] as (Pairing | undefined)[]) {
      for (const paired of [true, false]) out.add(linkToneLabel(phase, pairing, paired));
    }
  }
  for (const pairing of [{ kind: 'unpaired' }, { kind: 'paired' }, { kind: 'repudiated' }] as Pairing[]) {
    out.add(pairingLabel(pairing));
  }
  return [...out];
}

/**
 * Build the shell against a fake document, and hand back the four elements under test.
 *
 * `shell.ts` is a plain script that constructs its own instance at parse time, so the doubles are
 * installed **before** it is required. The class is reached through `globalThis`, which is the same
 * seam every other renderer view test uses — the real class, not a paraphrase of it.
 */
function mount(): {
  shell: Shell;
  island: FakeElement;
  islandDot: FakeElement;
  strip: FakeElement;
  stripDot: FakeElement;
  timers: { id: number; kind: 'timeout' | 'interval'; delay: number; fn: () => void }[];
  restore: () => void;
} {
  const doc = installFakeDocument({ byId: true });
  const win = installFakeWindow();
  const byId = (globalThis as unknown as { document: { getElementById(id: string): FakeElement } })
    .document.getElementById;

  // The one landmark `route()` reaches by class rather than by id.
  const appWindow = byId('probe-app-window');
  appWindow.className = 'app-window';

  const g = globalThis as Record<string, unknown>;
  // `routeChanged` is the only thing the shell asks the main process for during construction.
  g.connect = { routeChanged: () => {} };
  Object.assign(g, require_('../shared/linkTone.ts'));
  Object.assign(g, require_('../shared/islandState.ts'));
  Object.assign(g, require_('./icons.ts'));
  Object.assign(g, require_('./navModel.ts'));
  require_('./shell.ts');

  // Reached the way `scripts/check-renderer-views.mjs` recognises a real construction, because
  // this file is what takes `ShellView` off its debt list.
  const View = (globalThis as Record<string, unknown>).ShellView as new () => Shell;
  const shell = new View();
  return {
    shell,
    island: byId('island-text'),
    islandDot: byId('island-dot'),
    strip: byId('device-state'),
    stripDot: byId('device-dot'),
    timers: win.timers,
    restore: () => {
      win.restore();
      doc.restore();
    },
  };
}

const LABELS = connectionLabels();

const { islandState } = require_('../shared/islandState.ts') as {
  islandState(
    link: Status | null,
    work: { verb: string; subject: string } | null,
  ): { text: string; tone: string };
};

/**
 * The assertion the whole file is for. **Three halves, and the third was added by a mutation.**
 *
 *  1. the island's **text** names no connection state but the strip's;
 *  2. the island's **dot** carries the strip's tone;
 *  3. the island's text is **exactly what the live state produces** — nobody else wrote it.
 *
 * The first two were the obvious reading of *"it must never contradict the connection state drawn
 * beside it"*, and reinstating the rota proved them insufficient: a ring cycling
 * `Sent to phone · 57 bytes, automatically` during an outage passes both. It names no connection
 * state, so (1) is silent, and the old code painted the dot from the live link, so (2) was the one
 * thing it always got right. Yet the pill is asserting a send over a socket that is gone, which is
 * the defect in every sense that matters.
 *
 * So the check is not *does the text avoid the wrong words* — a filter, and one a new sentence
 * walks straight through — but **is the text the one the current state produces**. Any second
 * writer fails it on its first tick, whatever it says.
 *
 * `islandState` is called rather than restated. `CLAUDE.md`: a test containing a second expression
 * of the rule it is checking is testing a copy, and the two disagree eventually. The rule has one
 * home; this asserts that the DOM holds what that home returns, which is the layer the defect was
 * in and the layer `shared/islandState.test.ts` cannot reach.
 */
function assertAgrees(
  where: string,
  island: FakeElement,
  islandDot: FakeElement,
  strip: FakeElement,
  stripDot: FakeElement,
  live: { status: Status | null; work: { verb: string; subject: string } | null },
): void {
  const text = island.textContent;
  const label = strip.textContent;
  const wrong = LABELS.filter((name) => name !== label && text.includes(name));
  assert.deepEqual(
    wrong,
    [],
    `${where}: the island says “${text}” while the sidebar card says “${label}” — it names ${wrong.join(', ')}`,
  );
  assert.equal(
    islandDot.getAttribute('data-state'),
    stripDot.getAttribute('data-state'),
    `${where}: the island's dot is ${islandDot.getAttribute('data-state')} and the sidebar card's is ${stripDot.getAttribute('data-state')}`,
  );
  const expected = islandState(live.status, live.work);
  assert.equal(
    text,
    expected.text,
    `${where}: the island says “${text}” where the live state produces “${expected.text}” — something other than the state wrote the pill`,
  );
}

/**
 * A real session, in the order it happens, including every transition that used to break.
 *
 * These are transitions rather than hand-built states, which is the point: defect 67's rule is that
 * a state machine fails at its edges and an edge is a **write**. Every entry here is one call to
 * `setStatus` or `setWork` on the real shell.
 */
const SESSION: { what: string; status: Status | null; work?: { verb: string; subject: string } | null }[] = [
  { what: 'first status of the session', status: { phase: 'searching', paired: true, pairing: { kind: 'paired' } } },
  { what: 'connected', status: { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 9, deviceName: 'SM-S938B' } },
  // A heartbeat. This is what used to flood the six-slot ring with six latency variants in twenty
  // seconds, and what overwrote whatever the rota had just cycled to.
  { what: 'a heartbeat moves the latency', status: { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 12, deviceName: 'SM-S938B' } },
  { what: 'a transfer starts', status: { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 12, deviceName: 'SM-S938B' }, work: { verb: 'Copying', subject: 'clip_final.mp4' } },
  // The link drops **while the transfer is in flight**. The island must follow the link, not the
  // transfer: a copy is not happening over a socket that is gone.
  {
    what: 'the link drops mid-transfer',
    status: { phase: 'reconnecting', paired: true, pairing: { kind: 'paired' }, lastError: 'The connection to your phone dropped. Reconnecting.', lastFailureKind: 'dropped', deviceName: 'SM-S938B' },
  },
  { what: 'the transfer is cleared', status: { phase: 'reconnecting', paired: true, pairing: { kind: 'paired' }, lastError: 'The connection to your phone dropped. Reconnecting.', lastFailureKind: 'dropped', deviceName: 'SM-S938B' }, work: null },
  { what: 'nothing answers', status: { phase: 'disconnected', paired: true, pairing: { kind: 'paired' }, lastError: 'Could not reach your phone.', lastFailureKind: 'unreachable', deviceName: 'SM-S938B' } },
  // Recovery. This is the one the user reported: the error is over, and it used to keep cycling.
  { what: 'the link comes back', status: { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 14, deviceName: 'SM-S938B' } },
  { what: 'the phone forgets this Mac', status: { phase: 'reconnecting', paired: true, pairing: { kind: 'repudiated' }, lastError: 'Your phone no longer recognises this Mac.', lastFailureKind: 'certificate-refused' } },
  { what: 're-paired and connected', status: { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 11, deviceName: 'SM-S938B' } },
  { what: 'unpaired', status: { phase: 'idle', paired: false, pairing: { kind: 'unpaired' } } },
];

test('control: the harness reads the real elements, and they change', () => {
  // The denominator. An agreement assertion over two elements nobody ever wrote to passes forever.
  const m = mount();
  try {
    assert.ok(LABELS.length >= 6, `only ${LABELS.length} connection labels`);
    m.shell.setStatus(SESSION[1]!.status);
    assert.equal(m.strip.textContent, 'Connected', 'the strip was written');
    assert.equal(m.island.textContent, 'Connected · 9 ms', 'the island was written');
    m.shell.setStatus(SESSION[6]!.status);
    assert.equal(m.strip.textContent, 'Disconnected');
    assert.notEqual(m.island.textContent, 'Connected · 9 ms', 'the island moved with the status');
  } finally {
    m.restore();
  }
});

test('the island never contradicts the strip, at any point in a real session', () => {
  const m = mount();
  try {
    let checked = 0;
    let work: { verb: string; subject: string } | null = null;
    for (const step of SESSION) {
      if (step.work !== undefined) {
        work = step.work;
        m.shell.setWork(work);
      }
      m.shell.setStatus(step.status);
      const live = { status: step.status, work };
      assertAgrees(step.what, m.island, m.islandDot, m.strip, m.stripDot, live);
      checked += 1;

      /*
       * And again after every timer the shell has scheduled has fired.
       *
       * This is the half that would have caught the original defect, and nothing else here would
       * have. The contradiction was not in any status update — it appeared 5.2 seconds later, when
       * a `setInterval` nobody was looking at overwrote the pill from a different source. So every
       * pending timer is fired at every step, and the agreement must survive all of them.
       */
      for (const timer of [...m.timers]) {
        timer.fn();
        assertAgrees(`${step.what}, after a ${timer.delay}ms ${timer.kind}`, m.island, m.islandDot, m.strip, m.stripDot, live);
      }
    }
    assert.equal(checked, SESSION.length, 'control: every step ran');
  } finally {
    m.restore();
  }
});

test('the island holds no timer of its own', () => {
  /*
   * The structural half, stated directly rather than inferred from behaviour.
   *
   * The rota was a `window.setInterval(…, 5200)`. Its absence is what makes the agreement above a
   * property of the design instead of a coincidence of this session's ordering: with no timer there
   * is no second writer, and the island is a pure function of the status the strip reads.
   *
   * Asserted on the delay rather than on a count, so a `toast` timeout — which is a different
   * surface with a different rule — does not have to be enumerated here to keep this honest.
   */
  const m = mount();
  try {
    m.shell.setStatus(SESSION[1]!.status);
    m.shell.setWork({ verb: 'Copying', subject: 'clip_final.mp4' });
    const intervals = m.timers.filter((t) => t.kind === 'interval');
    assert.deepEqual(
      intervals.map((t) => t.delay),
      [],
      `the shell scheduled ${intervals.length} interval(s): ${intervals.map((t) => `${t.delay}ms`).join(', ')}`,
    );
  } finally {
    m.restore();
  }
});

test('a stale failure left on a connected status is not drawn', () => {
  /*
   * *"sometimes shows errors that are not happening"*, at the write.
   *
   * `link.ts` had a second, independent cause of exactly this: `lastFailure` was assigned in four
   * places and cleared in **none**, while `status()` returns `lastFailure?.message ?? lastError`.
   * So after one failure every subsequent status — `connected` included — carried that sentence
   * for the rest of the session. That is fixed there, and the island must not depend on it having
   * been fixed: a failure reported alongside a live link is not happening, whoever forgot to clear
   * it.
   */
  const m = mount();
  try {
    m.shell.setStatus({
      phase: 'connected',
      paired: true,
      pairing: { kind: 'paired' },
      rttMs: 12,
      deviceName: 'SM-S938B',
      lastError: 'Could not reach your phone. Check that both are on the same Wi-Fi.',
      lastFailureKind: 'unreachable',
    });
    assert.equal(m.island.textContent, 'Connected · 12 ms');
    assert.equal(m.islandDot.getAttribute('data-state'), 'live');
  } finally {
    m.restore();
  }
});

test('work is drawn while it runs and gone the moment it is cleared', () => {
  const m = mount();
  try {
    const connected: Status = { phase: 'connected', paired: true, pairing: { kind: 'paired' }, rttMs: 12, deviceName: 'SM-S938B' };
    m.shell.setStatus(connected);
    assert.equal(m.island.textContent, 'Connected · 12 ms');
    m.shell.setWork({ verb: 'Sending', subject: 'report.pdf' });
    assert.equal(m.island.textContent, 'Sending report.pdf');
    // No tail, no fade, no timer: the caller that started the work cleared it, and the pill is back
    // to the connection state in the same tick.
    m.shell.setWork(null);
    assert.equal(m.island.textContent, 'Connected · 12 ms');
  } finally {
    m.restore();
  }
});
