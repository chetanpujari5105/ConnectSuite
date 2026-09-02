/**
 * The connection's tone and label, in a file the renderer can load as a plain `<script>`.
 *
 * ### Why this is a separate file from `linkHealth.ts`
 *
 * The renderer is loaded as plain script tags and cannot `import`. `shared/appLabel.ts` established
 * the pattern this file follows: **no top-level `export`**, so the declarations land on `globalThis`
 * in the browser, plus a `module.exports` block so the main process and `node --test` reach the
 * *same file* by `require`. An indirection, never a second implementation — that is defect 46's fix
 * and the reason `linkHealth.ts` requires this rather than restating it.
 *
 * ### The precedence, which is the whole content
 *
 * **Repudiation outranks the transport phase.** This was written out in `shell.ts` once and got
 * wrong: `toneLabel` switched on `phase` first, so a repudiated pairing reconnecting forever drew
 * *"Reconnecting"* — the exact sentence the state exists to replace — and only the `default` branch
 * had been patched. Found by looking at the screen after a real `Forget`, with the unit tests green.
 *
 * A live session outranks everything, because a working link is not a hypothesis.
 */

type LinkToneName = 'live' | 'working' | 'down' | 'idle';
type PairingKind = 'unpaired' | 'paired' | 'repudiated';

/** The sentence for a pairing state. One home, so the sidebar and the pairing screen agree. */
function pairingLabel(health: { kind: PairingKind } | undefined): string {
  switch (health?.kind) {
    case 'unpaired':
      return 'No phone paired';
    case 'repudiated':
      return 'Pairing was removed on the phone';
    case 'paired':
      return 'Paired';
    default:
      return 'No phone paired';
  }
}

/** Whether this state needs the user to scan. True for everything that is not a healthy pairing. */
function needsPairing(health: { kind: PairingKind } | undefined): boolean {
  return health?.kind !== 'paired';
}

function linkTone(
  phase: string | undefined,
  health: { kind: PairingKind } | undefined,
  legacyPaired: boolean,
  lastError: string | undefined,
): LinkToneName {
  if (phase === 'connected') return 'live';
  // Before the phase, deliberately. Retrying against a phone that will refuse every attempt is not
  // "working" — it is broken in a way waiting cannot fix.
  if (health?.kind === 'repudiated') return 'down';
  if (health ? health.kind === 'unpaired' : !legacyPaired) return 'idle';
  if (phase === 'searching' || phase === 'connecting' || phase === 'handshaking') return 'working';
  if (phase === 'reconnecting') return 'working';
  return lastError ? 'down' : 'idle';
}

function linkToneLabel(
  phase: string | undefined,
  health: { kind: PairingKind } | undefined,
  legacyPaired: boolean,
): string {
  if (phase === 'connected') return 'Connected';
  if (health?.kind === 'repudiated') return pairingLabel(health);
  if (health?.kind === 'unpaired') return 'Not paired';
  switch (phase) {
    case 'searching':
      return 'Looking for phone';
    case 'connecting':
    case 'handshaking':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    default:
      return legacyPaired ? 'Disconnected' : 'Not paired';
  }
}

// Browser: a plain script in one global scope. `typeof` on an undeclared identifier is safe in JS,
// so this is a no-op under node.
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as Record<string, unknown>;
  g.pairingLabel = pairingLabel;
  g.needsPairing = needsPairing;
  g.linkTone = linkTone;
  g.linkToneLabel = linkToneLabel;
}

// Main process and `node --test`: the same file, by require.
if (typeof module !== 'undefined') {
  module.exports = { pairingLabel, needsPairing, linkTone, linkToneLabel };
}
