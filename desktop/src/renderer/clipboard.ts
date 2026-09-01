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
  atMs: number;
  source: 'phone' | 'mac';
  package?: string;
  appName?: string;
}

type ClipResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface ClipBridge {
  clipSend(): Promise<ClipResult<{ bytes: number }>>;
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

class ClipboardView {
  private entries: ClipEntryRow[] = [];

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

  private draw(): void {
    this.list.replaceChildren();
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'clip-empty';
      empty.textContent = 'Nothing yet. Copy something on either machine.';
      this.list.append(empty);
      return;
    }

    for (const entry of this.entries) {
      const row = document.createElement('div');
      row.className = 'clip-row';

      const meta = document.createElement('div');
      meta.className = 'clip-meta';
      meta.textContent = `${clipRowSource(entry)} · ${new Date(entry.atMs).toLocaleTimeString()}`;

      const body = document.createElement('div');
      const rendered = clipRowText(entry);
      body.className = rendered.muted ? 'clip-body is-muted' : 'clip-body';
      // `clipRowText` is the single decision about what a row says, and for `displaced` it returns
      // a description rather than the content. Nothing here reaches past it to `entry.text`.
      body.textContent = rendered.body;

      row.append(meta, body);

      // Restore and Use this are the same call and two different sentences: one puts an older
      // entry on the clipboard, the other undoes an automatic write. Naming them the same thing
      // would leave the undo unlabelled on the one row that exists to be an undo.
      if ((entry.kind === 'text' || entry.kind === 'displaced') && entry.text) {
        const restoring = entry.kind === 'displaced';
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'button-secondary clip-use';
        use.textContent = restoring ? 'Restore' : 'Use this';
        const text = entry.text;
        use.addEventListener('click', () => {
          void this.bridge
            .clipUse(text)
            .then(() =>
              this.say(
                restoring
                  ? 'Put back on this Mac’s clipboard.'
                  : 'Copied to this Mac’s clipboard.',
                false,
              ),
            );
        });
        row.append(use);
      }

      this.list.append(row);
    }

    const held = document.createElement('div');
    held.className = 'clip-footnote';
    held.textContent =
      `${this.entries.length} of 20 entries, in memory only. They are cleared when the phone ` +
      'disconnects and are never written to disk. Replaced entries are kept so you can put them ' +
      'back, and their text is not shown.';
    this.list.append(held);
  }
}

// The testable seam: the two pure decisions this pane makes, hung where a test can reach them
// without a window. The test runs the code that draws the row rather than a second copy of the
// rule — a test that models the thing under test instead of calling it is the newest way to write
// one that cannot fail.
(globalThis as Record<string, unknown>).clipRowText = clipRowText;
(globalThis as Record<string, unknown>).clipRowSource = clipRowSource;
(globalThis as Record<string, unknown>).ClipboardView = ClipboardView;
