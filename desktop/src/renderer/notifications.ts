/**
 * The notifications pane: a live list of the phone's shade, with inline reply where it exists.
 *
 * Module-free on purpose, like renderer.ts and mirror.ts: the page is CSP-locked and loads plain
 * scripts, so a top-level `export` here would emit a CommonJS module the renderer cannot require.
 *
 * ### The rule this pane enforces
 *
 * **A reply box is only ever drawn where a reply can actually be sent.** Most notifications have
 * no inline reply — it exists only because the app that posted it built one, and there is no way
 * to synthesise it. `canReply` on the wire says so per notification, and a companion app that
 * shows a box anyway is lying to the user in the most annoying possible way: they type a sentence,
 * press send, and find out it was never possible. That check is made here, in the main process,
 * and on the phone. Three checks for one rule is not excessive for the one notification verb whose
 * failure is visible to somebody else.
 */

/** Mirrors `PhoneNotification` in shared/protocol.ts — this file cannot import it. */
interface NotifAction {
  index: number;
  title: string;
  isReply?: boolean;
}

interface Notif {
  key: string;
  package: string;
  appName: string;
  title?: string;
  text?: string;
  subText?: string;
  whenMs: number;
  category?: string;
  ongoing: boolean;
  clearable: boolean;
  groupKey?: string;
  isGroupSummary: boolean;
  canReply: boolean;
  replyLabel?: string;
  actions: NotifAction[];
}

interface NotifAck {
  ok: boolean;
  reason?: string;
  fixHint?: string;
}

interface NotifBridge {
  notifList(): Promise<Notif[]>;
  notifReply(key: string, text: string): Promise<NotifAck>;
  notifAction(key: string, index: number): Promise<NotifAck>;
  notifDismiss(key: string): Promise<NotifAck>;
  onNotifChanged(callback: (list: Notif[]) => void): void;
}

class NotificationsView {
  private list: Notif[] = [];

  /**
   * Reply text per notification key, kept across re-renders.
   *
   * The list re-renders on every event, and a notification that updates while someone is typing
   * would otherwise wipe what they had written. Keyed by notification rather than held on the
   * element, because the element is destroyed and rebuilt each time.
   */
  private drafts = new Map<string, string>();

  /** Which row has its reply box open. Only ever one — a shade is a list, not a form. */
  private replying: string | null = null;

  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly container: HTMLElement,
    private readonly notice: HTMLElement,
    private readonly bridge: NotifBridge,
  ) {
    bridge.onNotifChanged((list) => {
      this.list = list;
      this.render();
    });
  }

  /**
   * Called from every status update.
   *
   * The card is hidden outright rather than shown greyed. An empty list and an ungranted
   * permission look identical on screen, and the difference is the whole of what the user needs to
   * know — so when the capability is absent the card is gone and the capability chip explains why,
   * and when it is present the note below the heading covers the empty case.
   */
  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.list = [];
      this.replying = null;
      this.drafts.clear();
    }
    this.render();
  }

  /** Pulls the set the main process already holds, for a window that opened late. */
  async refresh(): Promise<void> {
    this.list = await this.bridge.notifList().catch(() => []);
    this.render();
  }

  /**
   * Rebuilds the list, keeping whatever the reader was looking at where it was.
   *
   * The rebuild itself is deliberate — the rows are cheap and a keyed diff would be more code than
   * this list is worth — but a naive rebuild makes the pane unusable, in two ways that compound:
   *
   *  1. Emptying the container resets `scrollTop` to 0, so every arriving notification throws the
   *     reader back to the top of the list.
   *  2. The list is newest-first, so an arrival *also* inserts a row above them. Even holding the
   *     pixel offset would slide the content by the height of the new row.
   *
   * So the anchor is a **row**, not a pixel offset: whichever row was at the top of the viewport
   * goes back to the top of the viewport, and rows appearing above it change nothing. Someone
   * reading the middle of the list keeps reading it while notifications arrive.
   *
   * Being scrolled to the very top is treated as a third state rather than as offset zero: there,
   * staying pinned is what the reader wants, because that is where new things appear.
   */
  private render(): void {
    const anchor = this.captureAnchor();
    const focus = this.captureFocus();

    this.container.textContent = '';
    // A group summary is the platform's collapse header. It has no title and no text, so drawing
    // one produces an app name, a time, a Dismiss button and nothing else — `Shell 11:41 PM
    // Dismiss`, observed on One UI. A blank card in a list read every day is noise, so it is
    // hidden here rather than dropped on the phone, which reports the shade and lets the Mac
    // decide. See docs/protocol.md.
    const visible = this.list.filter((one) => !one.isGroupSummary);
    const hidden = this.list.length - visible.length;
    const headers = `${hidden} group ${hidden === 1 ? 'header' : 'headers'}`;
    if (visible.length === 0) {
      this.note.textContent =
        hidden > 0
          ? `Nothing to show — the shade holds only ${headers}.`
          : 'Nothing on the phone’s notification shade right now.';
      return;
    }
    const replyable = visible.filter((one) => one.canReply).length;
    // The denominator again: "12 notifications" says nothing about whether reply is working, and
    // "3 can be replied to" is the number that tells the user why most rows have no box. The
    // hidden count is here for the same reason one layer down: this number gets read against the
    // phone's `Replayed N active (M summaries)`, and one that cannot be reconciled makes a
    // working feature look broken.
    this.note.textContent =
      `${visible.length} showing, ${replyable} of them can be replied to from here.` +
      (hidden > 0 ? ` ${headers} hidden.` : '');

    for (const one of visible) {
      this.container.appendChild(this.row(one));
    }

    this.restoreAnchor(anchor);
    this.restoreFocus(focus);
  }

  /**
   * Which row was at the top of the viewport, and how far above it the fold sat.
   *
   * Null means "pinned to the top", which is a state rather than a measurement — see [render].
   */
  private captureAnchor(): { key: string; offset: number } | null {
    if (this.container.scrollTop <= 0) return null;
    const scrollTop = this.container.scrollTop;
    for (const child of Array.from(this.container.children)) {
      const row = child as HTMLElement;
      if (row.offsetTop + row.offsetHeight > scrollTop) {
        const key = row.dataset.key;
        return key ? { key, offset: row.offsetTop - scrollTop } : null;
      }
    }
    return null;
  }

  private restoreAnchor(anchor: { key: string; offset: number } | null): void {
    if (!anchor) {
      this.container.scrollTop = 0;
      return;
    }
    const row = this.container.querySelector<HTMLElement>(
      `[data-key="${cssEscape(anchor.key)}"]`,
    );
    // The anchored row is gone — dismissed on the phone while it was being read. Leaving the
    // scroll where it was is the least surprising thing available: the rows around it are still
    // roughly there, and jumping to the top would be the very behaviour this exists to prevent.
    if (!row) return;
    this.container.scrollTop = row.offsetTop - anchor.offset;
  }

  /**
   * Whether the reply box had focus, and where the caret was.
   *
   * The same cause as the scroll jump and worth fixing in the same place: rebuilding destroys the
   * focused `<input>`, so someone typing a reply loses the caret on every arriving notification.
   * The draft text already survived — it is kept per key rather than on the element — but a
   * preserved draft you cannot keep typing into is not much of a rescue.
   */
  private captureFocus(): number | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return null;
    if (!active.closest('.notif-reply')) return null;
    return active.selectionStart ?? active.value.length;
  }

  private restoreFocus(caret: number | null): void {
    if (caret === null || this.replying === null) return;
    const input = this.container.querySelector<HTMLInputElement>('.notif-reply input');
    if (!input) return;
    input.focus();
    const at = Math.min(caret, input.value.length);
    input.setSelectionRange(at, at);
  }

  private row(one: Notif): HTMLElement {
    const row = document.createElement('div');
    row.className = one.ongoing ? 'notif-row ongoing' : 'notif-row';
    // The anchor [render] scrolls back to. Also what makes a row findable after a rebuild.
    row.dataset.key = one.key;

    const head = document.createElement('div');
    head.className = 'notif-head';
    const app = document.createElement('span');
    app.className = 'notif-app';
    app.textContent = one.appName;
    const when = document.createElement('span');
    when.className = 'notif-when muted small';
    when.textContent = timeOf(one.whenMs);
    head.append(app, when);

    if (one.title) {
      const title = document.createElement('div');
      title.className = 'notif-title';
      title.textContent = one.title;
      row.append(head, title);
    } else {
      row.append(head);
    }

    if (one.text) {
      const text = document.createElement('div');
      text.className = 'notif-text';
      text.textContent = one.text;
      row.appendChild(text);
    }

    row.appendChild(this.buttons(one));
    if (this.replying === one.key) row.appendChild(this.replyBox(one));
    return row;
  }

  private buttons(one: Notif): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'notif-actions';

    // The reply button exists only where a reply does. See the file comment.
    if (one.canReply) {
      const reply = document.createElement('button');
      reply.className = 'secondary small';
      reply.textContent = one.replyLabel ?? 'Reply';
      reply.addEventListener('click', () => {
        this.replying = this.replying === one.key ? null : one.key;
        this.render();
        if (this.replying) {
          const box = this.container.querySelector<HTMLInputElement>('.notif-reply input');
          box?.focus();
        }
      });
      bar.appendChild(reply);
    }

    for (const action of one.actions) {
      // An action carrying a free-form input is a reply in disguise; the phone refuses it with a
      // sentence about sending an empty message, and drawing it as an ordinary button here would
      // invite exactly that. The Reply button above is how those are reached.
      if (action.isReply) continue;
      const button = document.createElement('button');
      button.className = 'secondary small';
      button.textContent = action.title;
      button.addEventListener('click', () => {
        void this.run(this.bridge.notifAction(one.key, action.index));
      });
      bar.appendChild(button);
    }

    if (one.clearable) {
      const dismiss = document.createElement('button');
      dismiss.className = 'secondary small';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => {
        void this.run(this.bridge.notifDismiss(one.key));
      });
      bar.appendChild(dismiss);
    }
    return bar;
  }

  private replyBox(one: Notif): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'notif-reply';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Reply to ${one.appName}…`;
    input.value = this.drafts.get(one.key) ?? '';
    input.addEventListener('input', () => this.drafts.set(one.key, input.value));

    const send = document.createElement('button');
    send.textContent = 'Send';

    const submit = async (): Promise<void> => {
      const text = input.value.trim();
      // Refused here as well as in the main process and on the phone. An empty reply appears in
      // someone else's conversation and cannot be taken back, which puts it in the same class as
      // the SMS send rule: worth stopping at every layer that can see it.
      if (text.length === 0) {
        this.showNotice('An empty reply was not sent.');
        return;
      }
      send.disabled = true;
      input.disabled = true;
      const result = await this.bridge.notifReply(one.key, text);
      send.disabled = false;
      input.disabled = false;
      if (result.ok) {
        this.drafts.delete(one.key);
        this.replying = null;
        this.showNotice(`Replied to ${one.appName}.`);
        this.render();
      } else {
        this.showNotice(result.reason ?? 'The reply was not sent.', result.fixHint);
      }
    };

    send.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
      if (event.key === 'Escape') {
        this.replying = null;
        this.render();
      }
    });

    wrap.append(input, send);
    return wrap;
  }

  private async run(intent: Promise<NotifAck>): Promise<void> {
    const result = await intent.catch((error): NotifAck => ({
      ok: false,
      reason: `The Mac could not reach its own notification channel (${String(error)}).`,
    }));
    if (!result.ok) this.showNotice(result.reason ?? 'That did not work.', result.fixHint);
  }

  /** Same shape as the mirror's notice, and the same reason: a refusal must not be silent. */
  private showNotice(text: string, hint?: string): void {
    this.notice.hidden = false;
    this.notice.textContent = text;
    if (hint) {
      const line = document.createElement('div');
      line.className = 'hint';
      // Leading space so a read of `textContent` is two sentences rather than one run-together
      // string — the block layout swallows it. Same fix as defect 22's, same reason.
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

/**
 * Escapes a notification key for use inside an attribute selector.
 *
 * Keys are Android's own — `0|com.slack|1234|null|10123` — and the `|` characters are legal in an
 * attribute *value* but not in an unquoted selector. `CSS.escape` is the correct tool and exists
 * in every Chromium this app runs on; the fallback is there only so a stray environment without it
 * degrades to losing the scroll anchor rather than throwing inside a render.
 */
function cssEscape(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return escape ? escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** Clock time for today, date for anything older. A shade is read by "when", not by "how long ago". */
function timeOf(whenMs: number): string {
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
