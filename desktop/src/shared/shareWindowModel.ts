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
}

type ShareWinActionId = 'decline' | 'accept' | 'close';

interface ShareWinAction {
  id: ShareWinActionId;
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
  /** For the page's polite live region, when this offer first needs attention. */
  announcement: string;
  /** A finished offer that is not a saved file closes itself after a while; a saved one waits. */
  closesItself: boolean;
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
  });
  const waiting = o.state === 'awaiting-decision';
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
      : { label: 'Save to', value: o.folder };
  const close: ShareWinAction = waiting
    ? { id: 'close', label: 'Hide', aria: 'Hide this window. The request keeps waiting until it expires.', primary: false }
    : { id: 'close', label: 'Close', aria: `Close — ${status.headline}`, primary: false };
  const actions: ShareWinAction[] = waiting
    ? [
        { id: 'decline', label: 'Decline', aria: `Decline ${o.name} from ${who}`, primary: false },
        { id: 'accept', label: 'Accept', aria: `Accept ${o.name} from ${who} and save it to ${o.folder}`, primary: true },
      ]
    : o.state === 'accepting' || o.state === 'receiving'
      ? []
      : [close];
  return {
    offerId: o.offerId,
    state: o.state,
    tone: status.tone,
    glyph: shareWinGlyph(o.mime),
    eyebrow,
    title: published && o.savedAs !== null ? o.savedAs : o.name,
    meta: shareWinMeta(o.mime, o.bytes),
    place,
    detail: status.detail,
    senderNote: phone !== null && o.from !== phone ? `The phone calls itself “${o.from}”.` : null,
    actions,
    announcement: waiting
      ? `${who} wants to send ${o.name}, ${shareWinExactBytes(o.bytes)}. Accept or decline.`
      : `${status.headline}: ${o.name}.`,
    closesItself: !published && !waiting && o.state !== 'accepting' && o.state !== 'receiving',
  };
}

{
  const g = globalThis as Record<string, unknown>;
  g.shareWindowModel = shareWindowModel;
  g.shareWinTypeLabel = shareWinTypeLabel;
  g.shareWinApproxBytes = shareWinApproxBytes;
  g.SHARE_WIN_ICON_NAMES = SHARE_WIN_ICON_NAMES;
}

if (typeof module !== 'undefined') {
  module.exports = { shareWindowModel, shareWinTypeLabel, shareWinApproxBytes, shareWinGlyph, SHARE_WIN_ICON_NAMES };
}
