/**
 * The four pairing steps the handoff draws beside the code — *Waiting for a scan · Found your phone
 * · Verifying certificates · Paired* — as a decision over the three facts the Mac actually has.
 *
 * ### Why this is a module and not four `if`s in the renderer
 *
 * `renderer.ts` is reachable by no test, and a progress column is exactly the shape that goes wrong
 * quietly: every step drawn as *done* the moment the screen opens, or a step that never advances
 * because the fact it waits on arrives on a channel nobody wired. The facts here are:
 *
 *  - **`sighted`** — a phone published this Mac's fingerprint over mDNS (F6 / P3). It is a positive
 *    only: `docs/protocol.md` says an absence is not evidence, because mDNS is dropped by client
 *    isolation and by some routers, and because a phone may not have published yet.
 *  - **`phase`** — the link's own state. A connection attempt means a phone has found this Mac and
 *    is presenting a certificate, which is step 3 whether or not mDNS was ever seen.
 *  - **`paired`** — the trust store has it.
 *
 * ### The rule that matters, and it is about what *not* to claim
 *
 * **A later fact advances the earlier steps; an earlier absence never retracts a later one.** A
 * handshake in progress means the phone found this Mac, so step 2 is done even with no sighting —
 * otherwise a Mac on a router that drops mDNS would sit at *Waiting for a scan* while the phone was
 * two steps further on. And nothing ever draws a **failed** step: a phone that has not paired yet
 * has not failed (handoff §6 — *"Failure is amber, never red"*), so a rejection is drawn by the
 * rejection banner, which says what the phone said, and the steps simply stay where they are.
 */

type PairStepState = 'done' | 'active' | 'waiting';

interface PairStep {
  id: 'scan' | 'found' | 'verify' | 'paired';
  label: string;
  state: PairStepState;
  /** A fact this step has earned the right to print: the device, the address, the fingerprint. */
  note: string | null;
}

interface PairStepsInput {
  /** A phone has published this Mac's fingerprint over mDNS. Positive only — never a negative. */
  sighted: boolean;
  /** The sighting's device name, when mDNS carried one. */
  sightedName?: string | null;
  /** The link phase: `connecting`, `handshaking`, `connected`, … */
  phase?: string | null;
  paired: boolean;
  /** This Mac's own fingerprint, printed on the verify step so the two can be compared by eye. */
  fingerprint?: string | null;
  /** Where the phone is, once there is a connection to name. */
  address?: string | null;
  /**
   * Whether a code can be scanned at all — false when this Mac has no address to put in one
   * (`34:12152`). Defaults to true, so every existing caller reads exactly as it did.
   */
  scannable?: boolean;
}

const HANDSHAKING = new Set(['connecting', 'handshaking', 'pairing']);

function pairSteps(input: PairStepsInput): PairStep[] {
  const connected = input.phase === 'connected';
  const verifying = HANDSHAKING.has(input.phase ?? '');
  // A later fact advances the earlier steps — see the note above.
  const found = input.sighted || verifying || connected || input.paired;
  const verified = input.paired || connected;

  /*
   * With no network there is no code, so *Waiting for a scan* would be this column claiming a
   * thing is in progress beside a card explaining that it cannot start — the status island's two
   * writers, in two surfaces two inches apart, each current and the pair contradicting.
   *
   * It stays `active` rather than becoming a fifth, failed state: nothing has failed (handoff §6),
   * and the step is still the one that is happening. Only what it is waiting *for* changes. A
   * later fact still wins, in both directions — a Mac that regained its network between the read
   * and the draw is `found`, and this never retracts that.
   */
  const blocked = input.scannable === false && !found;
  const scan: PairStep = {
    id: 'scan',
    label: blocked ? 'Waiting for a network' : 'Waiting for a scan',
    state: found ? 'done' : 'active',
    note: found
      ? null
      : blocked
        ? 'A code carries this Mac’s address, and there is none yet.'
        : 'Open Sidekick on the phone, tap Scan pairing code, and point the camera at this code.',
  };

  const foundStep: PairStep = {
    id: 'found',
    label: found ? 'Found your phone' : 'Find your phone',
    state: verified || verifying ? 'done' : found ? 'active' : 'waiting',
    note: found
      ? [input.sightedName ?? null, input.address ?? null].filter(Boolean).join(' · ') ||
        'A phone scanned this code and is looking for this Mac.'
      : null,
  };

  const verify: PairStep = {
    id: 'verify',
    label: 'Confirming it’s your phone',
    state: verified ? 'done' : verifying ? 'active' : 'waiting',
    // No key is printed here (UX batch 2026-10-10). QR pairing has no step where a person compares
    // two keys — the phone shows none on this path (Android plan decision 3) — so a hex string here
    // was mechanism, not something to check. The keys are still exchanged and pinned exactly as
    // before; the Mac's own key is in Settings → Advanced for anyone who wants it.
    note: null,
  };

  const paired: PairStep = {
    id: 'paired',
    label: 'Paired',
    state: input.paired ? 'done' : verified ? 'active' : 'waiting',
    note: input.paired ? 'This Mac reconnects on its own from now on.' : null,
  };

  return [scan, foundStep, verify, paired];
}

{
  const g = globalThis as Record<string, unknown>;
  g.pairSteps = pairSteps;
}

if (typeof module !== 'undefined') {
  module.exports = { pairSteps };
}
