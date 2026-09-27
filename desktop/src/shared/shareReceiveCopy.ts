/**
 * What the Mac says about one incoming share — docs/protocol.md → Share → Version 2.
 *
 * ### The rule this file exists to hold
 *
 * **Two facts, never one.** Whether the file is on this Mac, and whether the phone *knows* it is,
 * are separate: the Mac can publish a verified file and then lose the phone's acknowledgement of
 * `share.saved`. So the status carries `savedOnMac` and `confirmedByPhone` as two fields, and the
 * sentence for the second case says both halves: *"Saved on this Mac; confirmation to phone
 * unknown"*. Nothing here may say "Saved" before the Mac has published a verified file, and nothing
 * may say the phone confirmed what it did not.
 *
 * Expired is its own end and never reads as declined.
 *
 * Module-free for the same reason as `sendBatch.ts`: the renderer loads it as a classic script.
 */

type ShareRecvState =
  | 'awaiting-decision'
  | 'accepting'
  | 'queued'
  | 'receiving'
  | 'saved'
  | 'saved-unacknowledged'
  | 'failed'
  | 'unexpected-file'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'ended'
  | 'refused';

interface ShareRecvFacts {
  state: ShareRecvState;
  /** The sanitised name the offer asked for. */
  wantedName: string;
  /** The name it was published under, once published. */
  savedAs: string | null;
  /** A failed attempt's reason (`share.saved` reasons). */
  reason: string | null;
  /** An earlier file this run published from the same bytes. */
  priorCopy: { savedAs: string; acknowledged: boolean } | null;
  /** In `unexpected-file`: the name that now holds a different file, and the folder it is in. */
  unexpectedName?: string | null;
  folder?: string;
  /** Version 3 on this offer's session: an Accept may wait its turn, so say so before it. */
  queueMode?: boolean;
  /** In `queued`: how many transfers are ahead of it. */
  filesAhead?: number | null;
}

/** The sentence a waiting offer shows **before** Accept at version 3 — the owner's wording, exactly. */
const SHARE_RECV_QUEUE_CONSENT = 'Accept this file now. If another transfer is running, this one starts when it finishes.';

type ShareRecvTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

interface ShareRecvStatus {
  headline: string;
  detail: string[];
  tone: ShareRecvTone;
  /** A verified file was published on this Mac. */
  savedOnMac: boolean;
  /** The phone acknowledged the Mac's `share.saved {ok:true}`. */
  confirmedByPhone: boolean;
}

const SHARE_RECV_FAILURE_COPY: Record<string, string> = {
  checksum: 'What arrived did not match what the phone offered.',
  truncated: 'The file arrived incomplete.',
  interrupted: 'The transfer stopped before the file arrived.',
  'insufficient-space': 'There is not enough free space in the receive folder.',
  'write-failed': 'The file could not be written to the receive folder.',
  'unsupported-destination': 'The receive folder’s drive cannot save files safely (it cannot make hard links).',
};

/**
 * Why the Mac refused an offer **without asking anyone** — the destination checks, at the offer or at
 * Accept. Not a person's Decline, so it never reads "Declined": the person may have clicked Accept.
 */
const SHARE_RECV_REFUSAL_COPY: Record<string, string> = {
  'folder-unavailable': 'The receive folder is not available.',
  'insufficient-space': 'There is not enough free space in the receive folder.',
  'unsupported-destination': 'The receive folder’s drive cannot save files safely (it cannot make hard links).',
};

function shareReceiveStatus(f: ShareRecvFacts): ShareRecvStatus {
  const none = { savedOnMac: false, confirmedByPhone: false };
  // The file's names are in the card's title (what was offered) and its "Saved as" row (where it is).
  // The detail says what happened and names neither: saying the saved name here too made a finished
  // card name the same file three times (docs/testing.md → the share card review, P1).
  const renamed = (): string[] =>
    f.savedAs !== null && f.savedAs !== f.wantedName
      ? ['A file with that name was already there, so this one was given a new name. Nothing was replaced.']
      : [];
  const prior = (): string[] =>
    f.priorCopy
      ? [
          `The same file was saved here earlier as ${f.priorCopy.savedAs}` +
            `${f.priorCopy.acknowledged ? '' : ' (the phone never confirmed it)'}. ` +
            'Accepting saves a second copy under a new name.',
        ]
      : [];
  switch (f.state) {
    case 'awaiting-decision':
      return {
        headline: 'Wants to send you a file',
        detail: f.queueMode === true ? [SHARE_RECV_QUEUE_CONSENT, ...prior()] : prior(),
        tone: 'neutral',
        ...none,
      };
    case 'queued': {
      const ahead = f.filesAhead ?? 0;
      return {
        headline: 'Accepted — waiting its turn',
        detail: [
          ahead === 1 ? '1 transfer is ahead of it.' : `${ahead} transfers are ahead of it.`,
          'It starts on its own when its turn comes. Nothing of it is on this Mac yet, and it is not saved.',
        ],
        tone: 'progress',
        ...none,
      };
    }
    case 'accepting':
      return { headline: 'Starting…', detail: [], tone: 'progress', ...none };
    case 'receiving':
      return { headline: 'Receiving…', detail: ['Not saved yet: the file is checked before it is kept.'], tone: 'progress', ...none };
    case 'saved':
      return {
        headline: 'Saved on this Mac',
        detail: ['Complete and checked. The phone confirmed it.', ...renamed()],
        tone: 'success',
        savedOnMac: true,
        confirmedByPhone: true,
      };
    case 'saved-unacknowledged':
      return {
        headline: 'Saved on this Mac; confirmation to phone unknown',
        detail: [
          'Complete and checked. The phone did not answer, so it may say the file was not confirmed.',
          'Sending it again would save a second copy.',
          ...renamed(),
        ],
        tone: 'warning',
        savedOnMac: true,
        confirmedByPhone: false,
      };
    case 'failed':
      return {
        headline: 'Not saved',
        detail: [SHARE_RECV_FAILURE_COPY[f.reason ?? ''] ?? 'The file could not be saved.', 'Nothing was kept on this Mac.'],
        tone: 'danger',
        ...none,
      };
    case 'unexpected-file':
      // Not "Nothing was kept on this Mac" — a file does sit at that name now; it just is not the
      // phone's. Named exactly, so a person can find it; never opened, never offered to open.
      return {
        headline: 'Not saved — a different file appeared',
        detail: [
          `Your phone’s file was not saved. While Sidekick was saving, a different file took the name “${f.unexpectedName ?? f.wantedName}” in ${f.folder ?? 'the receive folder'}.`,
          'It did not come from your phone. Sidekick left it untouched and did not open it.',
        ],
        tone: 'danger',
        ...none,
      };
    case 'declined':
      return { headline: 'Declined', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
    case 'expired':
      return { headline: 'Expired', detail: ['Nobody answered in time. Nothing was saved.'], tone: 'neutral', ...none };
    case 'cancelled':
      // The phone ended it because its prepared copy is gone (Android may clear an app's cache). Nobody
      // cancelled anything, so this must never read as a person's cancel — on either side.
      if (f.reason === 'staging-lost') {
        return {
          headline: 'The phone’s copy was lost',
          detail: ['The copy the phone prepared for this file is no longer on the phone, so nothing was sent.', 'Nothing was saved. Share it again from the phone.'],
          tone: 'warning',
          ...none,
        };
      }
      return { headline: 'Cancelled', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
    case 'ended':
      return { headline: 'Ended with the connection', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
    case 'refused':
      return {
        headline: 'Not received',
        detail: [SHARE_RECV_REFUSAL_COPY[f.reason ?? ''] ?? 'The receive folder could not take this file.', 'The phone was told why. Nothing was saved.'],
        tone: 'warning',
        ...none,
      };
  }
}

/**
 * **What a share live region may still say** — the one rule for the main window's tray and both views
 * of the receive window.
 *
 * An arrival is announced once, by writing its sentence into a polite live region. The region is
 * visually hidden but it is **not** silent afterwards: a screen reader reads its text whenever a
 * person moves through it. So the sentence must stand only while it is still true. It said *"… wants
 * to send X. Accept or decline it"* for an offer that had long since been saved (Run A, 2026-09-28).
 *
 * - The region holds the announcement of the **most recently announced** offer ([announced] is in
 *   announcement order) that is **still in a [standing] state now**.
 * - When that offer ends — decided, saved, expired, gone from the list — the region falls back to the
 *   next most recent announced offer that still stands, so a **genuinely pending offer is never
 *   hidden**; with none, it is empty.
 * - An offer never announced is never added here: arrival order and wording stay the callers'.
 *
 * Pure: it chooses the text; the caller writes it only when it differs, so an unchanged sentence is
 * not re-announced.
 */
function shareLiveText(
  announced: readonly string[],
  now: readonly { offerId: string; state: ShareRecvState; announcement: string }[],
  standing: readonly ShareRecvState[],
): string {
  for (let i = announced.length - 1; i >= 0; i -= 1) {
    const offer = now.find((o) => o.offerId === announced[i]);
    if (offer && standing.includes(offer.state)) return offer.announcement;
  }
  return '';
}

{
  const g = globalThis as Record<string, unknown>;
  g.shareReceiveStatus = shareReceiveStatus;
  g.shareLiveText = shareLiveText;
}

if (typeof module !== 'undefined') {
  module.exports = { shareReceiveStatus, shareLiveText };
}
