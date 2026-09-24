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
  | 'receiving'
  | 'saved'
  | 'saved-unacknowledged'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'ended';

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
}

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
      return { headline: 'Wants to send you a file', detail: prior(), tone: 'neutral', ...none };
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
    case 'declined':
      return { headline: 'Declined', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
    case 'expired':
      return { headline: 'Expired', detail: ['Nobody answered in time. Nothing was saved.'], tone: 'neutral', ...none };
    case 'cancelled':
      return { headline: 'Cancelled', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
    case 'ended':
      return { headline: 'Ended with the connection', detail: ['Nothing was saved.'], tone: 'neutral', ...none };
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.shareReceiveStatus = shareReceiveStatus;
}

if (typeof module !== 'undefined') {
  module.exports = { shareReceiveStatus };
}
