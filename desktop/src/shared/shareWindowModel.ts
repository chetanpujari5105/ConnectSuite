/**
 * What the receive window draws for one incoming file — pure, so a test runs the rule the page runs.
 * docs/feature-a-receive-window.md; docs/protocol.md → Share → Version 2.
 *
 * ### Rules this file holds
 *
 * - **The sending phone is named from the Mac's pairing record**, not from the offer's `from`, which
 *   is text the phone chose. If the two differ, the offer's own name is shown as a note — never in
 *   place of the paired one.
 * - **No preview before Accept.** The protocol has no bounded preview for an offer, so the window
 *   draws a type glyph and never a picture; [thumb] exists only once the Mac has published a
 *   verified file (step 4).
 * - **One decision surface.** Accept and Decline appear here and nowhere else; the main window's
 *   card only points back at this window.
 * - **Closing is not declining.** The `close` action's label says so for a waiting offer.
 * - Every status sentence comes from `shareReceiveCopy.ts`, which keeps *saved on this Mac* and
 *   *confirmed by the phone* as two facts.
 *
 * Plain script (loaded by `<script>` in share-window.html): no `export`; the functions are hung on
 * `globalThis`, and `module.exports` for the tests.
 */

interface ShareWinOffer {
  offerId: string;
  from: string;
  name: string;
  mime: string;
  bytes: number;
  folder: string;
  state: ShareRecvState;
  expiresAtMs: number;
  savedAs: string | null;
  reason: string | null;
  priorCopy: { savedAs: string; acknowledged: boolean } | null;
  /** Bytes this Mac received (receiver-measured); null before a pull began. */
  receivedBytes?: number | null;
  /** A failed attempt a person may retry now. */
  canRetry?: boolean;
  /** In `unexpected-file`: the name in [folder] that holds a different file. */
  unexpectedName?: string | null;
  /** When it arrived and its place in this run's arrivals: what tells two same-named files apart. */
  arrivedAtMs?: number;
  arrivalSeq?: number;
  /** Version 3 on its session: the pre-Accept sentence, and labels that name each file uniquely. */
  queueMode?: boolean;
  filesAhead?: number | null;
}

type ShareWinActionId = 'decline' | 'accept' | 'close' | 'cancel' | 'retry' | 'open' | 'reveal';

/**
 * Progress as measured on this Mac. `fraction` is null when there is nothing honest to draw as a bar
 * (before the phone starts, or a zero-byte file). **It never reads 100%**: all bytes in is shown as
 * *checking*, because the file is not saved until its length, digest and publication have succeeded.
 */
interface ShareWinProgress {
  fraction: number | null;
  label: string;
  checking: boolean;
  received: number;
  total: number;
}

interface ShareWinAction {
  id: ShareWinActionId;
  /** The offer this action acts on — the target is always this id, never a position in a list. */
  offerId: string;
  label: string;
  aria: string;
  primary: boolean;
}

type ShareWinGlyph = 'photos' | 'video' | 'music' | 'doc';

interface ShareWinModel {
  offerId: string;
  state: ShareRecvState;
  tone: ShareRecvTone;
  glyph: ShareWinGlyph;
  /** The line above the file name: who, or what happened. */
  eyebrow: string;
  title: string;
  /** Type and exact size. */
  meta: string;
  /** Where it will go, or where it went. Null when there is no destination to name (a refusal). */
  place: { label: string; value: string } | null;
  detail: string[];
  /** The offer's own `from`, when it differs from the paired phone's name. */
  senderNote: string | null;
  actions: ShareWinAction[];
  progress: ShareWinProgress | null;
  /** For the page's polite live region, when this offer first needs attention. */
  announcement: string;
  /** A finished offer that is not a saved file closes itself after a while; a saved one waits. */
  closesItself: boolean;
  /**
   * The card's accessible name. At version 3 it names *which* file — its place in this run's
   * arrivals and its arrival time — so two cards of one name are two different names; at version 2
   * it is the title, as before.
   */
  label: string;
  /**
   * Version 3, drawn on the card: `File 2 · arrived 14:07:09`, set by [shareQueueCards] **only when
   * another listed card has the same file name**. Null everywhere else, so a list of distinct names
   * reads exactly as it did.
   */
  arrivalNote: string | null;
}

/** Every glyph the window can draw — enumerated so a test can prove each resolves in `icons.ts`. */
const SHARE_WIN_ICON_NAMES: string[] = ['photos', 'video', 'music', 'doc', 'files', 'close'];

function shareWinGlyph(mime: string): ShareWinGlyph {
  const top = mime.split('/')[0];
  if (top === 'image') return 'photos';
  if (top === 'video') return 'video';
  if (top === 'audio') return 'music';
  return 'doc';
}

const SHARE_WIN_TYPE_NAMES: Record<string, string> = {
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/heic': 'HEIC image',
  'image/heif': 'HEIF image',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'video/mp4': 'MP4 video',
  'video/quicktime': 'QuickTime video',
  'video/3gpp': '3GP video',
  'video/webm': 'WebM video',
  'audio/mpeg': 'MP3 audio',
  'audio/mp4': 'M4A audio',
  'application/pdf': 'PDF document',
  'application/zip': 'ZIP archive',
  'text/plain': 'Plain text',
};

/**
 * `image/jpeg` → `JPEG image`. A type this table does not know is shown **as the MIME type itself**
 * rather than guessed from the name: the name is the sender's, and a label that reads more certain
 * than its source is the thing this window must not do.
 */
function shareWinTypeLabel(mime: string): string {
  return SHARE_WIN_TYPE_NAMES[mime.toLowerCase()] ?? mime;
}

/** `3874112` → `3,874,112 bytes`. Exact, because the window promises the exact size. */
function shareWinExactBytes(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'}`;
}

/** `3874112` → `3.9 MB` — decimal units, as Finder counts them. A reading aid beside the exact count. */
function shareWinApproxBytes(n: number): string {
  if (n < 1000) return shareWinExactBytes(n);
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function shareWinProgress(o: ShareWinOffer): ShareWinProgress | null {
  if (o.state !== 'accepting' && o.state !== 'receiving') return null;
  const total = o.bytes;
  const received = Math.max(0, Math.min(total, o.receivedBytes ?? 0));
  if (o.state === 'accepting' || o.receivedBytes === null || o.receivedBytes === undefined) {
    return { fraction: null, label: 'Waiting for the phone to start…', checking: false, received: 0, total };
  }
  if (total === 0) return { fraction: null, label: 'An empty file — checking before saving…', checking: true, received: 0, total };
  if (received >= total) return { fraction: 1, label: 'All bytes received — checking before saving…', checking: true, received, total };
  // Floor, and at most 99: a percentage that rounds up to 100 would be the one lie this bar can tell.
  const pct = Math.min(99, Math.floor((received / total) * 100));
  return { fraction: received / total, label: `${shareWinApproxBytes(received)} of ${shareWinApproxBytes(total)} · ${pct}%`, checking: false, received, total };
}

/** `14:07:09` — the arrival clock that, with the arrival number, separates two files of one name. */
function shareWinClock(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function shareWinMeta(mime: string, bytes: number): string {
  const exact = shareWinExactBytes(bytes);
  return bytes < 1000 ? `${shareWinTypeLabel(mime)} · ${exact}` : `${shareWinTypeLabel(mime)} · ${shareWinApproxBytes(bytes)} (${exact})`;
}

/**
 * The model for one offer. [phone] is the paired phone's name from the Mac's own record, or null
 * when there is none (then the offer's `from` is all there is, and it is used plainly).
 */
function shareWindowModel(o: ShareWinOffer, phone: string | null): ShareWinModel {
  const who = phone ?? o.from;
  const status = shareReceiveStatus({
    state: o.state,
    wantedName: o.name,
    savedAs: o.savedAs,
    reason: o.reason,
    priorCopy: o.priorCopy,
    unexpectedName: o.unexpectedName ?? null,
    folder: o.folder,
    queueMode: o.queueMode === true,
    filesAhead: o.filesAhead ?? null,
  });
  const waiting = o.state === 'awaiting-decision';
  // At version 3 several offers can share a name; every label then says which one, by its place in
  // this run's arrivals and its arrival time. At version 2 there is one live offer and labels are as before.
  const ident = o.queueMode === true && o.arrivalSeq !== undefined
    ? `${o.name} (file ${o.arrivalSeq}, arrived ${shareWinClock(o.arrivedAtMs ?? 0)})`
    : o.name;
  const published = o.state === 'saved' || o.state === 'saved-unacknowledged';
  const eyebrow = waiting
    ? `${who} wants to send a file`
    : o.state === 'accepting'
      ? `Asking ${who} to start…`
      : o.state === 'receiving'
        ? `Receiving from ${who}…`
        : status.headline;
  const place = o.state === 'refused' || o.folder === ''
    ? null
    : published
      ? { label: 'Saved in', value: o.folder }
      : o.state === 'unexpected-file'
        ? { label: 'Folder', value: o.folder }
        : { label: 'Save to', value: o.folder };
  const id = o.offerId;
  const close: ShareWinAction = waiting
    ? { id: 'close', offerId: id, label: 'Hide', aria: 'Hide this window. The request keeps waiting until it expires.', primary: false }
    // At version 3 a finished card's Close says which file, like every other action (a screen reader's
    // button list shows it away from its card); at version 2 there is one card and the wording is as before.
    : { id: 'close', offerId: id, label: 'Close', aria: o.queueMode === true ? `Close ${ident} — ${status.headline}` : `Close — ${status.headline}`, primary: false };
  const shown = published && o.savedAs !== null ? o.savedAs : o.name;
  const actions: ShareWinAction[] = waiting
    ? [
        { id: 'decline', offerId: id, label: 'Decline', aria: `Decline ${ident} from ${who}`, primary: false },
        { id: 'accept', offerId: id, label: 'Accept', aria: `Accept ${ident} from ${who} and save it to ${o.folder}`, primary: true },
      ]
    : o.state === 'accepting' || o.state === 'receiving'
      ? [{ id: 'cancel', offerId: id, label: 'Cancel', aria: `Stop receiving ${ident}. Nothing will be kept.`, primary: false }]
      : o.state === 'queued'
        ? [{ id: 'cancel', offerId: id, label: 'Cancel', aria: `Cancel ${ident}. It has not started, and nothing will be kept.`, primary: false }]
        : published
          ? [
              { id: 'reveal', offerId: id, label: 'Show in Finder', aria: `Show ${shown} in Finder`, primary: false },
              { id: 'open', offerId: id, label: 'Open', aria: `Open ${shown}`, primary: true },
            ]
          : o.state === 'failed' && o.canRetry === true
            ? [
                { id: 'cancel', offerId: id, label: 'Give up', aria: `Give up on ${ident}. Nothing was kept.`, primary: false },
                { id: 'retry', offerId: id, label: 'Try again', aria: `Try receiving ${ident} again from the start`, primary: true },
              ]
            : [close];
  return {
    offerId: o.offerId,
    state: o.state,
    tone: status.tone,
    glyph: shareWinGlyph(o.mime),
    eyebrow,
    title: shown,
    meta: shareWinMeta(o.mime, o.bytes),
    place,
    detail: status.detail,
    senderNote: phone !== null && o.from !== phone ? `The phone calls itself “${o.from}”.` : null,
    actions,
    progress: shareWinProgress(o),
    announcement: waiting
      ? `${who} wants to send ${o.name}, ${shareWinExactBytes(o.bytes)}. Accept or decline.`
      : `${status.headline}: ${o.name}.`,
    // An unexpected file stays until a person closes it: it names a file they may need to find.
    // Queued stays: an accepted file waiting its turn is visible and cancellable until it starts or ends.
    closesItself: !published && !waiting && o.state !== 'accepting' && o.state !== 'receiving' && o.state !== 'queued' &&
      o.state !== 'unexpected-file' && !(o.state === 'failed' && o.canRetry === true),
    label: ident === o.name ? shown : ident,
    arrivalNote: null,
  };
}

/**
 * **Version 3 — PROPOSED, reachable only at a negotiated `share.file` 3, which nothing advertises.** Every offer that still needs a
 * person or is in play, one card each, in the order given (the caller passes arrival order), with the
 * card [shareWindowModel] already draws: so every waiting offer keeps its **own** Accept and Decline,
 * and nothing here adds a group action, an automatic accept, or a second window. Finished offers are
 * not listed; they stay on the main window's cards. docs/feature-a-multi-offer-proposal.md rev 3 §2.
 */
function shareWindowList(offers: ShareWinOffer[], phone: string | null): { cards: ShareWinModel[]; waiting: number } {
  const pending = offers.filter(shareWinPending);
  return {
    cards: pending.map((o) => shareWindowModel(o, phone)),
    waiting: pending.filter((o) => o.state === 'awaiting-decision').length,
  };
}

/**
 * **Version 3 only.** Whether the window draws a list of cards rather than its one-file layout: any
 * offer that arrived while version 3 was live. At version 2 no offer carries it, and the window is
 * exactly the one-file window that passed on hardware.
 */
function shareQueueMode(offers: ShareWinOffer[]): boolean {
  return offers.some((o) => o.queueMode === true);
}

/** Every state in which a card still needs a person or is in play (the window keeps it on its own). */
function shareWinPending(o: ShareWinOffer): boolean {
  return o.state === 'awaiting-decision' || o.state === 'accepting' || o.state === 'queued' || o.state === 'receiving' ||
    (o.state === 'failed' && o.canRetry === true);
}

/**
 * **Version 3 only.** The cards the one window draws, in the order the offers **arrived** (the
 * proposal's §2), each drawn by [shareWindowModel] so it keeps its own Accept and Decline:
 *
 * - every offer the window has **shown** — a card enters while it is pending, or because a person
 *   pressed *Show* for it — and that nobody has **dismissed**;
 * - so a finished card stays where it was (a saved file keeps Open and Show in Finder) until it is
 *   closed or lingers out, and a window reopened later does not replay a run's history.
 *
 * [shown] and [dismissed] are the view's own memory; this function reads them and changes nothing.
 */
function shareQueueCards(
  offers: ShareWinOffer[],
  phone: string | null,
  shown: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): ShareWinModel[] {
  const listed = offers
    .filter((o) => (shown.has(o.offerId) || shareWinPending(o)) && !dismissed.has(o.offerId))
    .sort((a, b) => (a.arrivalSeq ?? 0) - (b.arrivalSeq ?? 0));
  // A name counts as repeated only among the cards actually on the list: a same-named file that has
  // left it no longer needs telling apart.
  const uses = new Map<string, number>();
  for (const o of listed) uses.set(o.name, (uses.get(o.name) ?? 0) + 1);
  return listed.map((o) => {
    const m = shareWindowModel(o, phone);
    return (uses.get(o.name) ?? 0) > 1 ? { ...m, arrivalNote: shareWinArrivalNote(o) } : m;
  });
}

/** `File 2 · arrived 14:07:09` — the same two facts the card's accessible name carries. */
function shareWinArrivalNote(o: ShareWinOffer): string {
  const clock = shareWinClock(o.arrivedAtMs ?? 0);
  return o.arrivalSeq !== undefined ? `File ${o.arrivalSeq} · arrived ${clock}` : `Arrived ${clock}`;
}

/**
 * The height the receive window's page asks the main process for. With the list drawn (version 3)
 * the page is capped at the window it is in, so its drawn height cannot say it wants more; the list's
 * hidden overflow is added back, giving the height the content would take uncapped. The main process
 * then clamps it (120–560, and the work area). With the list hidden (version 2) it is the drawn height,
 * exactly as before.
 */
function shareWinWantedHeight(rootHeight: number, listActive: boolean, listClientHeight: number, listScrollHeight: number): number {
  if (!listActive) return Math.ceil(rootHeight);
  return Math.ceil(rootHeight + Math.max(0, listScrollHeight - listClientHeight));
}

/**
 * **F4 (2026-09-28): a waiting file that arrives out of sight.** At the window's 560 px cap the fourth
 * and fifth arrivals were measured 0% on screen at rest while the window presented itself for them and
 * the live region announced them.
 *
 * How long after a person's own scroll input — a wheel, a touch, a press on the list (a scrollbar drag),
 * a scrolling key — the list still counts as being scrolled by them.
 */
const SHARE_WIN_SCROLL_QUIET_MS = 1500;

type ShareWinArrivalMove = 'none' | 'reveal' | 'indicate';

/**
 * What a newly arrived waiting card gets. Already in view: nothing. Nobody is using the window —
 * unfocused, not hovered, no scroll input within [SHARE_WIN_SCROLL_QUIET_MS]: **reveal**, a scroll of
 * the list only (never focus, never the window). Somebody is: **indicate**, never move what they are
 * reading or pointing at — the list stays still and a button says a file is waiting out of view.
 */
function shareWinArrivalMove(s: { inView: boolean; focused: boolean; hovered: boolean; msSinceScroll: number }): ShareWinArrivalMove {
  if (s.inView) return 'none';
  if (s.focused || s.hovered || s.msSinceScroll < SHARE_WIN_SCROLL_QUIET_MS) return 'indicate';
  return 'reveal';
}

/** Whether a card lies wholly inside the list's visible band (client rects; half a pixel of rounding). */
function shareWinFullyInView(card: { top: number; bottom: number }, list: { top: number; bottom: number }): boolean {
  return card.top >= list.top - 0.5 && card.bottom <= list.bottom + 0.5;
}

/**
 * The indicator for waiting files out of view, [labels] in arrival order (each card's own accessible
 * label, so two files of one name are told apart). Null when there are none. It leads to the **newest**
 * — the arrival a person was not shown.
 */
function shareWinMoreLabel(labels: string[]): { text: string; aria: string } | null {
  if (labels.length === 0) return null;
  const newest = labels[labels.length - 1];
  if (labels.length === 1) {
    return { text: '1 more file waiting', aria: `1 more file is waiting, out of view: ${newest}. Show it.` };
  }
  return {
    text: `${labels.length} more files waiting`,
    aria: `${labels.length} more files are waiting, out of view. Show the newest: ${newest}.`,
  };
}

{
  const g = globalThis as Record<string, unknown>;
  g.shareWindowModel = shareWindowModel;
  g.shareWindowList = shareWindowList;
  g.shareQueueMode = shareQueueMode;
  g.shareQueueCards = shareQueueCards;
  g.shareWinPending = shareWinPending;
  g.shareWinWantedHeight = shareWinWantedHeight;
  g.shareWinTypeLabel = shareWinTypeLabel;
  g.shareWinApproxBytes = shareWinApproxBytes;
  g.SHARE_WIN_ICON_NAMES = SHARE_WIN_ICON_NAMES;
  g.shareWinArrivalMove = shareWinArrivalMove;
  g.shareWinFullyInView = shareWinFullyInView;
  g.shareWinMoreLabel = shareWinMoreLabel;
  g.SHARE_WIN_SCROLL_QUIET_MS = SHARE_WIN_SCROLL_QUIET_MS;
}

if (typeof module !== 'undefined') {
  module.exports = { shareWindowModel, shareWindowList, shareQueueMode, shareQueueCards, shareWinPending, shareWinWantedHeight, shareWinTypeLabel, shareWinApproxBytes, shareWinGlyph, SHARE_WIN_ICON_NAMES, shareWinArrivalMove, shareWinFullyInView, shareWinMoreLabel, SHARE_WIN_SCROLL_QUIET_MS };
}
