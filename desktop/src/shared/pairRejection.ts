import type { PairRejectReason, PairRejected } from './protocol';

/**
 * What the Mac says to a person when the phone refuses a pairing.
 *
 * ### Why the phone's sentence is not simply rendered
 *
 * `docs/protocol.md` is explicit: *"the Mac must prefer its own copy keyed on `reason` — the string
 * is a fallback and a log line, not the UI."* The phone's `message` is written for a person and is
 * good, but it is written by the *other* device and cannot know what this screen is about to do —
 * whether a fresh code is already on screen, for instance. So the reason is the key and the
 * sentence is the fallback.
 *
 * That is the opposite of the rule for `error` payloads, where the phone's own words are rendered
 * verbatim (defect 27). The difference is that an `error` explains something only the phone knows,
 * and a pairing rejection explains something both ends know, on a screen only the Mac draws.
 *
 * ### Why an unknown reason is not an error
 *
 * A newer phone may add one. An unrecognised reason falls back to the phone's sentence, which is
 * exactly what the fallback is for — never to a shrug, and never to a claim this end invented.
 */
export interface PairRejectionCopy {
  /** One line, and it names what happened rather than how it failed. */
  headline: string;
  /** What the person does next. Always present — a dead end is the silent no-op this app rules out. */
  body: string;
  /** Whether the Mac should draw a fresh code without being asked. */
  refreshCode: boolean;
}

const COPY: Record<PairRejectReason, PairRejectionCopy> = {
  TOKEN_EXPIRED: {
    headline: 'That code had expired',
    body: 'Here is a fresh one. Scan it on your phone — codes time out so an old screenshot cannot be used.',
    refreshCode: true,
  },
  TOKEN_MISMATCH: {
    headline: "That code didn't match",
    body: 'Your phone scanned a different code — an old one may still be on screen somewhere. Here is a fresh one.',
    refreshCode: true,
  },
  TOKEN_MISSING: {
    headline: 'Your phone expected a pairing code',
    body: 'This Mac connected without one. Here is a fresh code to scan.',
    refreshCode: true,
  },
};

/**
 * The copy for a rejection, or `null` when this rejection is not about this Mac.
 *
 * **The fingerprint check is the whole reason this returns null rather than always answering.**
 * `docs/protocol.md`: the fingerprint is *"the connecting Mac's own as the phone computed it, so a
 * Mac can tell a rejection meant for it from one it is merely observing."* Rendering somebody
 * else's rejection would tell this user their pairing failed when it did not — and the screen it
 * lands on is the first screen a stranger sees.
 *
 * A rejection with **no** fingerprint is accepted, because the field is optional in the contract and
 * an older phone may omit it. That is a deliberate asymmetry: absent means "cannot say", and
 * present-and-different means "not yours".
 */
export function pairRejectionCopy(
  rejection: PairRejected,
  selfFingerprint: string | null,
): PairRejectionCopy | null {
  if (
    rejection.fingerprint &&
    selfFingerprint &&
    normalizeFingerprint(rejection.fingerprint) !== normalizeFingerprint(selfFingerprint)
  ) {
    return null;
  }
  const known = COPY[rejection.reason];
  if (known) return known;
  // An unrecognised reason from a newer phone. Its sentence is the honest thing to show, and a
  // fresh code is still the right next step for every rejection this message can carry.
  return {
    headline: 'Your phone refused the pairing',
    body: rejection.message?.trim() || 'Here is a fresh code to scan.',
    refreshCode: true,
  };
}

/** Case- and separator-insensitive, the way the link's own pinning comparison is. */
function normalizeFingerprint(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}
