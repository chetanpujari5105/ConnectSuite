/**
 * Component 20 — the capability status row, as a decision rather than as markup.
 *
 * Settings → Device info lists one row per feature with the **phone's own answer**: Available,
 * Limited, Needs permission, Unavailable or Unbuilt. This file decides which of the five a feature
 * is in, from three facts the Mac actually holds — is the link up, is the capability advertised,
 * and what sentence did the phone send about it — plus one fact about this build, which features
 * exist at all.
 *
 * ### Why the decision is here and not in the pane
 *
 * The Overview chip row it replaces had exactly this logic written inline in `renderer.ts`, which is
 * reachable by no test (`check-renderer-views.mjs` exists because three renderer-only defects
 * shipped green from that position). The five states differ by what they *claim*, and the claims
 * are the part worth pinning:
 *
 *  - **Unbuilt** is a fact about Sidekick. It never carries an action and never blames the phone.
 *  - **Needs permission** is a fact about a grant, and only the user can change it — so it is the
 *    one state that may carry an action, and only where the Mac can really take them to the fix.
 *  - **Unavailable** is the honest answer when the phone is not offering something and has not said
 *    why, and when the link is down: **nothing is claimed about a phone that is not here.**
 *  - **Limited** is for a feature that works with a named piece missing.
 *  - **Available** claims the feature works, and carries a note only where one is needed.
 *
 * The reason is the phone's sentence, verbatim — defect 27 is what happens when this side
 * paraphrases, and defect 24 is what happens when it is dropped.
 *
 * Plain script, no `export`: the page loads it as a classic script (defect 94).
 */

type CapabilityState = 'available' | 'limited' | 'permission' | 'unavailable' | 'unbuilt';

interface CapabilityRow {
  /** The wire id — a handle, never the only thing a person reads. */
  id: string;
  /** The readable name. */
  label: string;
  state: CapabilityState;
  /** The phone's own sentence, or this build's, where one is needed. Never invented. */
  note: string | null;
}

interface CapabilityInput {
  id: string;
  label: string;
  /** Features this build does not have. They are `unbuilt` whatever the phone says. */
  unbuilt?: boolean;
  /** A feature that works with a named piece missing — the note says which. */
  limitedNote?: string | null;
  advertised: boolean;
  reason: string | null;
  connected: boolean;
}

/**
 * Whether a phone's refusal is about a permission.
 *
 * Read from the phone's own words, because the wire carries no machine-readable *kind* for a
 * refusal — `unavailable[].reason` is a sentence. The words matched are the ones
 * `Capabilities.kt` actually produces (`permission`, `grant`, `granted`, `allow`, `enable`,
 * `turn on`, `access`); anything else stays `unavailable`, which claims less.
 */
function readsAsPermission(reason: string | null): boolean {
  if (!reason) return false;
  return /permission|grant|granted|allow|enable|turn (it )?on|access/i.test(reason);
}

function capabilityRow(input: CapabilityInput): CapabilityRow {
  const base = { id: input.id, label: input.label };
  if (input.unbuilt) {
    return { ...base, state: 'unbuilt', note: input.limitedNote ?? null };
  }
  if (!input.connected) {
    // Nothing is claimed about a phone that is not here — including that a feature is missing.
    return { ...base, state: 'unavailable', note: 'The phone is not connected, so this is unknown.' };
  }
  if (input.advertised) {
    return input.limitedNote
      ? { ...base, state: 'limited', note: input.limitedNote }
      : { ...base, state: 'available', note: null };
  }
  return readsAsPermission(input.reason)
    ? { ...base, state: 'permission', note: input.reason }
    : { ...base, state: 'unavailable', note: input.reason ?? 'The phone is not offering this.' };
}

/** The glyph and tone each state draws with. Tone is the state's; no state is lime but `available`. */
function capabilityTone(state: CapabilityState): { tone: 'ok' | 'warning' | 'neutral'; icon: string } {
  switch (state) {
    case 'available':
      return { tone: 'ok', icon: 'check-circle' };
    case 'limited':
      return { tone: 'warning', icon: 'alert' };
    case 'permission':
      return { tone: 'warning', icon: 'lock' };
    default:
      // Unavailable and unbuilt are both neutral: neither is a failure, and neither is the user's
      // fault. Red would say something has broken.
      return { tone: 'neutral', icon: 'x-circle' };
  }
}

/** The word drawn in the row's status column. */
function capabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case 'available':
      return 'Available';
    case 'limited':
      return 'Limited';
    case 'permission':
      return 'Needs permission';
    case 'unbuilt':
      return 'Not built';
    default:
      return 'Unavailable';
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.capabilityRow = capabilityRow;
  g.capabilityTone = capabilityTone;
  g.capabilityStateLabel = capabilityStateLabel;
  g.readsAsPermission = readsAsPermission;
}

if (typeof module !== 'undefined') {
  module.exports = { capabilityRow, capabilityTone, capabilityStateLabel, readsAsPermission };
}
