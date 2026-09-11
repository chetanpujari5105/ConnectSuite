import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { islandState, islandReason } = require_('./islandState.ts') as {
  islandState(
    link: {
      phase?: string;
      pairing?: { kind: 'unpaired' | 'paired' | 'repudiated' };
      paired?: boolean;
      rttMs?: number;
      lastError?: string | null;
      lastFailureKind?: string | null;
    } | null,
    work: { verb: string; subject: string } | null,
  ): { text: string; tone: string };
  islandReason(kind: string | null | undefined): string | null;
};
const { linkTone, linkToneLabel, pairingLabel } = require_('./linkTone.ts') as {
  linkTone: (p?: string, h?: { kind: string }, l?: boolean, e?: string) => string;
  linkToneLabel: (p?: string, h?: { kind: string }, l?: boolean) => string;
  pairingLabel: (h?: { kind: string }) => string;
};
const { classifyLinkError } = require_('./linkHealth.ts') as {
  classifyLinkError: (raw?: string) => { kind: string; message: string } | null;
};

/**
 * The status island's rule, and the invariant the whole file exists for.
 *
 * ### The failure being guarded
 *
 * The island drew a sentence taken from a six-slot history ring and a colour taken from the live
 * link, in one statement. So it routinely asserted a connection state the device strip two inches
 * away was denying: a refusal from ten minutes ago in green beside `Connected · 12 ms`, and
 * `Connected · 12 ms` in amber beside `Reconnecting`.
 *
 * ### Why this is a cross-product and not a list of cases
 *
 * A handful of hand-picked statuses would prove the cases somebody thought of, which is the shape
 * that let the old bug live — every input in the old test was well-formed and constructed by hand.
 * So [EVERY_LINK] enumerates the product of every phase, every pairing kind, both `paired` values,
 * present and absent latency, and every `LinkFailure.kind` including the ones no test names, and
 * the invariant is asserted over all of them mechanically.
 *
 * `shellIsland.test.ts` is the other half: this file proves the decision, that one proves the
 * **write** — that the pill and the strip actually receive it. Defect 67's rule is that a correct
 * decision and an untested write is exactly how a feature stays broken under a green suite, and
 * the island was that shape.
 */

/** Every phase `ConnectionPhase` can hold, plus `undefined` and a value from the future. */
const PHASES = [
  undefined,
  'idle',
  'searching',
  'connecting',
  'handshaking',
  'connected',
  'reconnecting',
  'disconnected',
  'a-phase-added-after-this-test-was-written',
];

const PAIRINGS: ({ kind: 'unpaired' | 'paired' | 'repudiated' } | undefined)[] = [
  undefined,
  { kind: 'unpaired' },
  { kind: 'paired' },
  { kind: 'repudiated' },
];

/** Every `LinkFailureKind`, plus absence, plus one nobody has defined. */
const FAILURE_KINDS = [
  undefined,
  null,
  'certificate-refused',
  'unreachable',
  'dropped',
  'protocol',
  'unknown',
  'a-kind-added-after-this-test-was-written',
];

interface Link {
  phase?: string;
  pairing?: { kind: 'unpaired' | 'paired' | 'repudiated' };
  paired?: boolean;
  rttMs?: number;
  lastError?: string | null;
  lastFailureKind?: string | null;
}

function everyLink(): Link[] {
  const out: Link[] = [];
  for (const phase of PHASES) {
    for (const pairing of PAIRINGS) {
      for (const paired of [true, false]) {
        for (const rttMs of [undefined, 0, 12, 4096]) {
          for (const kind of FAILURE_KINDS) {
            // `lastError` and `lastFailureKind` are set together by `link.ts` — both from one
            // `LinkFailure` — so the pair is generated together rather than independently. The
            // sentence is the real classified prose, because the point of the check below is that
            // *this* text can never reach the pill.
            const failure = kind == null ? null : { kind, message: FAILURE_PROSE[kind] ?? 'x' };
            out.push({
              phase,
              pairing,
              paired,
              rttMs,
              lastError: failure?.message ?? null,
              lastFailureKind: failure?.kind ?? null,
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * The real classified sentence for each kind, pulled from `classifyLinkError` rather than typed
 * here, so this test cannot drift from the prose it is asserting about.
 *
 * The `dropped` row is the one that matters and it is why the island reads a kind instead of a
 * message: *"The connection to your phone dropped. Reconnecting."* **names a connection state.**
 */
const FAILURE_PROSE: Record<string, string> = {
  'certificate-refused': classifyLinkError('SSL alert number 46')!.message,
  unreachable: classifyLinkError('ETIMEDOUT')!.message,
  dropped: classifyLinkError('socket hang up')!.message,
  protocol: classifyLinkError('protocol error')!.message,
  unknown: classifyLinkError('something nobody classified')!.message,
  'a-kind-added-after-this-test-was-written': 'a sentence for a kind nobody has defined',
};

/**
 * Every sentence the app can use to name a connection state — the two functions the strip reads,
 * over the same product.
 *
 * Derived rather than typed, which is the control on the check itself: a label added to
 * `linkToneLabel` tomorrow joins this set automatically, so the invariant cannot quietly stop
 * covering the newest way to contradict the strip.
 */
function everyConnectionLabel(): string[] {
  const labels = new Set<string>();
  for (const phase of PHASES) {
    for (const pairing of PAIRINGS) {
      for (const paired of [true, false]) {
        labels.add(linkToneLabel(phase, pairing, paired));
      }
    }
  }
  for (const pairing of PAIRINGS) labels.add(pairingLabel(pairing));
  return [...labels];
}

const LINKS = everyLink();
const LABELS = everyConnectionLabel();

test('control: the product and the label set are both populated and varied', () => {
  // The denominator. An invariant asserted over an empty product passes forever and says nothing,
  // which is the failure this repo has recorded more than once — a green check over no readings.
  assert.ok(LINKS.length > 1500, `only ${LINKS.length} links in the product`);
  assert.ok(LABELS.length >= 6, `only ${LABELS.length} connection labels: ${LABELS.join(', ')}`);
  for (const expected of ['Connected', 'Connecting', 'Reconnecting', 'Looking for phone', 'Disconnected', 'Not paired']) {
    assert.ok(LABELS.includes(expected), `${expected} is not in the derived label set`);
  }
  // And the product actually reaches every tone, or the invariant is only testing one branch.
  const tones = new Set(LINKS.map((l) => islandState(l, null).tone));
  assert.deepEqual([...tones].sort(), ['down', 'idle', 'live', 'working']);
});

/* ---- The invariant ------------------------------------------------------------------------- */

/**
 * The island may name **one** connection state, and it must be the one the strip is drawing.
 *
 * Checked case-sensitively, which is exact rather than lucky: `Connecting` is not a substring of
 * `Reconnecting` (that has a lowercase `c`), and `Connected` is not a substring of anything else.
 */
function contradictions(text: string, live: string): string[] {
  return LABELS.filter((label) => label !== live && text.includes(label));
}

for (const work of [null, { verb: 'Copying', subject: 'clip_final.mp4' }]) {
  test(`the island never contradicts the connection state — work: ${work ? work.verb : 'none'}`, () => {
    let checked = 0;
    for (const link of LINKS) {
      const island = islandState(link, work);
      const live = linkToneLabel(link.phase, link.pairing, link.paired, );
      const liveTone = linkTone(link.phase, link.pairing, link.paired, link.lastError ?? undefined);

      assert.equal(
        island.tone,
        liveTone,
        `tone ${island.tone} against the strip's ${liveTone} for ${JSON.stringify(link)}`,
      );
      assert.deepEqual(
        contradictions(island.text, live),
        [],
        `“${island.text}” names a connection state other than “${live}” — ${JSON.stringify(link)}`,
      );
      checked += 1;
    }
    assert.equal(checked, LINKS.length, 'control: every link in the product was checked');
  });
}

test('a failure sentence never reaches the pill, whatever it says', () => {
  // The structural half, stated on its own: the island reads a kind, so no amount of rewriting
  // `classifyLinkError`'s prose can put a connection state in the pill. This is the check that a
  // filter over the message could not make — a filter passes until somebody writes a new sentence.
  const prose = Object.values(FAILURE_PROSE);
  assert.ok(prose.some((p) => p.includes('Reconnecting')), 'control: at least one sentence names a state');
  for (const link of LINKS) {
    const { text } = islandState(link, null);
    for (const sentence of prose) {
      assert.ok(!text.includes(sentence), `the classified sentence reached the pill: “${text}”`);
    }
  }
});

/* ---- What each state says ------------------------------------------------------------------- */

const connected = (over: Partial<Link> = {}): Link => ({
  phase: 'connected',
  pairing: { kind: 'paired' },
  paired: true,
  rttMs: 12,
  ...over,
});

test('connected and idle: the connection state and the live latency, and nothing else', () => {
  assert.deepEqual(islandState(connected(), null), { text: 'Connected · 12 ms', tone: 'live' });
  // Before the first heartbeat the label stands alone. "Connected · —" is a glyph to decode.
  assert.deepEqual(islandState(connected({ rttMs: undefined }), null), { text: 'Connected', tone: 'live' });
});

test('connected with a stale failure still on the status: no error in the pill', () => {
  // The user's sentence, exactly: *sometimes shows errors that are not happening*. `link.ts` now
  // clears `lastFailure` on a successful handshake, but the island must not depend on that — a
  // failure while the tone is `live` is not happening, whoever forgot to clear it.
  assert.deepEqual(
    islandState(connected({ lastError: FAILURE_PROSE.dropped, lastFailureKind: 'dropped' }), null),
    { text: 'Connected · 12 ms', tone: 'live' },
  );
});

test('connecting, reconnecting, searching: the state, with the reason when there is one', () => {
  const p = { kind: 'paired' } as const;
  assert.equal(islandState({ phase: 'searching', pairing: p, paired: true }, null).text, 'Looking for phone');
  assert.equal(islandState({ phase: 'connecting', pairing: p, paired: true }, null).text, 'Connecting');
  assert.equal(islandState({ phase: 'handshaking', pairing: p, paired: true }, null).text, 'Connecting');
  assert.equal(islandState({ phase: 'reconnecting', pairing: p, paired: true }, null).text, 'Reconnecting');
  assert.deepEqual(
    islandState(
      { phase: 'reconnecting', pairing: p, paired: true, lastError: FAILURE_PROSE.unreachable, lastFailureKind: 'unreachable' },
      null,
    ),
    { text: 'Reconnecting · no answer on any known address', tone: 'working' },
  );
});

test('a reason is withheld while a socket attempt is actually in flight', () => {
  /*
   * Found on hardware rather than reasoned out. The phone went away mid-session and the pill read
   * **`Connecting · no answer on any known address`** — dialling something while saying nothing
   * answered. Both halves true; the reason describes the *previous* attempt and the label describes
   * the one in flight, and putting them in one sentence makes them look like one moment.
   *
   * It contradicts nothing — the strip said `Connecting` too — so the invariant above and the
   * DOM-level session test were both green over it. It was found by looking at the screen, which is
   * the point of running the thing.
   */
  const p = { kind: 'paired' } as const;
  const failing = { pairing: p, paired: true, lastError: FAILURE_PROSE.unreachable, lastFailureKind: 'unreachable' };

  for (const phase of ['searching', 'connecting', 'handshaking']) {
    const { text } = islandState({ phase, ...failing }, null);
    assert.ok(
      !text.includes('no answer'),
      `${phase} drew a reason for the previous attempt: “${text}”`,
    );
  }

  // The control, and it is the half that makes the assertion above mean anything: the same failure
  // in a settled state **does** carry its reason, so this is not a test that passes because the
  // reason never renders.
  assert.equal(
    islandState({ phase: 'reconnecting', ...failing }, null).text,
    'Reconnecting · no answer on any known address',
  );
  assert.equal(
    islandState({ phase: 'disconnected', ...failing }, null).text,
    'Disconnected · no answer on any known address',
  );
});

test('failed: the state and the reason, in the down tone', () => {
  assert.deepEqual(
    islandState(
      { phase: 'disconnected', pairing: { kind: 'paired' }, paired: true, lastError: FAILURE_PROSE.dropped, lastFailureKind: 'dropped' },
      null,
    ),
    { text: 'Disconnected · the phone closed the connection', tone: 'down' },
  );
});

test('an unclassifiable failure adds nothing rather than a word count', () => {
  // "something went wrong" beside `Disconnected` is length, not information.
  assert.equal(islandReason('unknown'), null);
  assert.equal(islandReason('a-kind-added-after-this-test-was-written'), null);
  assert.equal(
    islandState(
      { phase: 'disconnected', pairing: { kind: 'paired' }, paired: true, lastError: 'x', lastFailureKind: 'unknown' },
      null,
    ).text,
    'Disconnected',
  );
});

test('unpaired and repudiated say what they are', () => {
  assert.deepEqual(islandState({ pairing: { kind: 'unpaired' }, paired: false }, null), {
    text: 'Not paired',
    tone: 'idle',
  });
  assert.deepEqual(
    islandState({ phase: 'reconnecting', pairing: { kind: 'repudiated' }, paired: true }, null),
    { text: 'Pairing was removed on the phone', tone: 'down' },
  );
});

test('no status at all is Starting…, not an invented connection state', () => {
  assert.deepEqual(islandState(null, null), { text: 'Starting…', tone: 'idle' });
  assert.deepEqual(islandState(null, { verb: 'Copying', subject: 'x.mp4' }), {
    text: 'Starting…',
    tone: 'idle',
  });
});

/* ---- Work ----------------------------------------------------------------------------------- */

test('a transfer in flight replaces the latency, and only while the link is live', () => {
  const work = { verb: 'Copying', subject: 'clip_final.mp4' };
  assert.deepEqual(islandState(connected(), work), { text: 'Copying clip_final.mp4', tone: 'live' });

  // The half that matters: work is a claim that something is crossing the link, so it cannot
  // outrank the news that the link is gone. Every non-live state ignores it.
  for (const link of LINKS.filter((l) => islandState(l, null).tone !== 'live')) {
    assert.deepEqual(
      islandState(link, work),
      islandState(link, null),
      `work was drawn over a non-live link: ${JSON.stringify(link)}`,
    );
  }
});

test('work is dropped the moment it is cleared, with no tail', () => {
  // There is no timer in this file and no timestamp, which is the fix expressed as a type: a
  // function with no clock cannot show a stale line. Clearing is instant by construction.
  assert.deepEqual(islandState(connected(), { verb: 'Sending', subject: 'a.pdf' }).text, 'Sending a.pdf');
  assert.deepEqual(islandState(connected(), null).text, 'Connected · 12 ms');
});
