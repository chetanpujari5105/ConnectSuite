/**
 * The media-session row in the Notifications feed — handoff §5c and component 16, frame `40:21209`.
 *
 * **One source of truth: `remote.state`.** The Overview widget and this row read the same object and
 * must never disagree about the track, the app, the playing state or which controls exist. This file
 * is the correlation between the two halves, and it needs **nothing new on the wire** — it is the
 * shape `shared/appCall.ts` already uses for calls.
 *
 * ### The three rules, and each is a thing not to draw
 *
 *  1. **Only where the packages match and the session is active.** A notification from an app that
 *     is not playing is an ordinary notification. There is never a *Nothing playing* row in the
 *     feed — that state belongs to the Overview widget, which has a card to put it in.
 *  2. **Only controls the session says exist.** `canSkipPrevious` / `canSkipNext` gate the skips;
 *     a control the session refuses is drawn off with its reason in the widget, and in a list row
 *     there is no room for a reason, so it is not drawn at all.
 *  3. **Nothing is inferred about position.** The row carries no scrubber: the widget runs one from
 *     `positionMs` + `positionAtMs`, and a second bar ticking in a list is two clocks for one fact.
 */

interface MediaSessionState {
  active: boolean;
  package?: string;
  appName?: string;
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  canSkipNext?: boolean;
  canSkipPrevious?: boolean;
}

interface MediaSessionRow {
  /** What the row says instead of the notification's own title. */
  title: string;
  /** One line under it: artist, or artist — album where both exist. */
  subtitle: string;
  playing: boolean;
  canSkipPrevious: boolean;
  canSkipNext: boolean;
}

/**
 * The row for a notification, or `null` when this notification is not the playing app's.
 *
 * `null` is the common answer and is the point: the caller draws an ordinary notification row for
 * it, unchanged.
 */
function mediaSessionRow(
  notif: { package?: string; title?: string; text?: string },
  media: MediaSessionState | null | undefined,
): MediaSessionRow | null {
  if (!media || !media.active) return null;
  if (!media.package || !notif.package || media.package !== notif.package) return null;

  // The session's own words where it has them; the notification's where it does not. A media
  // notification usually carries the same strings, but the session is the fact being drawn.
  const title = (media.title ?? '').trim() || (notif.title ?? '').trim();
  if (!title) return null; // nothing to say that the ordinary row would not say better

  const parts = [media.artist, media.album]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0);

  return {
    title,
    subtitle: parts.join(' — '),
    playing: media.playing === true,
    canSkipPrevious: media.canSkipPrevious === true,
    canSkipNext: media.canSkipNext === true,
  };
}

{
  const g = globalThis as Record<string, unknown>;
  g.mediaSessionRow = mediaSessionRow;
}

if (typeof module !== 'undefined') {
  module.exports = { mediaSessionRow };
}
