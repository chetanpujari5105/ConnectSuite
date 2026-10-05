/**
 * Whether phone call audio can reach this Mac — a closed type with one value, and the two sentences
 * that say so.
 *
 * ### Why a type with one value
 *
 * The answer today is fixed: **no Mac and phone have been verified for call audio.** Android keeps a
 * live call's audio behind permissions held only by system roles, and the one standard route around
 * that — the Mac acting as a hands-free device — opened a control connection and never a voice link
 * (`docs/mac-audio-routes.md` §6–9). So `CallAudioSupport` has exactly one variant, and
 * {@link callAudioSupport} is its only producer. A future verified state would have to be *added*
 * here, deliberately, with the evidence that earns it — it cannot be reached by flipping a flag.
 *
 * ### Why two sentences
 *
 * Decided 2026-10-05 (option 1(c)):
 *
 *  - **The Calls pane** says it without naming any technology. The pane is where people act, and an
 *    earlier version of its copy told them to pair the Mac over Bluetooth — a remedy measured and
 *    retracted (defect 124). A sentence there that names Bluetooth reads as an instruction, whatever
 *    it says.
 *  - **A capability or help row** states the exact condition, because that is where a person goes to
 *    learn what this build can and cannot do. It is defined here and **not yet drawn** — drawing it
 *    is a separate, unapproved change.
 *
 * Neither sentence may tell anyone to do anything: no pairing, connecting, enabling or routing. The
 * guard is `callAudio.test.ts`, which also keeps the second sentence out of the Calls pane.
 *
 * Plain script, no `export`: the page loads it as a classic script before `calls.js` (defect 94).
 */

type CallAudioSupport = { kind: 'unavailable'; reason: 'unverified' };

/** Where a call-audio sentence is drawn. Each surface has exactly one sentence. */
type CallAudioSurface = 'calls-pane' | 'capability-row';

const CALL_AUDIO_PANE_SENTENCE =
  'Phone call audio on Mac is not available. No Mac and phone have been verified for it.';

const CALL_AUDIO_CAPABILITY_SENTENCE =
  'Phone call audio on Mac is not available unless Bluetooth hands-free compatibility has been ' +
  'verified for this device.';

/** The only answer this build can give. */
function callAudioSupport(): CallAudioSupport {
  return { kind: 'unavailable', reason: 'unverified' };
}

/** The sentence a surface draws for a given answer. */
function callAudioSentence(support: CallAudioSupport, surface: CallAudioSurface): string {
  switch (support.kind) {
    case 'unavailable':
      return surface === 'calls-pane' ? CALL_AUDIO_PANE_SENTENCE : CALL_AUDIO_CAPABILITY_SENTENCE;
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.callAudioSupport = callAudioSupport;
  g.callAudioSentence = callAudioSentence;
}
