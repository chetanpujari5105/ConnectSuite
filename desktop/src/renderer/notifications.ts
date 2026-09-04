/**
 * The notifications pane: a live list of the phone's shade, with inline reply where it exists.
 *
 * Rebuilt on 2026-08-29 in the design language of `design_handoff_connectsuite/README.md` §7. It is
 * the first pane to migrate, and it was chosen as the first because the feature under it is
 * finished and proven on hardware (steps 42-49b, 52) — so if the pane looks wrong, the cause is the
 * design system and not a missing feature. A pane whose feature works isolates the variable.
 *
 * Module-free on purpose, like renderer.ts and mirror.ts: the page is CSP-locked and loads plain
 * scripts, so a top-level `export` here would emit a CommonJS module the renderer cannot require.
 * The pure half lives in `notifyLabels.ts` and is tested there.
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
 *
 * ### The four states, which must not look alike
 *
 * The handoff has one pattern for nothing-here — icon, one bold line, one explanatory line. Using
 * it for all four is defect 24/26's shape: an empty list and an ungranted permission look
 * identical, and the user cannot tell which they are looking at. So:
 *
 *  - **Empty** ([emptyState]) — granted, connected, and the shade is genuinely empty. Neutral.
 *  - **Unbuilt** ([unbuiltState]) — the filter has no concept behind it on the wire. Neutral, at
 *    elevation 2 rather than 3, with the namespace named in mono. This is what `Muted` is.
 *  - **Unavailable** ([unavailableBanner]) — the phone has the feature and is not offering it.
 *    `--warning`, never `--destructive`: an ungranted permission is not a failure, and red in a
 *    connection product reads as "the link is down".
 *  - **Platform wall** — none on this pane. The Calls pane is where that one bites.
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

// Every string this pane puts in front of a person comes from notifyLabels.ts — `appLabelOf`,
// `tileInitialOf`, `appTileNameOf`, `replyPlaceholderOf`, `repliedNoticeOf`, `replyButtonLabelOf`,
// `fallbackChipOf`, `dismissButtonNameOf`, `noReplyActionNoteOf`, `sendButtonNameOf`. Both files
// are plain scripts in one global scope, so they are simply in scope here — no import, and no
// `declare` re-statement of a signature that could drift from the real one.
//
// The last three arrived late. They were composed inline in this file, correctly, and therefore
// outside `userVisibleStringsOf` — which is the enumeration defect 28's test asserts over. A
// string composed here rather than there is invisible to that test, so the guard had a hole in it
// even while nothing on screen was wrong. **Compose nothing in this file.** If a new sentence
// needs the app's name, it gets a function in notifyLabels.ts and a slot in the enumeration, and
// the count assertion moves.

type FilterId = 'all' | 'messages' | 'reply' | 'muted';

interface Filter {
  id: FilterId;
  label: string;
  /** Null for a filter with nothing behind it on the wire — it draws a count of nothing, not a 0. */
  match: ((one: Notif) => boolean) | null;
}

/**
 * The filter pills.
 *
 * The handoff's set is All / Chat / Messages / Muted. Two changes, both because the wire says so:
 *
 *  - **Chat and Messages are one filter, not two.** Android has a single `CATEGORY_MESSAGE`
 *    (`"msg"`), which is what `category` carries. Two pills over one category would have split the
 *    same rows arbitrarily, or left one permanently empty.
 *  - **Muted has nothing behind it.** There is no mute concept anywhere in the protocol — no field,
 *    no message, no capability. The handoff draws it as a designed empty state, and shipped that
 *    way it would be an empty state over nothing: state C rendering what is really state A. It is
 *    kept as a pill, because the roadmap is worth showing, and it renders [unbuiltState].
 *
 * `Can reply` replaces the second messages pill with something real, and it is the denominator the
 * pane already publishes in its note — the number that explains why most rows have no reply box.
 */
const FILTERS: Filter[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'messages', label: 'Messages', match: (one) => one.category === 'msg' },
  { id: 'reply', label: 'Can reply', match: (one) => one.canReply },
  { id: 'muted', label: 'Muted', match: null },
];

/**
 * The canned replies from the handoff. Text only — they fill the field rather than sending, so a
 * mis-tap is a word to delete and not a message in somebody else's conversation.
 */
const QUICK_REPLIES = ['On my way', 'In five minutes', 'Not today'];

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

  /** Which row the detail card is showing. The pane is a list plus one inspector. */
  private selected: string | null = null;

  private filter: FilterId = 'all';

  /** Null while the capability is advertised; the phone's own sentence while it is not. */
  private unavailableReason: string | null = null;

  private advertised = false;

  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly container: HTMLElement,
    private readonly notice: HTMLElement,
    private readonly filters: HTMLElement,
    private readonly detail: HTMLElement,
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
   * **Behaviour change, 2026-08-29, and it is deliberate.** This card used to be hidden outright
   * when the capability was absent, with the capability chip elsewhere carrying the explanation.
   * The reason was sound — an empty list and an ungranted permission look identical — but the fix
   * was to remove the pane rather than to distinguish the states, which left the user hunting for
   * a feature that had silently stopped existing.
   *
   * The pane now stays, and renders the phone's own `reason` verbatim in a `--warning` banner. The
   * verbatim part is load-bearing: defect 27 was the reason going stale the moment it was wrong,
   * and it now recomputes on the phone with the capability set that produced it. The Mac renders
   * it, and does not paraphrase, cache, or map it to a string table of its own.
   *
   * The card is still hidden when there is no phone at all — no link, no reason, nothing to say.
   */
  setAdvertised(advertised: boolean, reason?: string): void {
    this.advertised = advertised;
    this.unavailableReason = advertised ? null : (reason?.trim() || null);
    this.card.classList.toggle('hidden', !advertised && this.unavailableReason === null);
    if (!advertised) {
      this.list = [];
      this.selected = null;
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
   * Rebuilds the pane, keeping whatever the reader was looking at where it was.
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
    this.detail.textContent = '';
    this.filters.textContent = '';

    if (!this.advertised) {
      this.note.textContent = '';
      shell.setNotificationCount(0);
      if (this.unavailableReason !== null) {
        this.container.appendChild(this.unavailableBanner(this.unavailableReason));
      }
      return;
    }

    // A group summary is the platform's collapse header. It has no title and no text, so drawing
    // one produces an app name, a time, a Dismiss button and nothing else — `Shell 11:41 PM
    // Dismiss`, observed on One UI. A blank card in a list read every day is noise, so it is
    // hidden here rather than dropped on the phone, which reports the shade and lets the Mac
    // decide. See docs/protocol.md.
    const visible = this.list.filter((one) => !one.isGroupSummary);
    const hidden = this.list.length - visible.length;
    const headers = `${hidden} group ${hidden === 1 ? 'header' : 'headers'}`;

    // The sidebar badge counts what this pane counts — `visible`, not `this.list`. The design
    // draws a "3" here, and a badge that includes group summaries would send someone to a pane
    // showing a different number than the row that sent them.
    shell.setNotificationCount(visible.length);

    this.drawFilters(visible);

    const active = FILTERS.find((one) => one.id === this.filter);
    if (!active || active.match === null) {
      // Muted, and anything else that reaches this pane without a concept behind it.
      this.note.textContent = 'Muting is decided on the phone and is not sent to the Mac.';
      this.container.appendChild(
        this.unbuiltState(
          'Muted apps are not mirrored',
          'The phone does not tell the Mac which apps are muted, so this list cannot be built ' +
            'yet. Muted apps simply do not appear in the shade above.',
          'notif.posted — no mute field in this build',
        ),
      );
      this.detail.appendChild(this.detailPlaceholder('Nothing to inspect in this filter.'));
      this.restoreAnchor(anchor);
      return;
    }

    const shown = visible.filter(active.match);
    const replyable = visible.filter((one) => one.canReply).length;

    if (visible.length === 0) {
      // The denominator survives even here: "nothing to show" and "nothing at all" are different
      // facts, and the group-header count is what tells them apart.
      this.note.textContent =
        hidden > 0
          ? `Nothing to show — the shade holds only ${headers}.`
          : 'Nothing on the phone’s notification shade right now.';
      this.container.appendChild(
        this.emptyState(
          'The shade is empty',
          'Notifications posted on the phone appear here as they arrive.',
        ),
      );
      this.detail.appendChild(this.detailPlaceholder('Nothing to inspect yet.'));
      return;
    }

    // The denominator again: "12 notifications" says nothing about whether reply is working, and
    // "3 can be replied to" is the number that tells the user why most rows have no box. The
    // hidden count is here for the same reason one layer down: this number gets read against the
    // phone's `Replayed N active (M summaries)`, and one that cannot be reconciled makes a
    // working feature look broken.
    this.note.textContent =
      `${visible.length} showing, ${replyable} of them can be replied to from here.` +
      (hidden > 0 ? ` ${headers} hidden.` : '');

    if (shown.length === 0) {
      // An empty *filter* over a non-empty shade. A third fact again, and it says which filter.
      this.container.appendChild(
        this.emptyState(
          `Nothing matches “${active.label}”`,
          `The shade has ${visible.length} other ${visible.length === 1 ? 'notification' : 'notifications'}. ` +
            'Choose All to see them.',
        ),
      );
      this.detail.appendChild(this.detailPlaceholder('Nothing to inspect in this filter.'));
      return;
    }

    for (const one of shown) {
      this.container.appendChild(this.row(one));
    }

    const chosen = shown.find((one) => one.key === this.selected) ?? null;
    this.detail.appendChild(
      chosen
        ? this.detailCard(chosen)
        : this.detailPlaceholder('Choose a notification to read it and reply.'),
    );

    this.restoreAnchor(anchor);
    this.restoreFocus(focus);
  }

  private drawFilters(visible: Notif[]): void {
    for (const filter of FILTERS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill-tab';
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', String(this.filter === filter.id));
      if (this.filter === filter.id) pill.classList.add('selected');

      const label = document.createElement('span');
      label.textContent = filter.label;
      pill.appendChild(label);

      if (filter.match === null) {
        // No count, because there is no number — not a zero, which would read as "nothing muted"
        // and be a claim the wire cannot support. The dot says "this one is different" and the
        // pane says why once it is chosen.
        pill.classList.add('unbuilt');
        pill.title = 'Not in this build';
      } else {
        const count = visible.filter(filter.match).length;
        const badge = document.createElement('span');
        badge.className = 'pill-count mono';
        badge.textContent = String(count);
        pill.appendChild(badge);
      }

      pill.addEventListener('click', () => {
        this.filter = filter.id;
        this.render();
      });
      this.filters.appendChild(pill);
    }
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
    if (caret === null) return;
    const input = this.detail.querySelector<HTMLInputElement>('.notif-reply input');
    if (!input) return;
    input.focus();
    const at = Math.min(caret, input.value.length);
    input.setSelectionRange(at, at);
  }

  /**
   * The 34px tinted app tile — the single most likely place in this design for a package id to
   * reach a sentence, which is why every string in it comes from `notifyLabels.ts` and none is
   * composed here. See `notifyLabels.test.ts`.
   */
  private appTile(one: Notif): HTMLElement {
    const tile = document.createElement('span');
    tile.className = 'app-tile';
    tile.textContent = tileInitialOf(one);
    // The tile is a coloured square with one letter in it. Without a name it announces as "P", or
    // as nothing — defect 26's shape, where a chip's whole meaning was its background colour.
    tile.setAttribute('role', 'img');
    tile.setAttribute('aria-label', appTileNameOf(one));
    // A stable hue per app, derived from the label so the same app keeps its colour across
    // restarts. Decorative only: nothing is distinguished by hue alone.
    tile.style.setProperty('--tile-hue', String(hueOf(appLabelOf(one).label)));
    return tile;
  }

  /**
   * The app's name, rendered as a name or as a handle depending on which it actually is.
   *
   * `appName` arrives resolved by `AppLabels.of` on the phone, which honestly returns the package
   * name when an app has no launcher icon. That fallback is correct and must not be "fixed" here.
   * What the Mac owes it is the other half of the rule: a package id may appear as a machine
   * handle, never as the only thing a user reads. So a fallback is set in the mono face with a
   * "package id" chip beside it, and a resolved label is set in the UI face with nothing.
   */
  private appName(one: Notif): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'notif-app';
    const label = appLabelOf(one);

    const name = document.createElement('span');
    name.textContent = label.label;
    if (label.isPackageFallback) name.className = 'mono handle';
    wrap.appendChild(name);

    const chip = fallbackChipOf(one);
    if (chip) {
      const marker = document.createElement('span');
      marker.className = 'handle-chip';
      marker.textContent = chip;
      wrap.appendChild(marker);
    }
    return wrap;
  }

  private row(one: Notif): HTMLElement {
    const row = document.createElement('div');
    row.className = 'notif-row';
    if (one.ongoing) row.classList.add('ongoing');
    if (this.selected === one.key) row.classList.add('selected');
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    // The anchor [render] scrolls back to. Also what makes a row findable after a rebuild.
    row.dataset.key = one.key;

    const choose = (): void => {
      this.selected = one.key;
      this.render();
    };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });

    row.appendChild(this.appTile(one));

    const body = document.createElement('div');
    body.className = 'notif-body';

    const head = document.createElement('div');
    head.className = 'notif-head';
    head.appendChild(this.appName(one));
    const when = document.createElement('span');
    when.className = 'notif-when mono';
    when.textContent = timeOf(one.whenMs);
    head.appendChild(when);
    body.appendChild(head);

    if (one.title) {
      const title = document.createElement('div');
      title.className = 'notif-title';
      title.textContent = one.title;
      body.appendChild(title);
    }
    if (one.text) {
      const text = document.createElement('div');
      text.className = 'notif-text';
      text.textContent = one.text;
      body.appendChild(text);
    }
    row.appendChild(body);

    // Hover-revealed, per the handoff: opacity 0→1 and translateX(6px)→0 in 200ms. Also revealed
    // on keyboard focus within the row — a control that only exists under a pointer is a control
    // a keyboard user does not have.
    const quick = document.createElement('div');
    quick.className = 'row-actions';
    if (one.clearable) {
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'icon-button';
      dismiss.textContent = '✕';
      dismiss.setAttribute('aria-label', dismissButtonNameOf(one));
      dismiss.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.run(this.bridge.notifDismiss(one.key));
      });
      quick.appendChild(dismiss);
    }
    row.appendChild(quick);
    return row;
  }

  /** The pane's ONE primary card, at elevation 3. Nothing else on this pane may claim that weight. */
  private detailCard(one: Notif): HTMLElement {
    const card = document.createElement('div');
    card.className = 'detail-card';

    const head = document.createElement('div');
    head.className = 'detail-head';
    head.appendChild(this.appTile(one));
    const who = document.createElement('div');
    who.appendChild(this.appName(one));
    const when = document.createElement('div');
    when.className = 'detail-when mono';
    when.textContent = timeOf(one.whenMs);
    who.appendChild(when);
    head.appendChild(who);

    // The handoff puts an "UNREAD" pill here. There is no read/unread state anywhere in the
    // protocol, so drawing one would be a claim the wire cannot support — the same mistake as the
    // Muted filter, one card over. `ongoing` is real: the app pinned this notification and it
    // cannot be swiped away. That is worth a pill and this is the one it gets.
    if (one.ongoing) {
      const pill = document.createElement('span');
      pill.className = 'state-pill';
      pill.textContent = 'ONGOING';
      head.appendChild(pill);
    }
    card.appendChild(head);

    if (one.title) {
      const title = document.createElement('div');
      title.className = 'detail-title';
      title.textContent = one.title;
      card.appendChild(title);
    }

    if (one.text) {
      const quote = document.createElement('div');
      quote.className = 'detail-quote';
      quote.textContent = one.text;
      card.appendChild(quote);
    }
    if (one.subText) {
      const sub = document.createElement('div');
      sub.className = 'detail-sub';
      sub.textContent = one.subText;
      card.appendChild(sub);
    }

    if (one.canReply) {
      // The app's own word for its reply action — "Reply", "Respond", "Answer" — as the kicker
      // above the field, in the handoff's kicker slot. It is the seventh string in
      // `userVisibleStringsOf`, and it is drawn here so that every enumerated string is one the
      // pane actually renders: an enumeration containing a string nobody draws is coverage on
      // paper, and would let a real one be dropped without the count noticing.
      const kicker = document.createElement('p');
      kicker.className = 'detail-kicker';
      kicker.textContent = replyButtonLabelOf(one).toUpperCase();
      card.appendChild(kicker);
      card.appendChild(this.quickReplies(one));
      card.appendChild(this.replyBox(one));
    } else {
      // The other half of "a reply box is only drawn where a reply can be sent": say so, rather
      // than leaving a gap the user reads as a broken pane. Neutral, not a warning — an app that
      // did not build a reply action has not failed at anything.
      const why = document.createElement('p');
      why.className = 'detail-note';
      why.textContent = noReplyActionNoteOf(one);
      card.appendChild(why);
    }

    card.appendChild(this.actionGrid(one));
    return card;
  }

  private quickReplies(one: Notif): HTMLElement {
    const row = document.createElement('div');
    row.className = 'chip-row';
    for (const text of QUICK_REPLIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      // Fills the field rather than sending. A one-tap send into somebody else's conversation is
      // not recoverable, and the reply verb is the one whose failure another person sees.
      chip.addEventListener('click', () => {
        this.drafts.set(one.key, text);
        this.render();
        const input = this.detail.querySelector<HTMLInputElement>('.notif-reply input');
        input?.focus();
        input?.setSelectionRange(text.length, text.length);
      });
      row.appendChild(chip);
    }
    return row;
  }

  private actionGrid(one: Notif): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'action-grid';

    for (const action of one.actions) {
      // An action carrying a free-form input is a reply in disguise; the phone refuses it with a
      // sentence about sending an empty message, and drawing it as an ordinary button here would
      // invite exactly that. The reply field above is how those are reached.
      if (action.isReply) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action';
      button.textContent = action.title;
      button.addEventListener('click', () => {
        void this.run(this.bridge.notifAction(one.key, action.index));
      });
      grid.appendChild(button);
    }

    if (one.clearable) {
      // Coral, last, and the only red on this pane. Dismiss is the one destructive verb here, and
      // the handoff reserves `--destructive` for exactly that.
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'action destructive';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => {
        this.selected = null;
        void this.run(this.bridge.notifDismiss(one.key));
      });
      grid.appendChild(dismiss);
    }
    return grid;
  }

  private replyBox(one: Notif): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'notif-reply';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = replyPlaceholderOf(one);
    input.value = this.drafts.get(one.key) ?? '';
    input.addEventListener('input', () => this.drafts.set(one.key, input.value));

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'send';
    send.textContent = 'Send';
    send.setAttribute('aria-label', sendButtonNameOf(one));

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
        this.showNotice(repliedNoticeOf(one));
        this.render();
      } else {
        this.showNotice(result.reason ?? 'The reply was not sent.', result.fixHint);
      }
    };

    send.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit();
    });

    wrap.append(input, send);
    return wrap;
  }

  /** State C — granted, connected, genuinely nothing here. Neutral, and it says so out loud. */
  private emptyState(headline: string, explain: string): HTMLElement {
    return stateBlock('empty', headline, explain);
  }

  /**
   * State A — the feature has no concept behind it in this build.
   *
   * At elevation 2, never 3: one primary card per screen is the handoff's rule, and a pane with
   * nothing in it must not claim the screen's heaviest surface. The mono footer names the thing
   * that does not exist — a handle, with the sentence above it being what a person actually reads.
   */
  private unbuiltState(headline: string, explain: string, namespace: string): HTMLElement {
    const block = stateBlock('unbuilt', headline, explain);
    const handle = document.createElement('p');
    handle.className = 'state-handle mono';
    handle.textContent = namespace;
    block.appendChild(handle);
    return block;
  }

  /**
   * State B — the phone has the feature and is not offering it.
   *
   * `--warning`, never `--destructive`: a permission that has not been granted is not a failure,
   * and red in a connection product reads as "the link is down". The reason is the phone's own
   * sentence, rendered verbatim — see [setAdvertised].
   */
  private unavailableBanner(reason: string): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'state-banner';
    banner.setAttribute('role', 'status');

    const glyph = document.createElement('span');
    glyph.className = 'state-banner-glyph';
    glyph.textContent = '!';
    glyph.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    const headline = document.createElement('div');
    headline.className = 'state-banner-title';
    headline.textContent = 'Notifications are not available right now';
    const why = document.createElement('div');
    why.className = 'state-banner-reason';
    why.textContent = reason;
    body.append(headline, why);

    banner.append(glyph, body);
    return banner;
  }

  private detailPlaceholder(text: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'detail-placeholder';
    wrap.textContent = text;
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

/** The shared skeleton of every designed nothing-here state: icon, one bold line, one explanation. */
function stateBlock(kind: string, headline: string, explain: string): HTMLElement {
  const block = document.createElement('div');
  block.className = `state-block state-${kind}`;
  const glyph = document.createElement('div');
  glyph.className = 'state-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const title = document.createElement('p');
  title.className = 'state-title';
  title.textContent = headline;
  const body = document.createElement('p');
  body.className = 'state-explain';
  body.textContent = explain;
  block.append(glyph, title, body);
  return block;
}

/**
 * A stable hue for an app tile, from its label.
 *
 * Decorative only. Nothing in this pane is distinguished by hue alone — the tile always carries an
 * accessible name and the row always carries the app's text — because a colour that is the sole
 * carrier of meaning is defect 26 exactly.
 */
function hueOf(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 360;
  }
  return hash;
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

// The view class, for `notificationsView.test.ts`. `notifications.ts` touches no DOM at module
// scope, so a test can import it and construct the class against `domDouble.testkit.ts` — which is
// what takes it off `check-renderer-views.mjs`'s debt list, where its reason was "Phase 4".
(globalThis as Record<string, unknown>).NotificationsView = NotificationsView;
