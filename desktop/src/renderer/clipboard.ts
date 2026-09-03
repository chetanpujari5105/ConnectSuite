/**
 * The clipboard pane.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts, so a top-level
 * `export` here would emit a CommonJS module the renderer cannot require. The pure half hangs on
 * `globalThis` at the bottom for its test, which is the seam rule rather than an exception to it.
 *
 * ### The wall is standing copy, in every state
 *
 * Android refuses a clipboard read to any app that is not focused — measured on hardware, not
 * inherited (`docs/testing.md` → Slice 11) — so **the phone can only send its clipboard while
 * ConnectSuite is open on it.** That sentence is on the pane before anything is asked, not attached
 * to the first failure, for the same reason the Files pane carries the `Download` wall permanently:
 * a person should not learn the shape of a feature by tripping over it.
 *
 * It is not the `Download` case exactly — that one *cannot* be explained afterwards because a
 * refusal and a cancellation are the same `null`, while `PHONE_NOT_FOREGROUND` is unambiguous. The
 * copy is standing anyway, because being able to explain a surprise is not as good as not
 * surprising anyone.
 *
 * ### An arriving entry is already on the clipboard
 *
 * It used to wait for a click. That made the feature a list to operate rather than a clipboard, and
 * the point of it is that ⌘V works with nothing touched — so the main process applies what arrives
 * and this pane reports it, rather than offering it.
 *
 * `docs/protocol.md` permitted that reversal on one condition: **with an undo, not by removing the
 * confirmation.** So the clipboard that was overwritten is kept as a `displaced` row and Restore
 * puts it back. That row draws its **buttons and not its text** — it is the one entry here nobody
 * chose to put in the list, and on macOS it may be a password manager's clip. The concealed-type
 * check that tries to keep those out is in `main/clipboard.ts` and its measurement did not reach
 * the real case, which is exactly why the display rule does not depend on it.
 */

interface ClipEntryRow {
  kind: 'text' | 'empty' | 'sensitive' | 'displaced' | string;
  text?: string;
  /** The **sender's** clock. On a phone entry this is when the phone *read* it — see `ClipItem`. */
  atMs: number;
  source: 'phone' | 'mac';
  package?: string;
  appName?: string;
  /** This Mac's clock, for entries that arrived. The only timestamp this machine can vouch for. */
  receivedAtMs?: number;
  /** Whether it reached this Mac's pasteboard. `undefined` is *not asked*, which is not `false`. */
  applied?: boolean;
}

/** Which of the three filters is showing. See the markup for why it is not History / Favourites. */
type ClipTab = 'all' | 'phone' | 'mac';

/** One step of the sync timeline. Only facts this Mac holds become one. */
interface ClipStep {
  label: string;
  /** Absent when the fact is known and its time is not — see [clipTimeline]. */
  at?: number;
  /** Which machine's clock `at` came from, drawn beside it. Never mixed silently. */
  clock?: 'phone' | 'mac';
  tone: 'done' | 'refused' | 'unknown';
}

declare function openableUrl(text: string | undefined | null): string | null;

type ClipResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface ClipBridge {
  clipSend(): Promise<ClipResult<{ bytes: number }>>;
  clipClear(): Promise<ClipResult<{ cleared: number }>>;
  clipOpen(text: string): Promise<ClipResult<null>>;
  clipWatching(): Promise<ClipResult<{ watching: boolean }>>;
  clipSetWatching(on: boolean): Promise<ClipResult<{ watching: boolean }>>;
  clipRequest(): Promise<ClipResult<ClipEntryRow>>;
  clipHistory(): Promise<ClipResult<ClipEntryRow[]>>;
  clipUse(text: string): Promise<ClipResult<null>>;
  /** `applied` says whether it reached the pasteboard — a `sensitive` or `empty` entry does not. */
  onClipArrived(callback: (entry: ClipEntryRow & { applied?: boolean }) => void): void;
  onClipChanged(callback: () => void): void;
}

/**
 * What one row says, decided in one place so the test runs the same code the pane draws.
 *
 * The three kinds are three different sentences on purpose. **`sensitive` is not `empty`**: a
 * password manager's clip is *there*, and telling somebody their phone's clipboard is empty when it
 * is not is the kind of confident wrong answer this project keeps writing rules about. An unknown
 * kind from a later build is kept and labelled, never rendered as empty text.
 */
function clipRowText(entry: ClipEntryRow): { body: string; muted: boolean } {
  switch (entry.kind) {
    case 'text':
      return { body: entry.text ?? '', muted: false };
    case 'empty':
      return { body: 'The phone’s clipboard was empty.', muted: true };
    case 'sensitive':
      return {
        body: 'An app marked this as sensitive — a password manager, usually — so the phone did not send it.',
        muted: true,
      };
    case 'too_large':
      return { body: 'That entry is over the 64 KB limit, so nothing was sent or cut short.', muted: true };
    case 'displaced':
      // **The text is deliberately not here.** This is what this Mac's clipboard held before an
      // arriving entry replaced it — the only row in the list nobody chose to add — so it is
      // restorable without being readable. Rendering it would turn the undo into a place where a
      // password manager's clip gets drawn on screen.
      return { body: 'What was on this Mac’s clipboard before the entry above replaced it.', muted: true };
    default:
      return { body: `This Mac can’t show a “${entry.kind}” entry yet.`, muted: true };
  }
}

/** Where an entry came from, with the package-id rule applied: the label, never the raw id. */
function clipRowSource(entry: ClipEntryRow): string {
  if (entry.kind === 'displaced') return 'Replaced on this Mac';
  if (entry.source === 'mac') return 'This Mac';
  if (entry.appName) return `Phone · ${entry.appName}`;
  return 'Phone';
}

/**
 * The handoff's kind badge, over the kinds this wire actually carries.
 *
 * The design draws five: `URL`, `Aa`, `IMG`, `{}`, `FILE`. **Three of them cannot occur.**
 * `docs/protocol.md`: `clip.push` carries `kind` of `text`, `empty` or `sensitive`, and a `text`
 * body — there is no image, no file and no attachment in this namespace and nothing is planned. A
 * badge that can never be drawn is a promise in a legend.
 *
 * `{}` is cut for a different reason and it is the more interesting one: *code* is a **guess**.
 * Every heuristic for it — braces, semicolons, indentation — mislabels a shopping list with a
 * bracket in it, and a badge that is wrong some of the time is worse than a badge that is absent,
 * because nothing on screen says which of the two you are looking at. `URL` is not a guess:
 * [openableUrl] either parses the whole string as an http(s) URL or it does not.
 *
 * So the state kinds get badges of their own instead, which the design has no equivalent for
 * because the design has no notion of an entry that arrived and was not applied.
 */
function clipRowBadge(entry: ClipEntryRow): { text: string; tone: string } {
  switch (entry.kind) {
    case 'text':
      return openableUrl(entry.text) ? { text: 'URL', tone: 'url' } : { text: 'Aa', tone: 'text' };
    case 'empty':
      return { text: '—', tone: 'muted' };
    case 'sensitive':
      return { text: 'LOCK', tone: 'warn' };
    case 'displaced':
      return { text: 'UNDO', tone: 'undo' };
    case 'too_large':
      return { text: '64KB', tone: 'warn' };
    default:
      return { text: '?', tone: 'muted' };
  }
}

/** The detail column's *Type* row. The badge in words. */
function clipTypeLabel(entry: ClipEntryRow): string {
  switch (entry.kind) {
    case 'text':
      return openableUrl(entry.text) ? 'Link / URL' : 'Text';
    case 'empty':
      return 'Nothing to copy';
    case 'sensitive':
      return 'Marked sensitive by the app that copied it';
    case 'displaced':
      return 'Replaced clipboard, kept so you can put it back';
    case 'too_large':
      return 'Over the 64 KB limit';
    default:
      return entry.kind;
  }
}

/**
 * The design's **Sync timeline**, over the facts this Mac actually holds.
 *
 * The handoff draws three steps with three timestamps: *Copied on phone 09:42:03* → *Synced to
 * ConnectSuite 09:42:04* → *Available on Mac 09:42:04*. Two things in that are not available here,
 * and one of them is a claim rather than a gap.
 *
 * **"Copied on phone" is the wrong sentence, not a missing timestamp.** Android forbids a
 * background clipboard read — measured, `docs/testing.md` → Slice 11, 90 of 90 refused — so the
 * phone reads its clipboard when ConnectSuite comes to the front. `atMs` is therefore *when the
 * phone read it*, which may be an hour after somebody copied. Drawing it as "copied" would be a
 * true sentence about the wrong moment, which is exactly the shape defect 63 was: a claim nobody
 * verifying it would find false, because the mechanism it names is real and is not the one in
 * front of the reader. So the step says what happened, and the *whose clock* is drawn beside it.
 *
 * **What became of a Mac→phone entry is not kept here.** The `clip.push` ack says whether the phone
 * applied it, and this history does not store that — the Activity log does, as a distinct row for
 * each of the three outcomes. So a Mac entry gets one step and a line pointing there, rather than
 * an invented second step.
 *
 * A step with `tone: 'unknown'` is the one thing this function will draw without a time. Everything
 * else either has this Mac's clock behind it or is not drawn at all.
 */
function clipTimeline(entry: ClipEntryRow): ClipStep[] {
  if (entry.kind === 'displaced') {
    return [
      { label: 'Was on this Mac’s clipboard', at: entry.atMs, clock: 'mac', tone: 'done' },
      { label: 'Replaced by an entry from the phone', tone: 'refused' },
    ];
  }
  if (entry.source === 'mac') {
    return [
      { label: 'Copied on this Mac', at: entry.atMs, clock: 'mac', tone: 'done' },
      { label: 'Sent to the phone — what it did with it is in Activity', tone: 'unknown' },
    ];
  }
  const steps: ClipStep[] = [
    { label: 'The phone read its clipboard', at: entry.atMs, clock: 'phone', tone: 'done' },
  ];
  if (entry.receivedAtMs !== undefined) {
    steps.push({ label: 'Arrived on this Mac', at: entry.receivedAtMs, clock: 'mac', tone: 'done' });
  }
  // `undefined` is *nobody asked this question of this entry* — an older row from before the field
  // existed — and it is a different fact from `false`. Drawing them the same would be the
  // absence-as-a-negative failure in a timeline.
  if (entry.applied === true) {
    steps.push({ label: 'Put on this Mac’s clipboard', tone: 'done' });
  } else if (entry.applied === false) {
    steps.push({ label: 'Not put on this Mac’s clipboard', tone: 'refused' });
  } else {
    steps.push({ label: 'Whether it reached this Mac’s clipboard was not recorded', tone: 'unknown' });
  }
  return steps;
}

/** The rows one tab shows. `all` is every entry, in order, and is what the pane opens on. */
function filterClips(entries: ClipEntryRow[], tab: ClipTab): ClipEntryRow[] {
  if (tab === 'all') return entries;
  // A `displaced` entry is this Mac's own clipboard, whatever put it there, so it belongs to the
  // Mac column. Its `source` already says `mac`; this is a comment rather than a branch because
  // somebody will otherwise "fix" it into the phone tab on the grounds that a phone entry caused it.
  return entries.filter((entry) => entry.source === tab);
}

class ClipboardView {
  private entries: ClipEntryRow[] = [];
  private tab: ClipTab = 'all';

  /**
   * Which row the detail column is showing, identified by `atMs` + `kind` rather than by index.
   *
   * An index would follow the *position* through a prepend, so an arriving entry would silently
   * move the selection onto the row above the one somebody was reading. There is no id on the wire
   * — `docs/protocol.md` gives `clip.push` no identifier — so this is the nearest stable handle
   * there is, and when it stops matching anything the column falls back to the newest row rather
   * than going blank.
   */
  private selected: string | null = null;

  /** Generation counter for [refresh]; see its comment for the race it closes. */
  private refreshes = 0;

  constructor(
    private readonly bridge: ClipBridge,
    private readonly list: HTMLElement,
    private readonly wall: HTMLElement,
    private readonly phoneWall: HTMLElement,
    private readonly notice: HTMLElement,
    sendButton: HTMLButtonElement,
    requestButton: HTMLButtonElement,
    watchToggle: HTMLInputElement,
    private readonly tabs: HTMLElement,
    private readonly detail: HTMLElement,
    private readonly foot: HTMLElement,
    clearButton: HTMLButtonElement,
  ) {
    // **What you get, then the limit** — in that order, and in two blocks rather than one
    // paragraph, because they are two different kinds of statement. The first is what the feature
    // does. The second is a platform fact with an owner, and merging them let the limit read as
    // ours.
    this.wall.textContent =
      'Copy anything on this Mac and it goes to your phone on its own — the button is there if you ' +
      'want it, but you should not need it. Anything the phone sends lands on this Mac’s clipboard ' +
      'the moment it arrives, so ⌘V just works, and whatever the clipboard held is kept below so ' +
      'you can put it back.';

    // **Whose limit it is, said in the first clause.** The previous line was accurate and ownerless
    // — *"Android does not let any app read the clipboard in the background, so the phone sends
    // only while ConnectSuite is open"* — which reads, to somebody who has not measured it, exactly
    // like a feature nobody had got round to finishing. It is not: it was measured on hardware
    // (90 of 90 background reads refused, with our accessibility service bound and with it
    // disabled alike), it applies to every app on every Android phone, and there is no version of
    // ConnectSuite that fixes it.
    this.phoneWall.textContent =
      'The other direction is Android’s rule, not an unfinished feature. Android forbids every app ' +
      'from reading the clipboard while it is in the background — no Android app can do what an ' +
      'iPhone does here, and ConnectSuite is not an exception to it. So the phone can only send ' +
      'its clipboard while ConnectSuite is open on screen: copy on the phone, open ConnectSuite ' +
      'there, and it arrives.';

    // **Two clicks, like the dialler**, and for the same reason: there is no undo for this one.
    // The history is memory-only, so a cleared entry is gone from every machine that had it —
    // §6 of the clipboard proposal is what makes that true, and it is what makes a confirm
    // necessary rather than fussy.
    let armed = false;
    const disarm = () => {
      if (!armed) return;
      armed = false;
      clearButton.textContent = 'Clear all';
      clearButton.classList.remove('is-confirming');
    };
    clearButton.addEventListener('click', () => {
      if (this.entries.length === 0) {
        this.say('There is nothing in the list to clear.', false);
        return;
      }
      if (!armed) {
        armed = true;
        clearButton.textContent = `Clear ${this.entries.length}?`;
        clearButton.classList.add('is-confirming');
        return;
      }
      disarm();
      void this.run(
        () => this.bridge.clipClear(),
        (data) =>
          `Cleared ${data.cleared} entr${data.cleared === 1 ? 'y' : 'ies'}. Neither clipboard was ` +
          'touched — this was the list.',
      );
    });
    // Any other interaction withdraws the confirmation. Same rule as the dialler's.
    this.list.addEventListener('click', disarm);
    this.tabs.addEventListener('click', disarm);

    sendButton.addEventListener('click', () => {
      void this.run(() => this.bridge.clipSend(), (data) => `Sent ${data.bytes} bytes to the phone.`);
    });
    requestButton.addEventListener('click', () => {
      void this.run(
        () => this.bridge.clipRequest(),
        (entry) => {
          this.prepend(entry);
          return entry.kind === 'text'
            ? 'On this Mac’s clipboard now — ⌘V to paste.'
            : `${clipRowText(entry).body} Nothing was put on this Mac’s clipboard.`;
        },
      );
    });

    // The toggle reports the main process's state rather than its own checked attribute: the
    // watcher is started from a persisted preference at launch, and a checkbox that drew `checked`
    // from the HTML would show "on" for a session where it is off.
    void this.bridge.clipWatching().then((result) => {
      if (result.ok) watchToggle.checked = result.data.watching;
    });
    watchToggle.addEventListener('change', () => {
      void this.bridge.clipSetWatching(watchToggle.checked).then((result) => {
        if (!result.ok) return;
        watchToggle.checked = result.data.watching;
        this.say(
          result.data.watching
            ? 'Watching this Mac’s clipboard — copies go to the phone on their own.'
            : 'Stopped watching. Use the button to send a copy.',
          false,
        );
      });
    });

    // The watcher sends with nobody clicking anything, so without this the list sits at "Nothing
    // yet" over a history that has entries in it — which is what the pane probe found.
    this.bridge.onClipChanged(() => void this.refresh());
    this.renderTabs();

    this.bridge.onClipArrived((entry) => {
      // Prepend for immediacy, then reconcile — and the reconcile is not tidiness, it is the undo.
      //
      // The event carries the arriving entry and **not** the `displaced` entry created beside it in
      // the main process, so a pane that only prepended showed the new clip with no Restore row for
      // what it had just replaced. Measured on hardware, 2026-09-02: after an auto-apply the list
      // held the arrival and the *previous* displaced row, and the one belonging to that arrival
      // appeared only on the next refresh. The undo was missing at the one moment it exists for.
      this.prepend(entry);
      void this.refresh();
      // Says which of the two things happened rather than assuming the happy one. A `sensitive` or
      // `empty` entry arrives and is *not* applied, and a pane that announced "ready to paste" over
      // one would be telling somebody something false about their own clipboard — the same mistake
      // as collapsing `sensitive` into `empty`, one layer up.
      this.say(
        entry.applied
          ? 'On this Mac’s clipboard now — ⌘V to paste.'
          : `${clipRowText(entry).body} Nothing was put on this Mac’s clipboard.`,
        false,
      );
    });
    void this.refresh();
  }

  private async run<T>(call: () => Promise<ClipResult<T>>, onOk: (data: T) => string): Promise<void> {
    const result = await call();
    if (result.ok) {
      this.say(onOk(result.data), false);
      void this.refresh();
    } else {
      // The phone's own sentence, verbatim. `PHONE_NOT_FOREGROUND` arrives here — and the pane
      // stays alive, because there is no permission to go and grant.
      this.say([result.reason, result.fixHint].filter(Boolean).join(' '), true);
    }
  }

  private say(message: string, isProblem: boolean): void {
    this.notice.textContent = message;
    this.notice.hidden = message.length === 0;
    this.notice.classList.toggle('is-problem', isProblem);
  }

  private prepend(entry: ClipEntryRow): void {
    this.entries = [entry, ...this.entries.filter((held) => held.text !== entry.text)].slice(0, 20);
    this.draw();
  }

  /**
   * Reconciles from the main process, which holds the history this pane only mirrors.
   *
   * **Its concurrency is stated rather than only its type.** A route opening, a send, a request and
   * an arrival can all begin one of these, and the Files pane has already paid for exactly that: two
   * correct triggers a frame apart assembled a wrong picture out of legal states. Here a late reply
   * overwriting a newer one would resurrect a displaced row the person has already restored, so a
   * run that is no longer the newest discards its own result instead of drawing it.
   */
  private async refresh(): Promise<void> {
    const mine = ++this.refreshes;
    const result = await this.bridge.clipHistory();
    if (!result.ok || mine !== this.refreshes) return;
    this.entries = result.data;
    this.draw();
  }

  /** All / From phone / From this Mac — the design's strip, over the filters the data supports. */
  private renderTabs(): void {
    this.tabs.replaceChildren();
    const counts = {
      all: this.entries.length,
      phone: filterClips(this.entries, 'phone').length,
      mac: filterClips(this.entries, 'mac').length,
    };
    const labels: [ClipTab, string][] = [
      ['all', 'All'],
      ['phone', 'From phone'],
      ['mac', 'From this Mac'],
    ];
    for (const [id, label] of labels) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'clip-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      // The count is drawn beside every filter, including the one showing, because a filter with no
      // count is a control whose result you can only discover by pressing it — and because the
      // three of them together are the denominator for each one.
      tab.textContent = `${label} ${counts[id]}`;
      tab.addEventListener('click', () => {
        if (this.tab === id) return;
        this.tab = id;
        this.draw();
      });
      this.tabs.appendChild(tab);
    }
  }

  /** A stable-enough handle for one row. See [selected] for why it is not the index. */
  private static keyOf(entry: ClipEntryRow): string {
    return `${entry.kind}:${entry.atMs}:${entry.source}`;
  }

  private draw(): void {
    this.renderTabs();
    this.list.replaceChildren();
    const rows = filterClips(this.entries, this.tab);

    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'clip-empty';
      empty.textContent = 'Nothing yet. Copy something on either machine.';
      this.list.append(empty);
      this.foot.textContent = '';
      this.drawDetail(null);
      return;
    }
    if (rows.length === 0) {
      // Nothing *matching* is not nothing *recorded*, and the sentence names the filter so the way
      // out is obvious. The same distinction the Activity pane draws four ways between A3 and A4.
      const none = document.createElement('div');
      none.className = 'clip-empty';
      none.textContent =
        this.tab === 'phone'
          ? 'Nothing from the phone yet. Open ConnectSuite on it after copying — that is the only moment Android lets it look.'
          : 'Nothing copied on this Mac yet.';
      this.list.append(none);
    }

    const selectedRow =
      rows.find((entry) => ClipboardView.keyOf(entry) === this.selected) ?? rows[0] ?? null;

    for (const entry of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'clip-row';
      const key = ClipboardView.keyOf(entry);
      if (selectedRow && key === ClipboardView.keyOf(selectedRow)) row.classList.add('is-selected');
      row.addEventListener('click', () => {
        this.selected = key;
        this.draw();
      });

      const badge = document.createElement('span');
      const kind = clipRowBadge(entry);
      badge.className = `clip-badge is-${kind.tone}`;
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = kind.text;

      const lines = document.createElement('span');
      lines.className = 'clip-lines';

      const body = document.createElement('span');
      const rendered = clipRowText(entry);
      body.className = rendered.muted ? 'clip-body is-muted' : 'clip-body';
      // `clipRowText` is the single decision about what a row says, and for `displaced` it returns
      // a description rather than the content. Nothing here reaches past it to `entry.text`.
      body.textContent = rendered.body;

      const meta = document.createElement('span');
      meta.className = 'clip-meta';
      meta.textContent = `${clipRowSource(entry)} · ${new Date(entry.atMs).toLocaleTimeString()}`;

      lines.append(body, meta);
      row.append(badge, lines);
      this.list.append(row);
    }

    // The design's "128 items in history", with what this one is actually bounded by. The two
    // sentences the footer used to carry are here rather than in the list, because a footnote under
    // twenty rows is a footnote nobody scrolls to.
    this.foot.textContent =
      `${this.entries.length} of 20 entries, in memory only — cleared when the phone disconnects, ` +
      'gone when this app restarts, never written to disk.';

    this.drawDetail(selectedRow);
  }

  /**
   * The 340px column: what this entry is, and what actually happened to it.
   *
   * The handoff's **Share** button is not here. macOS's share sheet is `NSSharingServicePicker`,
   * which Electron does not expose, and there is nothing to substitute for it that would not be a
   * different feature wearing its label.
   */
  private drawDetail(entry: ClipEntryRow | null): void {
    // The two walls are standing copy in **every** state — including no-entry-selected — so every
    // rebuild of this column re-appends them by identity rather than clearing and hoping. They are
    // written once, in the constructor; a `replaceChildren` that forgot them would delete the
    // pane's only statement of the Android wall and nothing would error.
    if (!entry) {
      this.detail.replaceChildren(this.wall, this.phoneWall);
      return;
    }

    const block = document.createElement('div');
    block.className = 'clip-detail-block';

    const badge = document.createElement('span');
    const kind = clipRowBadge(entry);
    badge.className = `clip-badge is-${kind.tone} clip-badge-lg`;
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = kind.text;

    const headline = document.createElement('div');
    const rendered = clipRowText(entry);
    headline.className = rendered.muted ? 'clip-headline is-muted' : 'clip-headline';
    headline.textContent = rendered.body;

    block.append(badge, headline);

    const actions = document.createElement('div');
    actions.className = 'clip-detail-actions';

    // Restore and Use this are the same call and two different sentences: one puts an older
    // entry on the clipboard, the other undoes an automatic write. Naming them the same thing
    // would leave the undo unlabelled on the one row that exists to be an undo.
    if ((entry.kind === 'text' || entry.kind === 'displaced') && entry.text) {
      const restoring = entry.kind === 'displaced';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'button-primary clip-use';
      use.textContent = restoring ? 'Restore' : 'Copy';
      const text = entry.text;
      use.addEventListener('click', () => {
        void this.bridge
          .clipUse(text)
          .then(() =>
            this.say(
              restoring ? 'Put back on this Mac’s clipboard.' : 'Copied to this Mac’s clipboard.',
              false,
            ),
          );
      });
      actions.append(use);

      // **Open is drawn by the same function that decides whether opening is allowed.** A pane that
      // decided with its own regex would eventually draw a button the main process refuses, or
      // worse, argue for one it should not.
      const url = openableUrl(text);
      if (url && !restoring) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'button-secondary';
        open.textContent = 'Open';
        open.title = `Opens ${url} in your browser`;
        open.addEventListener('click', () => {
          void this.bridge.clipOpen(text).then((result) => {
            if (!result.ok) this.say([result.reason, result.fixHint].filter(Boolean).join(' '), true);
          });
        });
        actions.append(open);
      }
    }
    if (actions.children.length > 0) block.append(actions);

    const info = document.createElement('h3');
    info.className = 'clip-detail-title';
    info.textContent = 'Information';
    block.append(info);

    const grid = document.createElement('dl');
    grid.className = 'clip-info';
    for (const [label, value] of [
      ['Source', clipRowSource(entry)],
      ['Type', clipTypeLabel(entry)],
    ] as [string, string][]) {
      const key = document.createElement('dt');
      key.textContent = label;
      const val = document.createElement('dd');
      val.textContent = value;
      grid.append(key, val);
    }
    block.append(grid);

    const timeline = document.createElement('h3');
    timeline.className = 'clip-detail-title';
    timeline.textContent = 'Sync timeline';
    block.append(timeline);

    for (const step of clipTimeline(entry)) {
      const line = document.createElement('div');
      line.className = `clip-step is-${step.tone}`;
      const dot = document.createElement('span');
      dot.className = 'clip-step-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'clip-step-label';
      label.textContent = step.label;
      text.append(label);
      // **Whose clock**, always, beside the time. The phone's `atMs` and this Mac's `receivedAtMs`
      // are two machines' readings and there is no correction between them; a timeline that stacked
      // them unlabelled would invite somebody to subtract one from the other.
      //
      // A step with no time gets **no second line at all**. The first version printed
      // *"not recorded"* under every undated step, which put that phrase under
      // *"Put on this Mac's clipboard"* — a step whose whole content is that it happened — and made
      // it read as a contradiction of its own label. Where the *fact* is unrecorded the label says
      // so itself; the second line is only ever about the clock.
      if (step.at !== undefined) {
        const when = document.createElement('span');
        when.className = 'clip-step-when mono';
        when.textContent =
          `${new Date(step.at).toLocaleTimeString()} · ` +
          (step.clock === 'phone' ? 'phone’s clock' : 'this Mac’s clock');
        text.append(when);
      }
      line.append(dot, text);
      block.append(line);
    }

    this.detail.replaceChildren(block, this.wall, this.phoneWall);
  }
}

// The testable seam: the two pure decisions this pane makes, hung where a test can reach them
// without a window. The test runs the code that draws the row rather than a second copy of the
// rule — a test that models the thing under test instead of calling it is the newest way to write
// one that cannot fail.
(globalThis as Record<string, unknown>).clipRowText = clipRowText;
(globalThis as Record<string, unknown>).clipRowSource = clipRowSource;
(globalThis as Record<string, unknown>).clipRowBadge = clipRowBadge;
(globalThis as Record<string, unknown>).clipTypeLabel = clipTypeLabel;
(globalThis as Record<string, unknown>).clipTimeline = clipTimeline;
(globalThis as Record<string, unknown>).filterClips = filterClips;
(globalThis as Record<string, unknown>).ClipboardView = ClipboardView;
