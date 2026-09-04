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

const PAGE = 50;

class SmsView {
  private threads: SmsThreadRow[] = [];
  private threadsHasMore = false;
  /** Defect 30: the pane is composing a message to a number that has no thread yet. */
  private composingNew = false;
  private newRecipient = '';
  private newBody = '';
  private loaded = false;

  private openThreadId: string | null = null;
  private messages: SmsMessageRow[] = [];
  private messagesHasMore = false;

  /** Compose text per thread, so switching conversations does not discard a half-typed message. */
  private drafts = new Map<string, string>();

  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly body: HTMLElement,
    private readonly notice: HTMLElement,
    private readonly bridge: SmsBridge,
  ) {
    bridge.onSmsReceived((event) => {
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

  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.threads = [];
      this.messages = [];
      this.openThreadId = null;
      this.loaded = false;
      this.render();
      return;
    }
    if (!this.loaded) void this.loadThreads();
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
      return;
    }
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
    this.body.textContent = '';
    if (this.composingNew) this.renderNewConversation();
    else if (this.openThreadId) this.renderThread();
    else this.renderList();
  }

  /**
   * Defect 30 — the surface that can name a recipient.
   *
   * The pane could reply into a thread the phone already knew about and could not address a number
   * that had none, so there was no path to a first message. `docs/protocol.md` has specified the
   * shape for this the whole time (`{"addresses":[…],"body":"…"}` with no `threadId`) and the phone
   * has always implemented it; what was missing was here.
   *
   * On success the pane opens **the thread the phone names**, not one it assumes it created: a
   * first message to a number that already has a thread is merged into that thread by the provider.
   */
  private renderNewConversation(): void {
    this.note.textContent = 'A new conversation. The phone checks the number before anything is sent.';

    const wrap = document.createElement('div');
    wrap.className = 'sms-compose sms-compose-new';

    const to = document.createElement('input');
    to.type = 'text';
    to.id = 'sms-new-to';
    to.placeholder = 'Phone number';
    to.value = this.newRecipient;
    to.addEventListener('input', () => {
      this.newRecipient = to.value;
    });

    const body = document.createElement('input');
    body.type = 'text';
    body.id = 'sms-new-body';
    body.placeholder = 'Message';
    body.value = this.newBody;
    body.addEventListener('input', () => {
      this.newBody = body.value;
    });

    const send = document.createElement('button');
    send.id = 'sms-new-send';
    send.textContent = 'Send';

    const cancel = document.createElement('button');
    cancel.className = 'secondary small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.composingNew = false;
      this.render();
    });

    const submit = async (): Promise<void> => {
      send.disabled = true;
      to.disabled = true;
      body.disabled = true;
      const result = await this.bridge
        .smsSendNew([this.newRecipient], this.newBody)
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
      this.newRecipient = '';
      this.newBody = '';
      this.composingNew = false;
      this.showNotice('Sent.');
      await this.loadThreads();
      // The phone's threadId, not an assumption. A number that already had a thread is merged
      // into it by the provider, and opening a thread we invented would show an empty pane.
      if (result.threadId) await this.openThread(result.threadId);
      else this.render();
    };

    send.addEventListener('click', () => void submit());
    body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
    });

    wrap.append(to, body, send, cancel);
    this.body.appendChild(wrap);
  }

  private renderList(): void {
    if (!this.loaded) {
      this.note.textContent = 'Reading the phone’s conversations…';
      return;
    }
    if (this.threads.length === 0) {
      this.note.textContent = 'There are no conversations on the phone.';
      return;
    }
    // Both numbers. A count of threads says nothing about whether contact resolution is working,
    // and the second number is what makes step 59's two states visible without opening anything.
    const named = this.threads.filter((t) => t.contactName).length;
    const unread = this.threads.reduce((sum, t) => sum + (t.unread || 0), 0);
    this.note.textContent =
      `${this.threads.length} conversation${this.threads.length === 1 ? '' : 's'}, ` +
      `${named} showing a contact name, ${unread} unread.` +
      (this.threadsHasMore ? ' Older conversations are not shown yet.' : '');

    const bar = document.createElement('div');
    bar.className = 'sms-bar';
    const compose = document.createElement('button');
    compose.className = 'secondary small';
    compose.id = 'sms-new';
    compose.textContent = 'New conversation';
    compose.addEventListener('click', () => {
      this.composingNew = true;
      this.render();
    });
    bar.appendChild(compose);
    this.body.appendChild(bar);

    const list = document.createElement('div');
    list.className = 'sms-list';
    for (const thread of this.threads) list.appendChild(this.threadRow(thread));
    this.body.appendChild(list);

    // Defect 32. The prose above used to end here and the reader had nowhere to go. A sentence
    // describing a limit is not the same as a control that lifts it.
    if (this.threadsHasMore) {
      const older = document.createElement('button');
      older.className = 'secondary small';
      older.id = 'sms-older-threads';
      older.textContent = 'Load older conversations';
      older.addEventListener('click', () => void this.loadOlderThreads());
      this.body.appendChild(older);
    }
  }

  private threadRow(thread: SmsThreadRow): HTMLElement {
    const row = document.createElement('button');
    row.className = thread.unread > 0 ? 'sms-thread unread' : 'sms-thread';
    row.dataset.threadId = thread.threadId;

    const head = document.createElement('div');
    head.className = 'sms-thread-head';
    const who = document.createElement('span');
    who.className = 'sms-who';
    // The name when contacts can supply one, the number when it cannot, and never blank. That is
    // step 59's whole expectation, and the fallback chain is written out rather than defaulted so
    // an empty `addresses` still produces words.
    who.textContent = thread.contactName ?? thread.addresses[0] ?? 'Unknown number';
    const when = document.createElement('span');
    when.className = 'muted small';
    when.textContent = timeOfSms(thread.dateMs);
    head.append(who, when);

    const snippet = document.createElement('div');
    snippet.className = 'sms-snippet muted small';
    snippet.textContent = thread.snippet || '(no preview)';

    row.append(head, snippet);
    if (thread.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'sms-unread';
      badge.textContent = String(thread.unread);
      // Part of the accessible name, not only a coloured pill — defect 26's rule.
      const spoken = document.createElement('span');
      spoken.className = 'visually-hidden';
      spoken.textContent = ` ${thread.unread} unread`;
      badge.append(spoken);
      head.append(badge);
    }
    row.addEventListener('click', () => void this.openThread(thread.threadId));
    return row;
  }

  private renderThread(): void {
    const thread = this.threads.find((t) => t.threadId === this.openThreadId);
    const who = thread?.contactName ?? thread?.addresses[0] ?? 'this conversation';
    this.note.textContent = thread
      ? `${who} — ${thread.messageCount} message${thread.messageCount === 1 ? '' : 's'} on the phone.`
      : who;

    const bar = document.createElement('div');
    bar.className = 'row';
    const back = document.createElement('button');
    back.className = 'secondary small';
    back.textContent = '← All conversations';
    back.addEventListener('click', () => {
      this.openThreadId = null;
      this.messages = [];
      this.render();
    });
    bar.appendChild(back);
    this.body.appendChild(bar);

    if (this.messagesHasMore) {
      const older = document.createElement('button');
      older.className = 'secondary small';
      older.textContent = 'Load older messages';
      older.addEventListener('click', () => void this.loadOlder());
      bar.appendChild(older);
    }

    const list = document.createElement('div');
    list.className = 'sms-messages';
    for (const message of this.messages) list.appendChild(this.messageRow(message));
    this.body.appendChild(list);
    // Newest at the bottom, and that is where a conversation is read from.
    list.scrollTop = list.scrollHeight;

    if (this.openThreadId) this.body.appendChild(this.composer(this.openThreadId));
  }

  private messageRow(message: SmsMessageRow): HTMLElement {
    const row = document.createElement('div');
    row.className = message.inbound ? 'sms-message inbound' : 'sms-message outbound';

    const body = document.createElement('div');
    body.className = 'sms-body';
    body.textContent = message.body || (message.hasAttachments ? '' : '(empty message)');
    row.appendChild(body);

    if (message.hasAttachments) {
      // Never silently omitted. A text-only rendering of an MMS presents a fragment as the whole
      // message; saying an attachment is here and not fetched is the honest version. Phase 5.
      const marker = document.createElement('div');
      marker.className = 'sms-attachment small';
      marker.textContent = '📎 This message has an attachment, which this Mac cannot show yet.';
      row.appendChild(marker);
    }

    const when = document.createElement('div');
    when.className = 'muted small sms-when';
    when.textContent = timeOfSms(message.dateMs) + (message.kind === 'mms' ? ' · MMS' : '');
    row.appendChild(when);
    return row;
  }

  private composer(threadId: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sms-compose';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Message';
    input.value = this.drafts.get(threadId) ?? '';
    input.addEventListener('input', () => this.drafts.set(threadId, input.value));

    const send = document.createElement('button');
    send.textContent = 'Send';

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
        input.value = '';
        this.showNotice('Sent.');
        // Defect 39. This used to re-read the thread here — about 30 ms after the phone reported
        // the send, and before the provider had written the row — so the pane redrew without the
        // message it had just sent and nothing appended it afterwards. The message now arrives as
        // `sms.sent` and is appended by the same handler that appends an inbound one. Waiting
        // longer before re-reading was the tempting fix and is rejected: a timer substitutes a
        // plausible value for a known one, and the phone knows when its own write landed.
      } else {
        this.showNotice(result.reason ?? 'The message was not sent.', result.fixHint);
      }
    };

    send.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
    });

    wrap.append(input, send);
    return wrap;
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

/** Clock time for today, date for anything older. Same rule as the notification pane's. */
function timeOfSms(whenMs: number): string {
  if (!whenMs) return '';
  const at = new Date(whenMs);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// The testable seam: the pane is a plain script, so the pure rule is hung on globalThis and the
// test runs *this* function rather than a second copy that can drift. See CLAUDE.md.
(globalThis as unknown as { dedupeByThread: typeof dedupeByThread }).dedupeByThread = dedupeByThread;

// The view class itself, for `smsView.test.ts`. `sms.ts` touches no DOM at module scope, so a test
// can import it and construct the class against `domDouble.testkit.ts` — which is what took this
// off `check-renderer-views.mjs`'s debt list, where its reason was "retro-fitting is Phase 6 work".
(globalThis as Record<string, unknown>).SmsView = SmsView;
