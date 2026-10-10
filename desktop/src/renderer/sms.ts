/**
 * The SMS pane: a list of conversations, one conversation open at a time, and a compose box.
 *
 * Module-free on purpose, like the other renderer files.
 *
 * ### The rules this pane enforces
 *
 * **The compose box sends a thread id and a body, and never a recipient.** It cannot name who the
 * message goes to, because it does not know and must not guess — `SmsClient.send` resolves the
 * recipients from the thread rows the main process holds, and the phone re-checks them against the
 * provider before anything leaves the radio. See the send rule in docs/protocol.md. This pane is
 * the layer most likely to be stale, which is exactly why it is the layer trusted least.
 *
 * **An MMS with an attachment says so.** Attachments are not delivered by this protocol — pulling
 * an image out of `content://mms` is a bulk transfer and belongs to Phase 5 — so a text-only
 * rendering of an MMS would present a fragment as the whole message. The row carries a marker
 * instead, which is honest about what is missing.
 */

interface SmsThreadRow {
  threadId: string;
  addresses: string[];
  snippet: string;
  dateMs: number;
  unread: number;
  messageCount: number;
  contactName?: string;
}

interface SmsMessageRow {
  id: string;
  threadId?: string;
  address: string;
  body: string;
  dateMs: number;
  inbound: boolean;
  read: boolean;
  kind: 'sms' | 'mms';
  hasAttachments: boolean;
}

type SmsResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface SmsBridge {
  smsThreads(options: { limit?: number; before?: number }): Promise<
    SmsResult<{ threads: SmsThreadRow[]; hasMore: boolean }>
  >;
  smsMessages(threadId: string, options: { limit?: number; before?: number }): Promise<
    SmsResult<{ threadId: string; messages: SmsMessageRow[]; hasMore: boolean }>
  >;
  smsSend(threadId: string, body: string): Promise<{ ok: boolean; reason?: string; fixHint?: string }>;
  /** Defect 30. Names a recipient and no thread — the only call in this pane that may. */
  smsSendNew(
    addresses: string[],
    body: string,
  ): Promise<{ ok: boolean; reason?: string; fixHint?: string; threadId?: string }>;
  onSmsReceived(callback: (event: { threadId: string; message: SmsMessageRow }) => void): void;
}

/**
 * One entry per conversation, keeping the first seen.
 *
 * Exported onto `globalThis` at the foot of this file like the rest of the pane's pure rules, so
 * the test runs the function the pane runs rather than a second copy of the same idea.
 */
function dedupeByThread<T extends { threadId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.threadId)) continue;
    seen.add(row.threadId);
    out.push(row);
  }
  return out;
}

/**
 * The four regions this pane draws into.
 *
 * An object rather than nine positional constructor arguments: the pane went from one `#sms-body`
 * to three columns plus a panel on 2026-09-05, and a nine-argument constructor is a place where two
 * elements get swapped and nothing complains — every one of them is an `HTMLElement`.
 */
interface SmsRegions {
  tabs: HTMLElement;
  list: HTMLElement;
  chatHead: HTMLElement;
  chatBody: HTMLElement;
  composer: HTMLElement;
  person: HTMLElement;
  newPanel: HTMLElement;
  newButton: HTMLElement;
  newCancel: HTMLElement;
  newTo: HTMLInputElement;
  newBody: HTMLInputElement;
  newSend: HTMLButtonElement;
  /**
   * Where the pane draws a state that replaces or heads the columns — the permission block, and the
   * Disconnected banner. Optional so a test that is not about link state need not build one.
   */
  state?: HTMLElement;
  /** The caption under the thread list: *"48 threads · newest first"* in frame `32:4382`. */
  threadsFoot?: HTMLElement;
  /**
   * *Call this number*, from the person column. It **fills the Calls dialler and goes there**; it
   * never dials. Dialling confirms first (calls.ts), and a button on another screen that placed a
   * call without that step would be a second, weaker path to the same irreversible act.
   */
  callNumber?: (number: string) => void;
}

/** The pane's link state. Three facts, not one boolean — see [SmsView.setLinkState]. */
type SmsLink = 'live' | 'permission' | 'disconnected';

type SmsTabId = 'all' | 'unread';

/**
 * The filter strip, and it is two tabs where the design draws three.
 *
 * The reasoning is on [SmsView.renderTabs] because that is where someone reading the pane will look
 * for it; the short version is that neither *SMS* nor *Chat* is answerable from `sms.threads`, and
 * `unread` is.
 */
const SMS_TABS: ReadonlyArray<{ id: SmsTabId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
];

/** The rows one tab shows. Pure, and the tab counts are taken from it rather than recomputed. */
function filterThreads(threads: readonly SmsThreadRow[], tab: SmsTabId): SmsThreadRow[] {
  return tab === 'unread' ? threads.filter((one) => one.unread > 0) : [...threads];
}

/**
 * Who a conversation is with: the contact name, else the first address, else words.
 *
 * One function, because four sites draw this — the row, the chat header, the person card and its
 * number line — and a fallback chain written four times is a fallback chain that disagrees with
 * itself the first time one of them is edited.
 */
const UNKNOWN_THREAD = 'Unknown number';

function threadWho(thread: SmsThreadRow): string {
  const name = (thread.contactName ?? '').trim();
  if (name) return name;
  const address = (thread.addresses[0] ?? '').trim();
  // Emptiness, not nullishness — defect 35's rule. `"" ?? x` is `""`, and a phone that reported an
  // empty address walked straight past a `??` chain written to prevent exactly this.
  return address || UNKNOWN_THREAD;
}

/**
 * Initials for the disc. `#` for a bare number and for a thread with nothing at all.
 *
 * It checks the **placeholder** as well as the shape, and that is not fussiness: `threadWho` falls
 * back to the words *Unknown number*, which are letters, so taking initials from its output gave an
 * unidentified sender a confident `UN` disc — a placeholder promoted to a name one function later.
 * `#` is the Calls pane's convention for the same situation and this now matches it.
 */
function threadInitials(thread: SmsThreadRow): string {
  const who = threadWho(thread);
  if (who === UNKNOWN_THREAD) return '#';
  if (!/[\p{L}]/u.test(who)) return '#';
  const words = who.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  /*
   * A single word gives its **first two** letters, not its first one.
   *
   * Most of this phone's list is machine sender ids — `AD-SUJAMK-P`, `VM-TNSBIC-P`, `CP-INUTRA-P` —
   * which are one word by any rule a computer can apply, so first-letter-per-word drew a column of
   * discs reading `A`, `V`, `C`. Two letters is both what the design draws and what makes those ids
   * tell each other apart, since the part a reader recognises is the prefix.
   */
  if (words.length === 1) {
    const letters = (words[0]!.match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2);
    return letters.join('').toUpperCase() || '#';
  }
  const letters = words.slice(0, 2).map((word) => word.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '');
  return letters.join('') || '#';
}

/**
 * The person facts the wire can actually fill in.
 *
 * `messageCount` is the phone's own total for the thread, not the number of rows this Mac has
 * paged in — those are different numbers and only one of them is about the user's phone.
 */
function personFacts(thread: SmsThreadRow): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  rows.push([
    'Messages',
    // The phone's own total (the frame prints `128`), never the rows this Mac has paged in.
    thread.messageCount.toLocaleString(),
  ]);
  if (thread.unread > 0) rows.push(['Unread', String(thread.unread)]);
  if (thread.addresses.length > 1) {
    // A group thread. Saying so is better than showing one address and implying it is the only one.
    rows.push(['Recipients', String(thread.addresses.length)]);
  }
  if (thread.dateMs) {
    rows.push([
      'Latest',
      // The frame's `4 Mar 2024`: a date, not a timestamp — the transcript carries the times.
      new Date(thread.dateMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    ]);
  }
  return rows;
}

/**
 * The one line under the person card, replacing four controls the design draws and this wire
 * cannot serve.
 *
 * **New copy, and unratified** — the third sentence of this shape in the app, after Calls' *"Mute,
 * speaker and keypad tones are on the phone. Nothing on the wire carries them."* and Photos'
 * *"Sharing, wallpaper and deleting are on the phone. Nothing on the wire carries them."* Three
 * uses is either a house style or a rut, and that is the designer's call rather than mine; it is
 * listed with the others for the vocabulary decision.
 */
const SMS_PERSON_REFUSAL =
  'Muting and blocking happen on your phone.';

/** The composer's standing caption — frame `32:4382`, verbatim. Says who actually sends it. */
const SMS_COMPOSER_CAPTION = 'Sent as an SMS from the phone’s number, over the phone’s own network.';

/** The pane's footer strip — frame `32:4382`, verbatim. */
const SMS_PANE_FOOT =
  'Sidekick carries the text of a message. The message itself is sent by the phone, from the phone’s number.';

/**
 * The messages with a date separator inserted wherever the day changes.
 *
 * Pure and exported, because "when does a new day start" is the kind of decision that gets written
 * a second time inside a test and then disagrees. It reads the **local** day, not a 24-hour
 * subtraction: a day is not always 24 hours, and on the two days a year it is not, arithmetic on
 * milliseconds puts yesterday's messages under today's heading.
 *
 * The first message always gets a separator. A conversation that opens mid-day with no heading
 * reads as though the messages above it were cut off.
 */
function withDaySeparators(
  messages: readonly SmsMessageRow[],
): Array<{ kind: 'day'; label: string } | { kind: 'message'; message: SmsMessageRow }> {
  const out: Array<{ kind: 'day'; label: string } | { kind: 'message'; message: SmsMessageRow }> = [];
  let openDay: string | null = null;
  for (const message of messages) {
    const day = new Date(message.dateMs).toDateString();
    if (day !== openDay) {
      out.push({ kind: 'day', label: dayLabelOf(message.dateMs, Date.now()) });
      openDay = day;
    }
    out.push({ kind: 'message', message });
  }
  return out;
}

/** `Today`, `Yesterday`, `Wednesday, 14 May`. `nowMs` is a parameter so a test can cross midnight. */
function dayLabelOf(dateMs: number, nowMs: number): string {
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = midnight.getTime();
  const startOfYesterday = new Date(startOfToday - 1).setHours(0, 0, 0, 0);
  if (dateMs >= startOfToday) return 'Today';
  if (dateMs >= startOfYesterday) return 'Yesterday';
  const then = new Date(dateMs);
  return then.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(then.getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A line of text with a class. The pane builds a lot of these. */
function smsLine(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * The avatar disc: initials on neutral charcoal, as frame `32:4382` draws it. No per-person hue —
 * the Sidekick system has none (handoff §2, D2); people are told apart by name and initials.
 */
function smsDisc(thread: SmsThreadRow, size: 'sm' | 'md' | 'lg'): HTMLElement {
  const disc = document.createElement('span');
  disc.className = `sms-disc sms-disc-${size}`;
  disc.setAttribute('aria-hidden', 'true');
  disc.textContent = threadInitials(thread);
  return disc;
}

declare function iconSvg(name: string, size?: number): SVGSVGElement;
declare function disconnectedBanner(what: string, asOfMs: number | null): HTMLElement;

const PAGE = 50;

class SmsView {
  private threads: SmsThreadRow[] = [];
  private threadsHasMore = false;
  /** Defect 30: the pane is composing a message to a number that has no thread yet. */
  private composingNew = false;
  private newRecipient = '';
  private newBody = '';
  /**
   * Defect 30's no-thread half: a new-conversation send the phone acknowledged **without** naming a
   * thread — the provider creates one asynchronously, after the ack — waiting for the `sms.sent`
   * that does name it. Adopted once, by [smsNewThreadMatches], and never after its window.
   */
  private pendingNew: SmsPendingNew | null = null;
  private loaded = false;
  /**
   * The phone's refusal of the last fresh `sms.threads`, held until a read succeeds. The notice says
   * it for six seconds; the list says it after that — never "Reading…" over a refused read
   * (overnight UI harness, 2026-10-06; the Calls pane had the same gap).
   */
  private threadsFailure: { reason: string; fixHint?: string } | null = null;

  private openThreadId: string | null = null;
  private messages: SmsMessageRow[] = [];
  private messagesHasMore = false;

  /** Compose text per thread, so switching conversations does not discard a half-typed message. */
  private drafts = new Map<string, string>();

  private noticeTimer: number | null = null;

  /** Which filter tab is showing. See [SMS_TABS] for why there are two and not the design's three. */
  private tab: SmsTabId = 'all';

  private link: SmsLink = 'live';
  /** The phone's own sentence for a missing grant, verbatim. Never a Mac-side paraphrase. */
  private permissionReason: string | null = null;
  /** When the content on screen was last true — the Disconnected banner's *as of*. */
  private freshAtMs: number | null = null;
  /**
   * The last send that failed, per thread. The handoff: *"nothing is marked sent on optimism, and
   * nothing is queued after a failure"* — so the failure stays on screen beside the draft it failed
   * to send, rather than a toast that is gone in six seconds with the reason.
   */
  private sendFailures = new Map<string, { reason: string; hint?: string }>();

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly regions: SmsRegions,
    private readonly notice: HTMLElement,
    private readonly bridge: SmsBridge,
  ) {
    this.bindNewConversation();
    bridge.onSmsReceived((event) => {
      // The message the person just sent to a number with no thread: open the thread the phone
      // created for it, exactly as the explicit-address path opens the thread the ack names.
      if (smsNewThreadMatches(this.pendingNew, event.message, Date.now())) {
        this.pendingNew = null;
        void this.loadThreads().then(() => this.openThread(event.threadId));
        return;
      }
      // A message arriving in the conversation on screen is appended; one arriving elsewhere
      // refreshes the list so its snippet and unread count move. Both, because a pane that only
      // updated the open thread would leave the list quietly wrong.
      if (event.threadId === this.openThreadId) {
        this.messages = [...this.messages, event.message];
        this.render();
      }
      void this.loadThreads();
    });
  }

  /**
   * The link, as three facts rather than one boolean.
   *
   * `setAdvertised(false)` used to be the only signal, and it arrived for two different reasons: the
   * phone refusing the SMS grant, and the link dropping. The pane emptied itself for both — so a
   * Wi-Fi blip threw away every conversation on screen, which the handoff forbids outright (*"a pane
   * never empties itself on a disconnect"*), and a missing permission drew the same blank as a
   * dropped link.
   *
   *  - **connected, not advertised** → the permission state, with the phone's own reason.
   *  - **not connected** → last-known content stays, under a banner saying how old it is; the
   *    composer is blocked and says why; nothing is queued.
   */
  setLinkState(connected: boolean, advertised: boolean, reason: string | null): void {
    if (!connected) {
      this.link = 'disconnected';
      this.card.classList.remove('hidden');
      this.render();
      return;
    }
    const returning = this.link === 'disconnected';
    this.permissionReason = advertised ? null : reason;
    this.link = advertised ? 'live' : 'permission';
    this.setAdvertised(advertised);
    // The link came back. `setAdvertised` draws only on a first load, so without this the banner
    // from the drop stayed up beside a live strip and the list was never asked again (UX sweep
    // 2026-10-10). Only the transition refetches — a status tick on a live link is not a return.
    if (returning && advertised && this.loaded) {
      this.render();
      void this.loadThreads();
    }
  }

  setAdvertised(advertised: boolean): void {
    if (advertised) this.link = 'live';
    else if (this.link === 'live') this.link = 'permission';
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.threads = [];
      this.messages = [];
      this.openThreadId = null;
      this.loaded = false;
      this.threadsFailure = null;
      this.render();
      return;
    }
    if (!this.loaded) {
      // Draw *before* the fetch, not after it. `loadThreads` awaits the bridge and only then
      // renders, so the "Reading the phone's conversations" state — which exists, and is one of the
      // three the list is allowed to talk about — was never once on screen: the pane went from
      // blank straight to a list. Found by a test asserting the state and getting an empty string.
      this.render();
      void this.loadThreads();
    }
  }

  async refresh(): Promise<void> {
    if (this.card.classList.contains('hidden')) return;
    await this.loadThreads();
  }

  /**
   * Defect 32. `before` is the exclusive timestamp of the oldest thread held, exactly as the
   * message pager on the same screen already does it — the phone has always paged
   * (`SmsStore.threads(context, limit, before)`); this Mac simply never passed a cursor and said so
   * in prose the reader could not act on.
   *
   * Known limit, recorded rather than hidden: `before` is a millisecond timestamp with no
   * tiebreaker, so threads sharing one to the millisecond can be skipped or repeated at a page
   * boundary. `docs/phase-5-proposals.md` decided the fix — an optional `beforeId` and a documented
   * total ordering — and it is a protocol change across three pagers, so it is not being smuggled
   * in here. This pager is no worse than the two shipped ones and closes the defect it is named for.
   */
  private async loadThreads(before?: number): Promise<void> {
    const result = await this.bridge.smsThreads(before === undefined ? { limit: PAGE } : { limit: PAGE, before }).catch(
      (error): SmsResult<{ threads: SmsThreadRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own SMS channel (${String(error)}).`,
      }),
    );
    if (!result.ok) {
      this.showNotice(result.reason ?? 'The conversations could not be read.', result.fixHint);
      // A refused *older* page leaves every row on screen true; the notice is enough there. A
      // refused fresh read is a state of the list, and the list has to say it.
      if (before === undefined) {
        this.threadsFailure = {
          reason: result.reason ?? 'The conversations could not be read.',
          ...(result.fixHint ? { fixHint: result.fixHint } : {}),
        };
        this.render();
      }
      return;
    }
    if (before === undefined) this.threadsFailure = null;
    this.loaded = true;
    // A cursor page is appended; a fresh load replaces. Appending on a refresh would double every
    // thread already held the first time anyone pressed refresh after paging.
    //
    // **And the append de-duplicates by thread id, which is not defensive tidying — it is
    // required.** `content://mms-sms/conversations` yields a row per *message*, not per thread, so
    // a conversation with messages either side of a page boundary comes back on both pages. Page 2
    // repeated 11 of page 1's 50 threads on this device before this line existed. The first
    // occurrence is kept because the pages walk newest-first, so it is the one carrying the
    // thread's most recent snippet, date and unread count.
    this.threads =
      before === undefined
        ? result.data.threads
        : dedupeByThread([...this.threads, ...result.data.threads]);
    this.threadsHasMore = result.data.hasMore;
    this.freshAtMs = Date.now();
    this.render();
  }

  /** Pages backwards from the oldest thread held, which is what `before` means on the wire. */
  private async loadOlderThreads(): Promise<void> {
    const oldest = this.threads[this.threads.length - 1];
    if (!oldest) return;
    await this.loadThreads(oldest.dateMs);
  }

  private async openThread(threadId: string): Promise<void> {
    this.openThreadId = threadId;
    this.messages = [];
    this.messagesHasMore = false;
    this.render();

    const result = await this.bridge.smsMessages(threadId, { limit: PAGE }).catch(
      (error): SmsResult<{ threadId: string; messages: SmsMessageRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own SMS channel (${String(error)}).`,
      }),
    );
    if (!result.ok) {
      this.showNotice(result.reason ?? 'That conversation could not be read.', result.fixHint);
      return;
    }
    if (this.openThreadId !== threadId) return; // the reader moved on while it loaded
    // Oldest first for reading; the phone sends newest first because that is how it pages.
    this.messages = [...result.data.messages].sort((a, b) => a.dateMs - b.dateMs);
    this.messagesHasMore = result.data.hasMore;
    this.render();
  }

  /** Pages backwards from the oldest message held, which is what `before` means on the wire. */
  private async loadOlder(): Promise<void> {
    const threadId = this.openThreadId;
    const oldest = this.messages[0];
    if (!threadId || !oldest) return;

    const result = await this.bridge
      .smsMessages(threadId, { limit: PAGE, before: oldest.dateMs })
      .catch((error): SmsResult<{ threadId: string; messages: SmsMessageRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own SMS channel (${String(error)}).`,
      }));
    if (!result.ok) {
      this.showNotice(result.reason ?? 'Older messages could not be read.', result.fixHint);
      return;
    }
    if (this.openThreadId !== threadId) return;
    const older = [...result.data.messages].sort((a, b) => a.dateMs - b.dateMs);
    this.messages = [...older, ...this.messages];
    this.messagesHasMore = result.data.hasMore;
    this.render();
  }

  private render(): void {
    this.renderState();
    this.renderTabs();
    this.renderList();
    this.renderChat();
    this.renderPerson();
    this.regions.newPanel.hidden = !this.composingNew;
  }

  /**
   * The region above the columns: the permission block, or the Disconnected banner, or nothing.
   * Built from `stateBlock.ts`, the one vocabulary — this pane used to draw neither.
   */
  private renderState(): void {
    const region = this.regions.state;
    if (!region) return;
    region.textContent = '';
    region.hidden = this.link === 'live';
    if (this.link === 'permission') {
      region.appendChild(
        stateBlock({
          kind: 'permission',
          headline: 'Sidekick can’t read messages on this phone',
          body:
            this.permissionReason ??
            'The phone has not allowed Sidekick to read or send SMS. Allow SMS for Sidekick in the phone’s app settings.',
        }),
      );
    } else if (this.link === 'disconnected') {
      region.appendChild(disconnectedBanner('Conversations are shown', this.freshAtMs));
    }
  }

  // ---- Column one: the conversations -------------------------------------------------------------

  /**
   * The design's filter strip, with the tabs this wire can actually answer.
   *
   * The canvas draws **All / SMS / Chat**. Neither of the last two is serveable and the reasons are
   * different, which is why both are refused rather than one being faked:
   *
   *  - **SMS** would need a kind per *thread*. `sms.threads` carries `threadId`, `addresses`,
   *    `snippet`, `dateMs`, `unread`, `messageCount` and `contactName` — and no kind. `kind` exists
   *    only per **message** (`sms.messages`), so answering that tab would mean opening all fifty
   *    conversations in order to label the list.
   *  - **Chat** means RCS. This app does not implement RCS, there is no verb for it anywhere in
   *    `docs/protocol.md`, and a tab that silently means "SMS again" is worse than no tab.
   *
   * `unread` **is** on every thread row, so *Unread* is a real filter over data already in hand,
   * and on this phone it is the one a person with 586 of them actually wants. Same strip as the
   * design; different labels, because these are the ones that can be true. The Calls pane set the
   * precedent — its strip is All / Missed / Contacts, not the canvas's literal three.
   */
  private renderTabs(): void {
    this.regions.tabs.textContent = '';
    for (const spec of SMS_TABS) {
      const count = filterThreads(this.threads, spec.id).length;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `sms-tab${spec.id === this.tab ? ' on' : ''}`;
      tab.dataset.tab = spec.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(spec.id === this.tab));
      tab.textContent = spec.label;
      // The count rides the tab only when it is non-zero and not the total — the rule the sidebar
      // badge and the Calls strip already follow. A tab reading "Unread 0" is a number nobody
      // needs, and "All 50" beside a list of fifty is the list counting itself.
      if (spec.id !== 'all' && count > 0) {
        const badge = document.createElement('span');
        badge.className = 'sms-tab-count mono';
        badge.textContent = String(count);
        tab.appendChild(badge);
      }
      tab.addEventListener('click', () => {
        if (this.tab === spec.id) return;
        this.tab = spec.id;
        this.render();
      });
      this.regions.tabs.appendChild(tab);
    }
  }

  private renderList(): void {
    const list = this.regions.list;
    list.textContent = '';

    if (this.regions.threadsFoot) this.regions.threadsFoot.textContent = '';
    if (!this.loaded) {
      if (this.threadsFailure && this.link !== 'disconnected') {
        const f = this.threadsFailure;
        this.note.textContent = f.fixHint ? `${f.reason} ${f.fixHint}` : f.reason;
        list.appendChild(this.threadsRetry());
        return;
      }
      this.note.textContent =
        this.link === 'disconnected'
          ? 'Connect your phone to read its conversations.'
          : 'Reading the phone’s conversations…';
      return;
    }
    if (this.threads.length === 0) {
      this.note.textContent = 'There are no conversations on the phone.';
      return;
    }

    const rows = filterThreads(this.threads, this.tab);
    if (rows.length === 0) {
      // A filter matching nothing is not the same as nothing being there — the distinction the
      // Calls and Notifications panes already draw, in the same shape of words.
      this.note.textContent = 'No unread conversations.';
      return;
    }

    /*
     * **And nothing else.** This line used to read:
     *
     *   "50 conversations, 2 showing a contact name, 586 unread. Older conversations are not shown
     *    yet."
     *
     * Every clause of that is a fact about *our implementation*: how many rows one page happens to
     * hold, how well contact resolution is working, and that a pager exists. The denominator rule
     * in `CLAUDE.md` is about **logs and evidence**, where a count with no scale is not evidence —
     * it was never a licence to put the instrument's readout on screen. A person opening Messages
     * wants their conversations; the unread counts are already on the rows that have them, and the
     * design has no such line at all.
     *
     * The three states above are kept, because each is about *the user's phone* rather than about
     * us: still reading, genuinely empty, filtered to nothing.
     */
    this.note.textContent = '';

    for (const thread of rows) list.appendChild(this.threadRow(thread));
    if (this.regions.threadsFoot) {
      const count = this.threads.length;
      this.regions.threadsFoot.textContent = this.threadsHasMore
        ? `${count} loaded · newest first · more on the phone`
        : `${count} ${count === 1 ? 'thread' : 'threads'} · newest first`;
    }

    if (this.threadsHasMore && this.tab === 'all') {
      const older = document.createElement('button');
      older.type = 'button';
      older.className = 'sms-older';
      older.id = 'sms-older-threads';
      older.textContent = 'Older conversations';
      older.addEventListener('click', () => void this.loadOlderThreads());
      list.appendChild(older);
    }
  }

  private threadRow(thread: SmsThreadRow): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    const open = thread.threadId === this.openThreadId;
    row.className = `sms-thread${thread.unread > 0 ? ' unread' : ''}${open ? ' on' : ''}`;
    row.dataset.threadId = thread.threadId;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(open));

    row.appendChild(smsDisc(thread, 'sm'));

    const lines = document.createElement('span');
    lines.className = 'sms-lines';

    const who = document.createElement('span');
    who.className = 'sms-who';
    // The name when contacts can supply one, the number when it cannot, and never blank. That is
    // step 59's whole expectation, and the fallback chain is written out rather than defaulted so
    // an empty `addresses` still produces words.
    who.textContent = threadWho(thread);

    /*
     * The preview, which **has been on the wire since Phase 4 and had never once been visible**.
     *
     * `sms.threads` sends `snippet` and this pane has always drawn it. It measured `height: 0` on
     * every one of fifty rows, each carrying real text: the row was a `<button>` with
     * `display: flex; flex-direction: column`, a button does not grow to its flex content, and the
     * deficit came out of the only shrinkable child — this one. Defect 93. The row carries the
     * design's explicit 60px now, so nothing has to grow.
     */
    const preview = document.createElement('span');
    preview.className = 'sms-preview';
    preview.textContent = thread.snippet || 'No preview';

    lines.append(who, preview);
    row.appendChild(lines);

    const meta = document.createElement('span');
    meta.className = 'sms-thread-meta';
    const when = document.createElement('span');
    when.className = 'sms-when mono';
    when.textContent = timeOfSms(thread.dateMs);
    meta.appendChild(when);

    if (thread.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'sms-unread mono';
      badge.textContent = String(thread.unread);
      // Part of the accessible name, not only a coloured pill — defect 26's rule.
      const spoken = document.createElement('span');
      spoken.className = 'visually-hidden';
      spoken.textContent = ` ${thread.unread} unread`;
      badge.append(spoken);
      meta.appendChild(badge);
    }
    row.appendChild(meta);

    row.addEventListener('click', () => void this.openThread(thread.threadId));
    return row;
  }

  // ---- Column two: the conversation --------------------------------------------------------------

  private renderChat(): void {
    const { chatHead, chatBody, composer } = this.regions;
    chatHead.textContent = '';
    chatBody.textContent = '';
    composer.textContent = '';

    const thread = this.openThreadRow();
    if (!thread) {
      // The canvas draws no empty chat, because its artboard always has one open. This is the
      // pane's resting state on first open and it is real, so it is drawn rather than left blank.
      chatBody.appendChild(
        stateBlock({
          kind: 'empty',
          icon: 'messages',
          headline: 'Pick a conversation',
          body: 'Choose one on the left to read it and reply from this Mac.',
        }),
      );
      composer.hidden = true;
      return;
    }
    composer.hidden = false;

    chatHead.appendChild(smsDisc(thread, 'md'));
    const who = document.createElement('div');
    who.className = 'sms-chat-who';
    who.appendChild(smsLine('sms-chat-name', threadWho(thread)));
    const number = thread.addresses[0];
    // Only when it is not already the name. A thread whose contact never resolved would otherwise
    // print the same number twice, one line above the other. The kind is the latest loaded
    // message's — `sms.threads` carries none per thread (see [renderTabs]).
    const latest = this.messages[this.messages.length - 1];
    const sub = [number && number !== threadWho(thread) ? number : null, latest?.kind ? latest.kind.toUpperCase() : null]
      .filter((part): part is string => !!part)
      .join(' · ');
    if (sub) who.appendChild(smsLine('sms-chat-number', sub));
    chatHead.appendChild(who);

    if (this.messagesHasMore) {
      const older = document.createElement('button');
      older.type = 'button';
      older.className = 'sms-older';
      older.textContent = 'Older messages';
      older.addEventListener('click', () => void this.loadOlder());
      chatBody.appendChild(older);
    }
    for (const item of withDaySeparators(this.messages)) {
      chatBody.appendChild(
        item.kind === 'day' ? smsLine('sms-day', item.label) : this.bubble(item.message, thread),
      );
    }
    // Newest at the bottom, and that is where a conversation is read from. Set again after layout:
    // on first open the column has not been measured yet, and the transcript opened mid-thread.
    chatBody.scrollTop = chatBody.scrollHeight;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => (chatBody.scrollTop = chatBody.scrollHeight));
    }

    composer.appendChild(this.composerFor(thread));
  }

  /**
   * One message, as frame `32:4382` draws it: a **labelled transcript block**, not a bubble. The
   * handoff is explicit — *"deliberately not iMessage: no tails, no blue, sender named on every
   * block, mono timestamps"*. The class stays `sms-bubble` because that is what the tests and the
   * accessibility probes find it by.
   *
   * No *Sent* suffix on an outbound block: the frame draws one, and the wire carries no per-message
   * send state, so it would be a claim made on optimism — the one thing the handoff says never to do.
   */
  private bubble(message: SmsMessageRow, thread: SmsThreadRow): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `sms-bubble ${message.inbound ? 'inbound' : 'outbound'}`;

    const head = document.createElement('div');
    head.className = 'sms-bubble-head';
    head.appendChild(smsLine('sms-bubble-from', message.inbound ? threadWho(thread) : 'You'));
    head.appendChild(smsLine('sms-bubble-when mono', timeOfSms(message.dateMs)));
    wrap.appendChild(head);

    if (message.body) wrap.appendChild(smsLine('sms-bubble-text', message.body));

    if (message.hasAttachments) {
      /*
       * A marker, and deliberately **not** the design's attachment card.
       *
       * The canvas draws a card with a file name and a size — `Q2_review.pptx`, `12.4 MB`. This
       * wire carries `hasAttachments: true` and nothing else: no name, no size, no type, and no
       * verb that would fetch one. Drawing the card would mean inventing both values.
       *
       * It is not silently omitted either. A text-only rendering of an MMS presents a fragment as
       * the whole message; saying an attachment is here and not fetched is the honest version.
       */
      const marker = document.createElement('div');
      marker.className = 'sms-attachment';
      const glyph = document.createElement('span');
      glyph.className = 'sms-attachment-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.appendChild(iconSvg('doc', 14));
      marker.appendChild(glyph);
      marker.appendChild(
        smsLine('sms-attachment-text', 'Attachment — on the phone; this Mac cannot fetch it yet.'),
      );
      wrap.appendChild(marker);
    }

    if (!message.body && !message.hasAttachments) {
      wrap.appendChild(smsLine('sms-bubble-text is-muted', 'Empty message'));
    }
    return wrap;
  }

  private composerFor(thread: SmsThreadRow): HTMLElement {
    const threadId = thread.threadId;
    const outer = document.createElement('div');
    outer.className = 'sms-composer-wrap';
    const wrap = document.createElement('div');
    wrap.className = 'sms-composer-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'sms-composer-input';
    input.placeholder = `Message ${threadWho(thread)}`;
    input.setAttribute('aria-label', `Message ${threadWho(thread)}`);
    input.value = this.drafts.get(threadId) ?? '';
    input.addEventListener('input', () => this.drafts.set(threadId, input.value));

    const send = document.createElement('button');
    send.type = 'button';
    send.id = 'sms-send';
    send.className = 'button primary-action sms-send';
    send.textContent = 'Send';

    // The Disconnected component's *blocked action*: the control stays where it is, says why it
    // will not work, and nothing typed into it is queued for later.
    const offline = this.link !== 'live';
    input.disabled = offline;
    send.disabled = offline;

    const submit = async (): Promise<void> => {
      const body = input.value.trim();
      if (body.length === 0) {
        this.showNotice('An empty message was not sent.');
        return;
      }
      send.disabled = true;
      input.disabled = true;
      // Note what is *not* passed: no recipient. This pane cannot name one. See the file comment.
      const result = await this.bridge
        .smsSend(threadId, body)
        .catch((error): { ok: boolean; reason?: string; fixHint?: string } => ({
          ok: false,
          reason: `The Mac could not reach its own SMS channel (${String(error)}).`,
        }));
      send.disabled = false;
      input.disabled = false;
      if (result.ok) {
        this.drafts.delete(threadId);
        this.sendFailures.delete(threadId);
        input.value = '';
        this.showNotice('Sent.');
        // Defect 39. This used to re-read the thread here — about 30 ms after the phone reported
        // the send, and before the provider had written the row — so the pane redrew without the
        // message it had just sent and nothing appended it afterwards. The message now arrives as
        // `sms.sent` and is appended by the same handler that appends an inbound one. Waiting
        // longer before re-reading was the tempting fix and is rejected: a timer substitutes a
        // plausible value for a known one, and the phone knows when its own write landed.
      } else {
        this.sendFailures.set(threadId, {
          reason: result.reason ?? 'The phone did not send the message.',
          hint: result.fixHint,
        });
        this.drafts.set(threadId, input.value);
        this.render();
      }
    };

    send.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
    });

    wrap.append(input, send);
    const failure = this.sendFailures.get(threadId);
    if (failure && !offline) {
      outer.appendChild(
        stateBlock({
          kind: 'error',
          compact: true,
          headline: 'Not sent',
          body: `${failure.reason}${failure.hint ? ` ${failure.hint}` : ''} Nothing was queued — the message is still in the box.`,
          action: { label: 'Try again', icon: 'refresh', run: () => void submit() },
        }),
      );
    }
    outer.appendChild(wrap);
    outer.appendChild(
      smsLine(
        'sms-composer-caption',
        offline ? 'Your phone is not connected, so nothing can be sent. Nothing typed here is queued.' : SMS_COMPOSER_CAPTION,
      ),
    );
    return outer;
  }

  // ---- Column three: the person ------------------------------------------------------------------

  /**
   * The design's third column: who this conversation is with.
   *
   * It held the **contacts directory** until 2026-09-05 — a different feature standing in the one
   * place the canvas reserves for the open thread. The directory moved into the New conversation
   * panel, where searching a person by name is what you are actually doing.
   *
   * Five of the design's controls are not drawn, each for its own reason, checked against
   * `docs/protocol.md` rather than recalled:
   *
   * | Design draws | Verb it would need | Verdict |
   * |---|---|---|
   * | phone call | `call.dial` | **exists**, and is on the Calls pane. A second entry point that silently changes screens is worse than the one that says where it goes |
   * | video call | none | removed |
   * | Block contact | none — and `BlockedNumberContract` is restricted to the default dialer or SMS app, which this is not and will not be | removed |
   * | Shared media | none — there is no MMS-parts verb on this wire at all | removed |
   * | Mute notifications | none — the phone does not tell the Mac what is muted (the Notifications pane already says so) | removed |
   *
   * What is left is what the wire holds: who, their number, and how much of the conversation the
   * phone has.
   */
  private renderPerson(): void {
    const person = this.regions.person;
    person.textContent = '';
    const thread = this.openThreadRow();
    if (!thread) {
      person.appendChild(
        stateBlock({
          kind: 'empty',
          compact: true,
          icon: 'messages',
          headline: 'No conversation open',
          body: 'Open a conversation to see who it is with.',
        }),
      );
      return;
    }

    const head = document.createElement('div');
    head.className = 'sms-person-head';
    head.appendChild(smsDisc(thread, 'lg'));
    head.appendChild(smsLine('sms-person-name', threadWho(thread)));
    const number = thread.addresses[0];
    if (number && number !== threadWho(thread)) {
      head.appendChild(smsLine('sms-person-number mono', number));
    }
    person.appendChild(head);

    // One action, where the frame draws two. *Open thread on phone* has no verb on this wire — it
    // is not drawn rather than drawn dead (departure row in docs/design-departures.md).
    const callNumber = this.regions.callNumber;
    if (number && callNumber && /\d/.test(number)) {
      const actions = document.createElement('div');
      actions.className = 'sms-person-actions';
      const call = document.createElement('button');
      call.type = 'button';
      call.className = 'button sms-person-action';
      call.id = 'sms-call-number';
      call.title = 'Puts this number in the dialler on the Calls screen. Nothing is dialled until you confirm there.';
      // `calls` is the handset (SF `phone`); the icon set's `phone` key is the *device*.
      const glyph = iconSvg('calls', 14);
      glyph.setAttribute('aria-hidden', 'true');
      call.append(glyph, document.createTextNode('Call this number'));
      call.addEventListener('click', () => callNumber(number));
      actions.appendChild(call);
      person.appendChild(actions);
    }

    const facts = document.createElement('div');
    facts.className = 'sms-person-facts';
    for (const [label, value] of personFacts(thread)) {
      facts.appendChild(smsLine('sms-person-fact-label', label));
      facts.appendChild(smsLine('sms-person-fact-value', value));
    }
    person.appendChild(facts);
    const spacer = document.createElement('div');
    spacer.className = 'sms-person-spacer';
    person.appendChild(spacer);
    person.appendChild(smsLine('sms-person-refusal', SMS_PERSON_REFUSAL));
  }

  /** The open thread's row, or null. `openThread` is the verb; this is the noun. */
  private openThreadRow(): SmsThreadRow | null {
    if (!this.openThreadId) return null;
    return this.threads.find((one) => one.threadId === this.openThreadId) ?? null;
  }

  // ---- New conversation ---------------------------------------------------------------------------

  /**
   * Defect 30 — the surface that can name a recipient.
   *
   * The pane could reply into a thread the phone already knew about and could not address a number
   * that had none, so there was no path to a first message. `docs/protocol.md` has specified the
   * shape the whole time (`{"addresses":[…],"body":"…"}` with no `threadId`) and the phone has
   * always implemented it; what was missing was here.
   *
   * On success the pane opens **the thread the phone names**, not one it assumes it created: a
   * first message to a number that already has a thread is merged into that thread by the provider.
   *
   * **Wired once, from static markup**, rather than rebuilt on every render. The panel now holds the
   * contacts directory beside it, and a directory that is torn down and re-created on each keystroke
   * would lose its scroll position and its in-flight search.
   */
  private bindNewConversation(): void {
    const open = this.regions.newButton;
    const cancel = this.regions.newCancel;
    const to = this.regions.newTo;
    const body = this.regions.newBody;
    const send = this.regions.newSend;

    /*
     * Opening and closing the panel, and the three things a surface that takes over the window
     * owes that this one did not have. `scripts/shell-parity-sweep.mjs` read it as
     * `{ role: null, modal: null, label: null }` beside the palette's
     * `{ role: 'dialog', modal: 'true', label: 'Command palette' }` — the app had one modal done
     * properly and one done by hiding a div, and nothing in the build could tell them apart.
     *
     *  - **It says what it is.** Without `role="dialog"` a screen reader announces a group of
     *    fields appearing from nowhere, with the pane it covers still in the reading order.
     *  - **Escape closes it.** Every other dismissable surface in this app closes on Escape, so a
     *    person who has learned that will press it here and have nothing happen.
     *  - **Focus goes back where it came from.** Cancelling used to leave focus on a button inside
     *    a `hidden` subtree, which drops it to the document — the next Tab starts from the top of
     *    the window rather than from the control that opened the panel.
     */
    const closeNew = (): void => {
      if (!this.composingNew) return;
      this.composingNew = false;
      this.render();
      open.focus();
    };

    open.addEventListener('click', () => {
      this.composingNew = true;
      this.render();
      to.focus();
    });
    cancel.addEventListener('click', closeNew);
    this.regions.newPanel.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Escape') return;
      // Stopped here so a palette or a pane listening further up does not also act on the same
      // press — one Escape, one dismissal, which is the behaviour a person is expecting.
      event.stopPropagation();
      closeNew();
    });

    const submit = async (): Promise<void> => {
      send.disabled = true;
      to.disabled = true;
      body.disabled = true;
      const sentTo = to.value.trim();
      const result = await this.bridge
        .smsSendNew([sentTo], body.value)
        .catch((error): { ok: boolean; reason?: string; fixHint?: string; threadId?: string } => ({
          ok: false,
          reason: `The Mac could not reach its own SMS channel (${String(error)}).`,
        }));
      send.disabled = false;
      to.disabled = false;
      body.disabled = false;
      if (!result.ok) {
        this.showNotice(result.reason ?? 'The message was not sent.', result.fixHint);
        return;
      }
      // Set before the first await below: the `sms.sent` naming the new thread can arrive while the
      // list is still loading, and a marker set after that await would miss it.
      this.pendingNew = result.threadId ? null : { digits: smsDigits(sentTo), atMs: Date.now() };
      to.value = '';
      body.value = '';
      this.composingNew = false;
      this.showNotice('Sent.');
      await this.loadThreads();
      // The phone's threadId, not an assumption. A number that already had a thread is merged into
      // it by the provider, and opening a thread we invented would show an empty pane.
      if (result.threadId) await this.openThread(result.threadId);
      else this.render();
    };

    send.addEventListener('click', () => void submit());
    body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
    });
  }

  /** Asks the phone for the list again — the way back from a refusal that is not a reconnect. */
  private threadsRetry(): HTMLElement {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button sms-threads-retry';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => void this.loadThreads());
    return retry;
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

interface SmsPendingNew {
  /** The number as the person typed it, digits only. */
  digits: string;
  atMs: number;
}

/**
 * How long after a thread-less ack the pane will adopt the thread an `sms.sent` names. Step 71
 * measured the provider's write at 699 ms and 1,140 ms; 30 s is generous for a slow phone and short
 * enough that a message the handset sends later to the same person cannot steer the pane.
 */
const SMS_NEW_THREAD_WINDOW_MS = 30_000;

function smsDigits(address: string): string {
  return address.replace(/\D/g, '');
}

/**
 * Is [message] the one the person just sent to a number with no thread? Outbound only, within the
 * window, and to the **same number**: equal digits, or — because the provider stores `+91…` where the
 * person typed ten digits — one a suffix of the other when both have at least 8 digits. A short code
 * matches only exactly, since `12345` is a suffix of a great many numbers.
 */
function smsNewThreadMatches(
  pending: SmsPendingNew | null,
  message: { address: string; inbound: boolean },
  nowMs: number,
): boolean {
  if (!pending || message.inbound) return false;
  if (nowMs < pending.atMs || nowMs - pending.atMs > SMS_NEW_THREAD_WINDOW_MS) return false;
  const got = smsDigits(message.address ?? '');
  const want = pending.digits;
  if (!got || !want) return false;
  if (got === want) return true;
  const [short, long] = got.length < want.length ? [got, want] : [want, got];
  return short.length >= 8 && long.endsWith(short);
}

/** Clock time for today, date for anything older. Same rule as the notification pane's. */
function timeOfSms(whenMs: number): string {
  if (!whenMs) return '';
  const at = new Date(whenMs);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  // 24-hour, as frame 32:4382 and the Overview's Recent rows print it — `09:31`, never `9:31 AM`.
  return sameDay
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// The testable seam: the pane is a plain script, so the pure rule is hung on globalThis and the
// test runs *this* function rather than a second copy that can drift. See CLAUDE.md.
(globalThis as unknown as { dedupeByThread: typeof dedupeByThread }).dedupeByThread = dedupeByThread;
(globalThis as unknown as { smsNewThreadMatches: typeof smsNewThreadMatches }).smsNewThreadMatches =
  smsNewThreadMatches;

// The pane's pure rules, for `sms.test.ts`. The test runs *these* functions rather than a second
// copy of the same idea — the rule this repo keeps paying for when it is skipped.
(globalThis as Record<string, unknown>).__smsRules = {
  filterThreads,
  threadWho,
  threadInitials,
  personFacts,
  withDaySeparators,
  dayLabelOf,
  SMS_TABS,
  SMS_PERSON_REFUSAL,
  SMS_COMPOSER_CAPTION,
  SMS_PANE_FOOT,
};

// The view class itself, for `smsView.test.ts`. `sms.ts` touches no DOM at module scope, so a test
// can import it and construct the class against `domDouble.testkit.ts` — which is what took this
// off `check-renderer-views.mjs`'s debt list, where its reason was "retro-fitting is Phase 6 work".
(globalThis as Record<string, unknown>).SmsView = SmsView;
