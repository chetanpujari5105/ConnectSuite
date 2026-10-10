/**
 * The calls pane: the call happening now, the log of the ones that are not, and a dialler.
 *
 * Module-free on purpose, like the other renderer files.
 *
 * ### The rules this pane enforces
 *
 * **There is no audio, and the pane says so rather than implying one.** Answering from the Mac
 * answers the call *on the phone*; `CAPTURE_AUDIO_OUTPUT` is system-only and always will be. A
 * remote that offers an Answer button with no further explanation invites someone to answer a call
 * and then start talking to a Mac that cannot hear them. See docs/permissions.md.
 *
 * **Dialling confirms first.** There is no dialler screen to cancel on and nobody holding the
 * phone: once `call.dial` is sent the call is being placed. The confirmation is a second click on
 * the same button rather than a modal, because a modal blocks the renderer and cannot be driven by
 * the accessibility tooling this project tests with.
 *
 * ### What the design draws that is deliberately not here
 *
 * The handoff's centre column carries four things this build refuses, and each refusal is a
 * capability claim the wire cannot back. They are rows C1–C4 in `docs/design-departures.md`:
 *
 * | Drawn | Why it is not here |
 * |---|---|
 * | A **40-bar waveform** | There is no audio on this Mac. A bar chart animated over silence is a picture of a signal that does not exist — the most literal form of claiming a capability the wire does not have |
 * | **Mute** and **Speaker** | `call.*` is `incoming`, `ended`, `log`, `dial`, `answer`, `reject`. Nothing carries a mute or an audio route, and the phone half needs an `InCallService` |
 * | **Keypad** during a call (DTMF) | No message carries a DTMF digit. The dialler on the right types a number *before* a call; it cannot send a tone into one |
 * | **"End-to-end encrypted"** on the call card | Our *link* is TLS 1.3. The **call** is a cellular call this Mac does not carry one byte of, and a lock badge on a call card is a claim about the call. Same rule that cut the Messages thread badge (X1) |
 *
 * The three controls that *are* drawn — Answer on phone, Hang up, and the dialler — each map to a
 * verb the wire has.
 */

interface CallCard {
  callId: string;
  number: string;
  contactName?: string;
  startedAtMs: number;
  state: 'ringing' | 'active' | 'dialing';
}

interface CallLogRow {
  id: string;
  number: string;
  contactName?: string;
  type: string;
  dateMs: number;
  durationMs: number;
}

interface CallContactRow {
  id: string;
  displayName: string;
  hasPhoto?: boolean;
  numbers: { value: string; label: string }[];
}

type CallsResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface CallsAck {
  ok: boolean;
  reason?: string;
  fixHint?: string;
}

interface CallsBridge {
  callCurrent(): Promise<CallCard | null>;
  callLog(options: { limit?: number; before?: number }): Promise<
    CallsResult<{ calls: CallLogRow[]; hasMore: boolean }>
  >;
  callAnswer(): Promise<CallsAck>;
  callReject(): Promise<CallsAck>;
  callDial(number: string): Promise<CallsAck>;
  onCallChanged(callback: (call: CallCard | null) => void): void;
  contactsList(options: { query?: string; limit?: number }): Promise<
    CallsResult<{ contacts: CallContactRow[]; hasMore: boolean }>
  >;
  /**
   * One contact, fetched by number, optionally with the photograph the user set on their phone.
   *
   * This is the only message in `call.*`'s neighbourhood that carries an image, and it is not in
   * `call.*` at all: `docs/protocol.md` keeps binary out of these messages with `contacts.get` as
   * one of two bounded exceptions, capped at 64 KiB and downscaled by the phone. Drawing a face on
   * a call row therefore needs **no contract change** — it needs one request per distinct number
   * and somewhere to keep the answer, which is `ContactPhotos`.
   */
  contactsGet(options: { id?: string; number?: string; withPhoto?: boolean }): Promise<
    CallsResult<{ displayName?: string; photo?: string }>
  >;
  /**
   * The live notification list, which is how a call the phone network is not hosting gets a name.
   *
   * `CallWatcher` sees a WhatsApp call — proven, defect 47 — but a self-managed call carries no
   * number, so the card reads `Unknown number`, which is indistinguishable from a withheld-number
   * cellular call. The app's own ongoing call notification is the only thing on this Mac that can
   * tell them apart, and it is already here: `notif.posted` carries `package`, `appName`,
   * `category` and `ongoing`. No contract change, no new grant.
   */
  notifList(): Promise<CallNotifRow[]>;
  /** Fired when that list changes — the notification can arrive after the call state does. */
  onNotifChanged(callback: (list: CallNotifRow[]) => void): void;
}

/** Only the fields the call-naming rule reads. The Notifications pane holds the full shape. */
interface CallNotifRow {
  package: string;
  appName?: string;
  title?: string;
  text?: string;
  category?: string;
  ongoing: boolean;
}

// No `declare function` for `appCallFor` and friends: `src/shared/appCall.ts` carries no `export`,
// so it is a global script and its declarations are already in scope here. Re-declaring them is how
// the two mismatched ones became "incompatible overload" errors — and the two that *matched* merged
// silently, which is a second copy of a signature waiting to drift.

/** Which of the three log filters is showing. The design's tab strip, over the data we have. */
type CallsTab = 'all' | 'missed' | 'contacts';

/**
 * The dialler's twelve keys, in the handoff's order and with its sub-labels.
 *
 * The letter groups are typography, not a capability: every phone keypad ever made carries them and
 * nothing in this app claims to do anything with them. `0`'s sub-label is the exception and it is
 * **real** — holding it types `+`, which is what a phone does and what an Indian number needs.
 */
const DIAL_KEYS: { digit: string; sub: string; hold?: string }[] = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '✱', sub: '' },
  { digit: '0', sub: '+', hold: '+' },
  { digit: '#', sub: '' },
];

/** How long a press on `0` has to last before it types `+` instead. A phone's own feel. */
const HOLD_MS = 450;

/**
 * The first of these that is actually a string with something in it.
 *
 * Defect 35 in one function. The chain was written as `contactName ?? number ?? 'Unknown number'`
 * and the phone sent `number: ""`, which `??` passes straight through — `"" ?? x` is `""` — so the
 * fallback that existed precisely to prevent a blank label produced one. Nullish coalescing tests
 * for absence; this pane needs a test for emptiness, because an empty string is what a platform
 * that has no answer actually sends.
 */
function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/** The live card's headline. Never blank — that is the whole rule. */
function callWho(call: { contactName?: string; number?: string }): string {
  return firstNonEmpty(call.contactName, call.number) ?? 'Unknown number';
}

/**
 * The live card's second line: what the call is doing, and who with.
 *
 * The separator belongs to the number, not to the label. With an empty number this read
 * "Ringing · " — a bullet over nothing — which is the same blank as [callWho] and is quoted in
 * defect 35's own recorded evidence. A call with no number says "Ringing" and stops.
 */
function callStatus(call: { state: string; number?: string }): string {
  const label =
    call.state === 'ringing' ? 'Ringing' : call.state === 'dialing' ? 'Dialling' : 'In progress';
  const number = firstNonEmpty(call.number);
  return number ? `${label} · ${number}` : label;
}

/**
 * Up to two characters for the avatar disc the design draws.
 *
 * A name gives its initials; a bare number gives `#`, which is what the handoff's own placeholder
 * row uses for an unknown caller. It never returns an empty string, because an empty disc reads as
 * a rendering failure rather than as an unknown caller.
 */

function callInitials(entry: { contactName?: string; number?: string }): string {
  const name = firstNonEmpty(entry.contactName);
  if (!name) return '#';
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return '#';
  const letters = words.slice(0, 2).map((word) => {
    const match = word.match(/[\p{L}\p{N}]/u);
    return match ? match[0].toUpperCase() : '';
  });
  return letters.join('') || '#';
}

/**
 * The design's foot-of-card strip: a phone glyph and one sentence on a `--well` panel.
 *
 * One function rather than three, because all three uses say the same kind of thing — *this
 * capability lives on the phone* — and a sentence about a platform wall that is styled differently
 * in three places reads as three unrelated problems.
 */
/**
 * The call-audio sentence, in both places the pane says it — the idle card and the live one.
 *
 * It comes from `src/shared/callAudio.ts`, which holds the only answer this build can give
 * (`unavailable`, `unverified`) and the one sentence for each surface. The pane asks for its own
 * surface and nothing else: the other surface's sentence names the condition precisely, and the
 * pane's earlier copy is exactly where a named remedy did harm (defect 124 — it told people to pair
 * the Mac, a route measured and retracted). `calls.test.ts` keeps this file from reaching it.
 */
function paneAudioSentence(): string {
  return callAudioSentence(callAudioSupport(), 'calls-pane');
}

function audioStrip(text: string): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'call-audio-note';
  // `calls` is the handset; the icon set's `phone` key is the device.
  const glyph = iconSvg('calls', 15);
  glyph.setAttribute('aria-hidden', 'true');
  strip.appendChild(glyph);
  const line = document.createElement('span');
  line.textContent = text;
  strip.appendChild(line);
  return strip;
}

/**
 * The disc for a contact: initials on neutral charcoal, or their photograph.
 *
 * One function for all three sites — the log row, the Contacts row, and Frequently called. It used
 * to give each person a hue from `shared/discHue.ts`; the Sidekick system has **no per-person or
 * per-app colour anywhere** (handoff §2, departure D2), so people are told apart by name, initials
 * and photograph, which is what the Figma frames draw. `discHue.ts` was deleted with its last caller
 * on 2026-09-19 rather than left loaded with nothing to colour.
 */
function callDisc(entry: DiscEntry, size: 'lg' | 'sm' | 'xs', photos: ContactPhotos): HTMLElement {
  const disc = document.createElement('span');
  // The size is the only thing that varies here; the stylesheet owns the rest.
  disc.className = size === 'lg' ? 'call-disc' : `call-disc call-disc-${size}`;
  disc.setAttribute('aria-hidden', 'true');
  disc.textContent = callInitials(entry);
  attachPhoto(disc, entry, photos);
  return disc;
}

/** What every disc is drawn from. `hasPhoto` is present only where a list actually carries it. */
interface DiscEntry {
  contactName?: string;
  number?: string;
  hasPhoto?: boolean;
}

/**
 * Whether this row could have a photograph at all, asked before spending a request on it.
 *
 * Three sources, three answers, and the middle one is an inference worth stating rather than
 * burying:
 *
 * | Source | Signal |
 * |---|---|
 * | `contacts.list` | `hasPhoto`, which the phone reads straight off `Contacts.PHOTO_ID`. Exact |
 * | `call.log` / `call.incoming` | **no photo field at all** — only whether the phone resolved a `contactName` |
 * | anything with no number | nothing to look up |
 *
 * The middle row is the inference: a call row's `contactName` and a photograph are resolved from
 * the *same* `PhoneLookup` match on the *same* number, so a row the phone could not name is a row
 * with no contact behind it, and a contact is the only thing that can hold a photograph. On this
 * handset that skips roughly half the log for free.
 *
 * What it costs, stated because an unstated assumption is the one that goes wrong: a contact with
 * a photograph and **no display name** would be skipped. `ContactsStore.list` already refuses to
 * list those rows at all (`DISPLAY_NAME_PRIMARY IS NOT NULL`), so such a contact cannot be reached
 * anywhere else in this app either — the cost is a face this app has never been able to show.
 */
function photoWorthAsking(entry: DiscEntry): boolean {
  if (!firstNonEmpty(entry.number)) return false;
  if (typeof entry.hasPhoto === 'boolean') return entry.hasPhoto;
  return firstNonEmpty(entry.contactName) !== undefined;
}

/**
 * Draws the photograph over the disc's initials, now if it is known and later if it is not.
 *
 * **The initials are never removed.** The disc is built complete and correct first, and a photo is
 * painted on top of it; a fetch that fails, is refused, or never returns leaves exactly the disc
 * this pane has always drawn. That is the whole degradation story and it needs no state of its own
 * — there is no loading spinner, because the thing under the spinner is already the right answer.
 *
 * No liveness check on `disc` before painting. A redraw builds a *new* disc which takes the cached
 * value synchronously in the same frame; painting a detached element is a write to something
 * nobody can see, which is cheaper than tracking whether it is still in the document.
 */
function attachPhoto(disc: HTMLElement, entry: DiscEntry, photos: ContactPhotos): void {
  const number = firstNonEmpty(entry.number);
  if (!number || !photoWorthAsking(entry)) {
    photos.countSkipped();
    return;
  }
  const held = photos.cached(number);
  if (held !== undefined) {
    if (held) paintPhoto(disc, held);
    return;
  }
  void photos.resolve(number).then((source) => {
    if (source) paintPhoto(disc, source);
  });
}

/** The one place a photo source reaches the DOM, so the one place it has to be checked. */
function paintPhoto(disc: HTMLElement, source: string): void {
  disc.style.backgroundImage = `url("${source}")`;
  disc.classList.add('has-photo');
}

/**
 * The rows one tab shows.
 *
 * `contacts` is **not** a filter over the log — it is a different source entirely, so this returns
 * an empty list for it rather than pretending. The view swaps in the contact search there.
 */
function filterCallLog(log: CallLogRow[], tab: CallsTab): CallLogRow[] {
  if (tab === 'missed') return log.filter((entry) => entry.type === 'missed');
  if (tab === 'contacts') return [];
  return log;
}

/**
 * The design's *Frequently called* list, derived from the log rather than from a favourites list
 * the wire does not carry.
 *
 * Grouped by number, because a number is the thing you can dial and a name is not. The count comes
 * out with each row: it is the basis for the word "frequently", and a list of three names with no
 * numbers beside them is a claim with its denominator removed — the rule this project keeps
 * rewriting. Ties break on the most recent call, so the list does not reorder itself at random
 * between two equally-called numbers.
 */
function frequentlyCalled(
  log: CallLogRow[],
  limit = 3,
): { number: string; label: string; count: number; lastMs: number }[] {
  const byNumber = new Map<string, { number: string; label: string; count: number; lastMs: number }>();
  for (const entry of log) {
    const number = firstNonEmpty(entry.number);
    if (!number) continue;
    const held = byNumber.get(number);
    if (held) {
      held.count += 1;
      if (entry.dateMs > held.lastMs) held.lastMs = entry.dateMs;
      if (held.label === number) held.label = firstNonEmpty(entry.contactName) ?? number;
    } else {
      byNumber.set(number, {
        number,
        label: firstNonEmpty(entry.contactName) ?? number,
        count: 1,
        lastMs: entry.dateMs,
      });
    }
  }
  return [...byNumber.values()]
    .sort((a, b) => b.count - a.count || b.lastMs - a.lastMs)
    .slice(0, limit);
}

/**
 * `HH:MM:SS` for a call that is happening now.
 *
 * The design draws `00:02:18` — three fields, always — and that is kept rather than shortened to
 * `2:18`, because a clock whose width changes at the minute boundary makes the whole card twitch.
 * A negative elapsed (two clocks disagreeing) is clamped to zero rather than drawn as `-00:00:03`.
 */
function callClock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

class CallsView {
  private call: CallCard | null = null;
  private log: CallLogRow[] = [];
  private logHasMore = false;
  private loaded = false;
  /**
   * The phone's refusal of the last `call.log`, held until a read succeeds. The notice says it for
   * six seconds; this is what the history column says after that, so a refused log is never a
   * blank column (found by the overnight UI harness, 2026-10-06).
   */
  private logFailure: { reason: string; fixHint?: string } | null = null;
  private tab: CallsTab = 'all';

  private contacts: CallContactRow[] = [];
  private contactsQuery = '';
  private contactsState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private contactsReason = '';
  /** Generation counter: a late contacts reply must not overwrite a newer one. */
  private contactsRuns = 0;

  /** The number awaiting a second click. Cleared by any other interaction. See the file comment. */
  private pendingDial: string | null = null;

  /**
   * The app hosting the current call, when the phone network is not — or `null`.
   *
   * Held rather than recomputed inside `renderLive` because it is written from **two** triggers,
   * the call changing and the notification list changing, and both must reach one field through
   * one function.
   */
  private appCall: { appName: string; package: string; who?: string } | null = null;

  /** The live notification list as last seen. Empty is a legitimate answer, not a failure. */
  private notifs: CallNotifRow[] = [];

  /**
   * Every contact photograph this pane has drawn, keyed on number.
   *
   * One store for the pane rather than one per list: the live card, a log row and a *Frequently
   * called* row are routinely the same person, and three caches would fetch the same face three
   * times and could disagree about whether it exists.
   */
  private readonly photos: ContactPhotos;

  private noticeTimer: number | null = null;
  /** The live card's second-hand. One interval for the pane, started and stopped with the card. */
  private clockTimer: number | null = null;
  private holdTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly live: HTMLElement,
    private readonly body: HTMLElement,
    private readonly dialInput: HTMLInputElement,
    private readonly dialButton: HTMLButtonElement,
    private readonly notice: HTMLElement,
    private readonly tabs: HTMLElement,
    private readonly keypad: HTMLElement,
    private readonly frequent: HTMLElement,
    private readonly bridge: CallsBridge,
  ) {
    this.photos = new ContactPhotos(
      (number) => this.fetchPhoto(number),
      // Printed when the batch has actually settled, so `found` and `none` are counts of answers
      // rather than of requests. Read by `scripts/probe.mjs` over CDP; one line per batch.
      (tally) => console.info(`[calls] contact photos — ${tally}`),
    );
    // The store's own accounting, reachable from `scripts/call-photos-probe.mjs`. The DOM says how
    // many faces are on screen; this says how many were asked for and what came back, and the two
    // together are what separate "the book has four photographs" from "the fetch died after four".
    (globalThis as Record<string, unknown>).__callPhotos = () => this.photos.tally();
    bridge.onCallChanged((call) => {
      this.call = call;
      // Derived from what is already held, so the card draws at once with whatever is known, and
      // again below if the notification list turns out to have moved.
      this.applyAppCall();
      this.renderLive();
      if (call) void this.refreshNotifs();
      // A call that has just ended is a new row in the log.
      if (!call && this.loaded) void this.loadLog();
    });
    // The second trigger. An app's call notification is routinely posted a beat after the call
    // state changes, so a card drawn only on `onCallChanged` would read `Unknown number` and stay
    // there. Both triggers run the **same** derivation rather than each drawing its own answer —
    // two correct triggers owning separate copies of one state is the Files pane's race.
    bridge.onNotifChanged((list) => {
      this.notifs = list ?? [];
      if (this.applyAppCall()) this.renderLive();
    });
    this.dialButton.addEventListener('click', () => void this.dial());
    this.dialInput.addEventListener('input', () => {
      // Editing the number withdraws the confirmation. A pending confirm that survived an edit
      // would place a call to a number nobody confirmed.
      if (this.pendingDial !== null) {
        this.pendingDial = null;
        this.renderDialButton();
      }
    });
    this.renderKeypad();
    this.renderTabs();
    this.renderLive();
    this.renderFrequent();
  }

  /**
   * Turns a number into something a disc can draw, or `null`.
   *
   * Every refusal collapses to `null` because the caller's answer to all of them is the same: keep
   * the initials. The base64 is checked before it is interpolated into a CSS `url()` — the phone
   * is the only thing that writes this field and it writes a PNG, but this is the one place a
   * value from the wire reaches a stylesheet, and a check at the boundary costs one regex.
   */
  /**
   * Re-derive [appCall] from the call and the notification list already held.
   *
   * Returns whether it changed, so a caller can decide whether a redraw is owed — an unconditional
   * `renderLive()` on every notification change would rebuild the card, and its running clock, on
   * every notification this phone posts.
   */
  private applyAppCall(): boolean {
    const found = appCallFor(this.call, this.notifs);
    const before = this.appCall?.package ?? null;
    const after = found?.package ?? null;
    this.appCall = found;
    return before !== after;
  }

  /**
   * Ask for the notification list, and say what came back.
   *
   * Never throws. The notification-listener grant is a different capability from `calls`, and a
   * phone sharing calls but not notifications is an ordinary configuration rather than an error —
   * it just means a call with no number stays `Unknown number`, which is what it said before.
   */
  private async refreshNotifs(): Promise<void> {
    const list = await this.bridge.notifList().catch(() => null);
    if (list === null) {
      // Logged rather than swallowed: this is the branch where naming silently stops working, and
      // the tally beside it is what makes "no app calls today" distinguishable from "never asked".
      console.info('[calls] notifList unavailable — a call with no number stays unnamed');
      return;
    }
    this.notifs = list;
    if (this.applyAppCall()) {
      console.info(
        `[calls] call named from a notification: ${this.appCall?.appName ?? 'none'} ` +
          `— ${list.length} notifications, ${list.filter((n) => n.category === 'call').length} in ` +
          'category call',
      );
      this.renderLive();
    }
  }

  private async fetchPhoto(number: string): Promise<string | null> {
    const result = await this.bridge
      .contactsGet({ number, withPhoto: true })
      .catch(() => null);
    if (!result || !result.ok) return null;
    const photo = result.data.photo;
    if (typeof photo !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo)) return null;
    return `data:image/png;base64,${photo}`;
  }

  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.call = null;
      this.log = [];
      this.loaded = false;
      this.logFailure = null;
      this.pendingDial = null;
      // A face outliving its link is the same stale claim as a name outliving it, and the main
      // process drops its name cache here for exactly this reason.
      this.photos.clear();
      // And so is an app name derived from a notification list this Mac can no longer see.
      this.appCall = null;
      this.notifs = [];
      this.renderLive();
      this.renderLog();
      this.renderDialButton();
      this.renderTabs();
      this.renderFrequent();
      return;
    }
    if (!this.loaded) void this.loadLog();
    void this.refreshCurrent();
  }

  async refresh(): Promise<void> {
    if (this.card.classList.contains('hidden')) return;
    await this.refreshCurrent();
    await this.loadLog();
  }

  private lastAskedAtMs: number | null = null;
  private returning: Promise<void> | null = null;

  /**
   * The pane was returned to (route, focus, a link that came back). The log is read once when the
   * phone first offers calls and again when a call ends **while this Mac is watching** — so a call
   * made or missed while the link was down, or the Mac asleep, never reached the list (UX batch
   * 2026-10-10). Fifty rows, so a return re-reads them whole; `shared/returnRefresh.ts` decides when.
   */
  async onReturn(trigger: ReturnTrigger, nowMs = Date.now()): Promise<void> {
    if (this.card.classList.contains('hidden')) return;
    if (!shouldRefreshOnReturn({ trigger, nowMs, lastAskedAtMs: this.lastAskedAtMs, inFlight: this.returning !== null })) return;
    this.lastAskedAtMs = nowMs;
    this.returning = this.refresh().finally(() => {
      this.returning = null;
    });
    await this.returning;
  }

  private async refreshCurrent(): Promise<void> {
    this.call = await this.bridge.callCurrent().catch(() => null);
    this.applyAppCall();
    this.renderLive();
    // A call replayed on connect needs naming too. `call.incoming` is replayed after `hello.ack`
    // for a call already in progress, and that path does not go through `onCallChanged`.
    if (this.call) void this.refreshNotifs();
  }

  private async loadLog(): Promise<void> {
    const result = await this.bridge.callLog({ limit: 50 }).catch(
      (error): CallsResult<{ calls: CallLogRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own calls channel (${String(error)}).`,
      }),
    );
    if (!result.ok) {
      this.logFailure = {
        reason: result.reason ?? 'The call log could not be read.',
        ...(result.fixHint ? { fixHint: result.fixHint } : {}),
      };
      this.showNotice(this.logFailure.reason, result.fixHint);
      this.renderLog();
      this.renderFrequent();
      return;
    }
    this.logFailure = null;
    this.loaded = true;
    this.log = result.data.calls;
    this.logHasMore = result.data.hasMore;
    this.renderLog();
    this.renderTabs();
    this.renderFrequent();
  }

  /** The phone's refusal and its hint, as one sentence for the history column. */
  private failureSentence(): string {
    const failure = this.logFailure;
    if (!failure) return '';
    return failure.fixHint ? `${failure.reason} ${failure.fixHint}` : failure.reason;
  }

  /** Asks the phone again. The only way back from a refusal that is not a reconnect. */
  private logRetry(): HTMLElement {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button calls-log-retry';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => void this.loadLog());
    return retry;
  }

  // ---- The tab strip -----------------------------------------------------------------------

  /**
   * All / Missed / Contacts, which is the handoff's strip with its own counts.
   *
   * The **Missed** count is drawn only once the log has actually been read. Before that a `0`
   * would be a reading taken of nothing — an absence with no control behind it — and it is the one
   * number on this screen somebody would act on.
   */
  private renderTabs(): void {
    this.tabs.replaceChildren();
    const missed = this.log.filter((entry) => entry.type === 'missed').length;
    const labels: [CallsTab, string][] = [
      ['all', 'All'],
      ['missed', this.loaded ? `Missed ${missed}` : 'Missed'],
      ['contacts', 'Contacts'],
    ];
    for (const [id, label] of labels) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'calls-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      tab.textContent = label;
      tab.addEventListener('click', () => {
        if (this.tab === id) return;
        this.tab = id;
        this.renderTabs();
        this.renderLog();
        if (id === 'contacts' && this.contactsState === 'idle') void this.loadContacts('');
      });
      this.tabs.appendChild(tab);
    }
  }

  // ---- The live card -----------------------------------------------------------------------

  /** The live card: the one call that can be acted on, or the state that says there is none. */
  private renderLive(): void {
    this.live.textContent = '';
    if (this.clockTimer !== null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (!this.call) {
      this.live.classList.add('is-idle');
      this.renderNoCall();
      return;
    }
    this.live.classList.remove('is-idle');

    // Through `callDisc` like the other three sites. This was a fourth, hand-built copy, and it
    // had already drifted — it never set `--disc-hue`. That drift is harmless (the big disc is
    // deliberately hue-less) and it is exactly the shape the one-function rule exists to stop.
    const disc = callDisc(this.call, 'lg', this.photos);

    const who = document.createElement('div');
    who.className = 'call-who';
    // Name when contacts can supply one, number when it cannot, never blank — the same rule as
    // the SMS thread list, and the reason contacts was brought forward into this phase.
    //
    // Defect 35: this was `??`, which does not catch an empty string. `"" ?? x` is `""`, so a
    // phone that reported `number: ""` walked straight past the fallback chain written to
    // prevent exactly this, and the card drew a blank. Emptiness, not nullishness.
    //
    // An app-hosted call is the one case with neither a number nor a contact name, and the app's
    // own notification is the only thing on this Mac that can name it. See `src/shared/appCall.ts`.
    who.textContent = this.appCall ? appCallWho(this.appCall) : callWho(this.call);

    const state = document.createElement('div');
    state.className = 'call-state mono';
    // `Ringing · WhatsApp` rather than a bare `Ringing`. The separator belongs to whatever follows
    // it — defect 35's rule — and for an app call what follows is the app rather than a number.
    state.textContent = this.appCall
      ? appCallStatus(this.call.state, this.appCall)
      : callStatus(this.call);

    // The design's running clock. It is `startedAtMs` against this Mac's clock, ticking, and it is
    // the one number on the card that is a measurement rather than a label.
    const clock = document.createElement('div');
    clock.className = 'call-clock mono';
    clock.id = 'call-clock';
    const started = this.call.startedAtMs;
    const tick = () => {
      clock.textContent = callClock(Date.now() - started);
    };
    tick();
    this.clockTimer = window.setInterval(tick, 1_000);

    const bar = document.createElement('div');
    bar.className = 'call-actions';

    if (this.call.state === 'ringing') {
      const answer = document.createElement('button');
      answer.id = 'call-answer';
      answer.type = 'button';
      // The primary action (lime is allowed on exactly this): answering is the one thing to do.
      answer.className = 'button primary-action call-answer';
      answer.textContent = 'Answer on phone';
      // The label says where it answers. There is no audio path and there never will be — see the
      // file comment and docs/permissions.md — so a bare "Answer" would be a promise this cannot keep.
      answer.title = 'Answers on the phone. There is no audio between the phone and this Mac.';
      answer.addEventListener('click', () => void this.run(this.bridge.callAnswer()));
      bar.appendChild(answer);
    }

    const reject = document.createElement('button');
    reject.id = 'call-reject';
    reject.type = 'button';
    // The destructive button component — Reject and Hang up keep their labels (handoff §5b).
    reject.className = 'button danger call-hangup';
    reject.textContent = this.call.state === 'active' ? 'Hang up' : 'Reject';
    reject.addEventListener('click', () => void this.run(this.bridge.callReject()));
    bar.appendChild(reject);

    const audio = audioStrip(paneAudioSentence());

    // Where the design's Mute / Keypad / Speaker row sits. Saying the three controls are on the
    // phone is a smaller lie than drawing three buttons that do nothing, and a much smaller one
    // than drawing three that look like they might.
    // The second strip **replaces** the third rather than joining it, and that is a measurement
    // rather than a preference. Three strips put the last one at 728–826 inside a `#page` scroll
    // port ending at 795 — 31px clipped, `fraction: 0.69`. A card carrying a *state* has to be
    // visible at rest and not merely reachable (defect 85), and nobody scrolls a ringing call.
    //
    // So for an app-hosted call one strip says both things. It claims only what is established:
    // which app owns the call, that mute and speaker live on the phone, and that the reach of the
    // two buttons above is **unmeasured**. It does not say "cannot", because nobody has shown
    // that; and it does not say audio or video, because `Notification.category` is `"call"` for
    // both and this phone puts no `EXTRA_CALL_IS_VIDEO` on the wire.
    const controlled = this.appCall
      ? audioStrip(appCallNote(this.appCall.appName))
      : audioStrip('Mute, speaker and keypad tones are controlled on the phone.');
    controlled.classList.add('call-controlled-note');
    if (this.appCall) {
      controlled.classList.add('call-hosted-note');
      controlled.setAttribute('data-app-call', this.appCall.package);
    }

    this.live.append(disc, who, state, clock, bar, audio, controlled);
  }

  /**
   * The state the design does not draw: no call.
   *
   * The handoff's Calls screen only ever shows a call in progress, so this is a fifth pane
   * inventing its own empty state — after Notifications (N4), Photos (P5), Files (F7) and Activity
   * (A2). It is recorded in `docs/design-departures.md` rather than quietly styled, because the
   * fifth invention is the one that proves the vocabulary is missing rather than that four panes
   * were unlucky.
   */
  private renderNoCall(): void {
    // The shared empty state (component 11): no action, because there is nothing to act on.
    const empty = stateBlock({
      kind: 'empty',
      icon: 'calls',
      headline: 'No call in progress',
      body:
        'A call ringing on the phone appears here, and you can answer or reject it from this Mac. ' +
        'Dial from the keypad on the right.',
    });

    // The design's own strip at the foot of the call card — a `--well` panel with a phone glyph,
    // reading *"Audio is routed through Galaxy S26 Ultra"*. The **shape** is taken and the sentence
    // is not: the design's line describes a routing that exists, and here there is no audio path at
    // all and never will be. This is that shape carrying the true sentence, in every state rather
    // than only during a call, because someone who has not yet made a call is exactly the person
    // who needs to know before they try.
    const audio = audioStrip(paneAudioSentence());

    this.live.append(empty, audio);
  }

  // ---- The log -----------------------------------------------------------------------------

  private renderLog(): void {
    this.body.textContent = '';
    if (this.tab === 'contacts') {
      this.renderContacts();
      return;
    }
    if (!this.loaded) {
      if (this.logFailure) {
        this.note.textContent = this.failureSentence();
        this.body.appendChild(this.logRetry());
        return;
      }
      this.note.textContent = 'Reading the phone’s call log…';
      return;
    }
    const rows = filterCallLog(this.log, this.tab);
    if (this.log.length === 0) {
      this.note.textContent = 'There are no calls in the phone’s log.';
      return;
    }
    if (rows.length === 0) {
      // A4/A3's distinction, one pane over: nothing matching is not nothing recorded, and the
      // sentence names the filter so the way out is obvious.
      this.note.textContent = `No missed calls in the ${this.log.length} the phone sent.`;
      return;
    }
    // Both numbers again: a call log is a column of phone numbers without contacts.
    const named = rows.filter((c) => c.contactName).length;
    const missed = this.log.filter((c) => c.type === 'missed').length;
    this.note.textContent =
      this.tab === 'missed'
        ? `${rows.length} missed of ${this.log.length} recent calls.`
        : `${rows.length} recent call${rows.length === 1 ? '' : 's'}, ` +
          `${named} showing a contact name, ${missed} missed.` +
          (this.logHasMore ? ' Older calls are not shown.' : '');
    // A re-read was refused: the rows below were true when they were read, so they stay, and the
    // note says they are the last read rather than letting them pass for current.
    if (this.logFailure) {
      this.note.textContent = `${this.failureSentence()} Showing the log as last read.`;
      this.body.appendChild(this.logRetry());
    }

    const list = document.createElement('div');
    list.className = 'call-log';
    for (const entry of rows) list.appendChild(this.logRow(entry));
    this.body.appendChild(list);
  }

  /**
   * One log row, and **the row is the button**.
   *
   * The first build put a *Call back* button in a fourth grid column. At 300px it reserved its
   * width whether it was visible or not, and what it squeezed out was the caller's name — the one
   * thing on this list anybody reads. The design has no button in the row either: `.cs-row` carries
   * `cursor: pointer` and the whole thing is the target. A `<button>` rather than a `<div>` so it
   * is reachable from the keyboard and announces itself.
   */
  private logRow(entry: CallLogRow): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `call-row ${entry.type}`;

    const disc = callDisc(entry, 'sm', this.photos);

    const lines = document.createElement('span');
    lines.className = 'call-row-lines';

    const who = document.createElement('span');
    who.className = 'call-log-who';
    who.textContent = firstNonEmpty(entry.contactName, entry.number) ?? 'Unknown number';

    const kind = document.createElement('span');
    kind.className = 'call-log-kind';
    // An unrecognised type is shown as itself rather than guessed at — the protocol has an
    // `unknown` member precisely so a new platform value is not silently drawn as "incoming".
    kind.textContent =
      entry.type + (entry.durationMs ? ` · ${duration(entry.durationMs)}` : '');

    lines.append(who, kind);

    const when = document.createElement('span');
    when.className = 'call-log-when mono';
    when.textContent = timeOfCall(entry.dateMs);

    // Fills the dialler rather than placing the call: the confirm step is the dialler's, and there
    // is exactly one of it. The label says so, because a row that dialled on one click over a log
    // of real phone numbers is the coordinate-click accident with a nicer surface.
    row.title = `Put ${firstNonEmpty(entry.contactName, entry.number) ?? 'this number'} in the dialler`;
    row.addEventListener('click', () => this.fillDialler(entry.number));

    row.append(disc, lines, when);
    return row;
  }

  // ---- The Contacts tab --------------------------------------------------------------------

  /**
   * The phone does the matching, exactly as the Contacts pane does.
   *
   * There is no book on the Mac to filter, and a local filter would stop finding people whose
   * number is stored in a format nobody typed. This tab is a way to reach the dialler, not a
   * second contacts pane: one line per person and one button.
   */
  private async loadContacts(query: string): Promise<void> {
    const mine = ++this.contactsRuns;
    this.contactsQuery = query;
    this.contactsState = 'loading';
    this.renderLog();
    const result = await this.bridge
      .contactsList({ query, limit: 30 })
      .catch((error): CallsResult<{ contacts: CallContactRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own contacts channel (${String(error)}).`,
      }));
    // A second keystroke's reply may land first; a run that is no longer the newest discards its
    // own result rather than drawing it over a fresher one. Same rule as the clipboard pane's
    // refresh, and the Files pane paid for its absence.
    if (mine !== this.contactsRuns) return;
    if (!result.ok) {
      this.contactsState = 'failed';
      this.contactsReason = result.reason ?? 'The phone did not answer.';
    } else {
      this.contactsState = 'ready';
      this.contacts = result.data.contacts;
    }
    this.renderLog();
  }

  private renderContacts(): void {
    this.note.textContent =
      this.contactsState === 'ready'
        ? `${this.contacts.length} contact${this.contacts.length === 1 ? '' : 's'} from the phone.`
        : this.contactsState === 'failed'
          ? this.contactsReason
          : 'Asking the phone for its contacts…';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'calls-contact-search';
    search.id = 'calls-contact-search';
    search.placeholder = 'Search contacts';
    search.setAttribute('aria-label', 'Search contacts');
    search.value = this.contactsQuery;
    search.addEventListener('input', () => void this.loadContacts(search.value));
    this.body.appendChild(search);

    if (this.contactsState !== 'ready') return;

    const list = document.createElement('div');
    list.className = 'call-log';
    for (const contact of this.contacts) {
      const number = firstNonEmpty(contact.numbers[0]?.value);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'call-row';
      // A contact with no number is drawn and **disabled**, not filtered out: "not in the list" and
      // "in the list with nothing to dial" are different facts about a person, and hiding the
      // second makes the search look broken.
      if (!number) row.disabled = true;
      else {
        row.title = `Put ${contact.displayName} in the dialler`;
        row.addEventListener('click', () => this.fillDialler(number));
      }

      const disc = callDisc(
        { contactName: contact.displayName, number, hasPhoto: contact.hasPhoto },
        'sm',
        this.photos,
      );

      const lines = document.createElement('span');
      lines.className = 'call-row-lines';
      const who = document.createElement('span');
      who.className = 'call-log-who';
      who.textContent = contact.displayName;
      const sub = document.createElement('span');
      sub.className = 'call-log-kind';
      // A contact with no number is drawn and its row says so, rather than being filtered out:
      // "not in the list" and "in the list with nothing to dial" are different facts about a
      // person, and hiding the second makes the search look broken.
      sub.textContent = number ?? 'No number on this contact';
      lines.append(who, sub);

      const when = document.createElement('span');
      when.className = 'call-log-when mono';
      when.textContent = contact.numbers[0]?.label ?? '';

      row.append(disc, lines, when);
      list.appendChild(row);
    }
    this.body.appendChild(list);
  }

  // ---- The dialler -------------------------------------------------------------------------

  /**
   * The handoff's 3×4 keypad.
   *
   * It types into the field rather than dialling — the confirm step is the Call button's and there
   * is exactly one of it. A keypad that dialled on the twelfth key would place a call from a
   * mistyped digit with nothing between the two.
   */
  private renderKeypad(): void {
    this.keypad.replaceChildren();
    for (const key of DIAL_KEYS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dialkey';
      button.setAttribute('aria-label', key.hold ? `${key.digit}, hold for ${key.hold}` : key.digit);

      const digit = document.createElement('span');
      digit.className = 'dialkey-digit mono';
      digit.textContent = key.digit;
      const sub = document.createElement('span');
      sub.className = 'dialkey-sub';
      sub.textContent = key.sub;
      button.append(digit, sub);

      if (key.hold) {
        // Hold-to-type-`+`, which is what a phone does. `held` is what stops the click that
        // follows a hold from typing a `0` after the `+` — the mouse fires both.
        let held = false;
        button.addEventListener('mousedown', () => {
          held = false;
          this.holdTimer = window.setTimeout(() => {
            held = true;
            this.holdTimer = null;
            this.type(key.hold as string);
          }, HOLD_MS);
        });
        const cancel = () => {
          if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
          }
        };
        button.addEventListener('mouseup', cancel);
        button.addEventListener('mouseleave', cancel);
        button.addEventListener('click', () => {
          if (held) {
            held = false;
            return;
          }
          this.type(key.digit);
        });
      } else {
        button.addEventListener('click', () => this.type(key.digit));
      }
      this.keypad.appendChild(button);
    }

    // Not in the design, and it has to be: a keypad with no way back is unusable the first time a
    // finger slips. Recorded as departure C5.
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'dialkey dialkey-back';
    back.setAttribute('aria-label', 'Delete the last digit');
    back.textContent = '⌫';
    back.addEventListener('click', () => {
      this.dialInput.value = this.dialInput.value.slice(0, -1);
      this.withdrawConfirm();
    });
    this.keypad.appendChild(back);
  }

  private type(text: string): void {
    this.dialInput.value += text;
    this.withdrawConfirm();
  }

  /** Any edit to the number withdraws an armed confirmation. See [dial]. */
  private withdrawConfirm(): void {
    if (this.pendingDial !== null) {
      this.pendingDial = null;
      this.renderDialButton();
    }
  }

  /** Public for Messages' *Call this number*: fills, never dials — the confirm step is the dialler's. */
  fillDialler(number: string): void {
    this.dialInput.value = number;
    this.pendingDial = null;
    this.renderDialButton();
    this.dialInput.focus();
  }

  /**
   * The design's *Frequently called*, over the phone's log.
   *
   * Drawn only once the log has been read. Before that the list would be empty for two different
   * reasons — nothing read yet, and nobody called twice — and they look identical.
   */
  private renderFrequent(): void {
    this.frequent.replaceChildren();
    if (!this.loaded) {
      const waiting = document.createElement('div');
      waiting.className = 'calls-frequent-note';
      waiting.textContent = this.logFailure
        ? 'Counted from the phone’s call log, which could not be read.'
        : 'Read from the phone’s call log once it arrives.';
      this.frequent.appendChild(waiting);
      return;
    }
    const rows = frequentlyCalled(this.log);
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.className = 'calls-frequent-note';
      none.textContent = 'Nothing in the log to count yet.';
      this.frequent.appendChild(none);
      return;
    }
    for (const entry of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'calls-frequent-row';
      // `label` falls back to the number when the phone could not name the caller, so it is not
      // a contact name and must not be handed over as one — `photoWorthAsking` reads it as the
      // evidence that a contact exists, and a number is evidence of the opposite.
      const named = entry.label === entry.number ? undefined : entry.label;
      const disc = callDisc({ contactName: named, number: entry.number }, 'xs', this.photos);
      const label = document.createElement('span');
      label.className = 'calls-frequent-label';
      label.textContent = entry.label;
      const count = document.createElement('span');
      count.className = 'calls-frequent-count';
      // The count, not "Mobile". We do not know the number's type and the count is what the word
      // "frequently" is actually asserting.
      count.textContent = `${entry.count} call${entry.count === 1 ? '' : 's'}`;
      row.append(disc, label, count);
      row.addEventListener('click', () => this.fillDialler(entry.number));
      this.frequent.appendChild(row);
    }
  }

  /**
   * Two clicks, one call.
   *
   * The first click arms; the second places. Between them the button says exactly who is about to
   * be called, because the number in the box is the only thing that decides it and a mistyped
   * digit reaches a stranger.
   */
  private async dial(): Promise<void> {
    const number = this.dialInput.value.trim();
    if (!number) {
      this.showNotice('Type a number to call.');
      return;
    }
    if (this.pendingDial !== number) {
      this.pendingDial = number;
      this.renderDialButton();
      return;
    }
    this.pendingDial = null;
    this.renderDialButton();
    const result = await this.bridge.callDial(number).catch((error): CallsAck => ({
      ok: false,
      reason: `The Mac could not reach its own calls channel (${String(error)}).`,
    }));
    if (result.ok) this.showNotice(`Calling ${number} from the phone.`);
    else this.showNotice(result.reason ?? 'The call was not placed.', result.fixHint);
  }

  private renderDialButton(): void {
    this.dialButton.textContent = this.pendingDial
      ? `Confirm — call ${this.pendingDial}`
      : 'Call';
    this.dialButton.classList.toggle('is-confirming', this.pendingDial !== null);
  }

  private async run(intent: Promise<CallsAck>): Promise<void> {
    const result = await intent.catch((error): CallsAck => ({
      ok: false,
      reason: `The Mac could not reach its own calls channel (${String(error)}).`,
    }));
    if (!result.ok) this.showNotice(result.reason ?? 'That did not work.', result.fixHint);
  }

  private showNotice(text: string, hint?: string): void {
    this.notice.hidden = false;
    this.notice.textContent = text;
    if (hint) {
      const line = document.createElement('div');
      line.className = 'hint';
      line.textContent = ` ${hint}`;
      this.notice.appendChild(line);
    }
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.notice.hidden = true;
      this.notice.textContent = '';
    }, 6_000);
  }
}

function timeOfCall(whenMs: number): string {
  if (!whenMs) return '';
  const at = new Date(whenMs);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    // 24-hour, the system's one clock format (Messages, Overview's Recent rows) — `09:40`.
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** `m:ss` for a call length. Zero is not drawn at all — a missed call has no duration. */
function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// The renderer is loaded as a plain <script> and cannot use `export`, so the pure label rules are
// hung on the global for src/renderer/calls.test.ts to reach. In the browser this is one property
// nobody reads; in the test it is what makes defect 35 assertable against the code that draws it,
// rather than against a second copy of the rule that could drift from it.
(globalThis as Record<string, unknown>).__callLabels = {
  firstNonEmpty,
  callWho,
  callStatus,
  callInitials,
  filterCallLog,
  frequentlyCalled,
  callClock,
  DIAL_KEYS,
  paneAudioSentence,
};
// The view class itself, for `callsView.test.ts` — the debt-list entry this removes was
// "the drawing half is not [tested]", and three renderer-only breaks have shipped green.
(globalThis as Record<string, unknown>).CallsView = CallsView;
