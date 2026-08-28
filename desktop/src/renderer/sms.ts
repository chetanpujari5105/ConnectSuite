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
  onSmsReceived(callback: (event: { threadId: string; message: SmsMessageRow }) => void): void;
}

const PAGE = 50;

class SmsView {
  private threads: SmsThreadRow[] = [];
  private threadsHasMore = false;
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

  private async loadThreads(): Promise<void> {
    const result = await this.bridge.smsThreads({ limit: PAGE }).catch(
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
    this.threads = result.data.threads;
    this.threadsHasMore = result.data.hasMore;
    this.render();
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
    if (this.openThreadId) this.renderThread();
    else this.renderList();
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
      (this.threadsHasMore ? ' Older conversations are not shown.' : '');

    const list = document.createElement('div');
    list.className = 'sms-list';
    for (const thread of this.threads) list.appendChild(this.threadRow(thread));
    this.body.appendChild(list);
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
        void this.openThread(threadId);
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
