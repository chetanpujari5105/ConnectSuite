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
 * ### One control writes the clipboard
 *
 * "Use this", per row. Nothing else on this page touches the pasteboard, and an arriving entry
 * never does: a single-slot store with no undo does not get written on somebody's behalf.
 */

interface ClipEntryRow {
  kind: 'text' | 'empty' | 'sensitive' | string;
  text?: string;
  atMs: number;
  source: 'phone' | 'mac';
  package?: string;
  appName?: string;
}

type ClipResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface ClipBridge {
  clipSend(): Promise<ClipResult<{ bytes: number }>>;
  clipRequest(): Promise<ClipResult<ClipEntryRow>>;
  clipHistory(): Promise<ClipResult<ClipEntryRow[]>>;
  clipUse(text: string): Promise<ClipResult<null>>;
  onClipArrived(callback: (entry: ClipEntryRow) => void): void;
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
    default:
      return { body: `This Mac can’t show a “${entry.kind}” entry yet.`, muted: true };
  }
}

/** Where an entry came from, with the package-id rule applied: the label, never the raw id. */
function clipRowSource(entry: ClipEntryRow): string {
  if (entry.source === 'mac') return 'This Mac';
  if (entry.appName) return `Phone · ${entry.appName}`;
  return 'Phone';
}

class ClipboardView {
  private entries: ClipEntryRow[] = [];

  constructor(
    private readonly bridge: ClipBridge,
    private readonly list: HTMLElement,
    private readonly wall: HTMLElement,
    private readonly notice: HTMLElement,
    sendButton: HTMLButtonElement,
    requestButton: HTMLButtonElement,
  ) {
    this.wall.textContent =
      'Your phone can only send its clipboard while ConnectSuite is open on screen — Android does ' +
      'not let any app read the clipboard in the background. Copy on the phone, then open ' +
      'ConnectSuite there and it arrives. Sending from this Mac works any time.';

    sendButton.addEventListener('click', () => {
      void this.run(() => this.bridge.clipSend(), (data) => `Sent ${data.bytes} bytes to the phone.`);
    });
    requestButton.addEventListener('click', () => {
      void this.run(
        () => this.bridge.clipRequest(),
        (entry) => {
          this.prepend(entry);
          return clipRowText(entry).body ? 'Got the phone’s clipboard.' : 'The phone answered.';
        },
      );
    });

    this.bridge.onClipArrived((entry) => this.prepend(entry));
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

  private async refresh(): Promise<void> {
    const result = await this.bridge.clipHistory();
    if (result.ok) {
      this.entries = result.data;
      this.draw();
    }
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
      body.textContent = rendered.body;

      row.append(meta, body);

      if (entry.kind === 'text' && entry.text) {
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'button-secondary clip-use';
        use.textContent = 'Use this';
        const text = entry.text;
        use.addEventListener('click', () => {
          void this.bridge.clipUse(text).then(() => this.say('Copied to this Mac’s clipboard.', false));
        });
        row.append(use);
      }

      this.list.append(row);
    }

    const held = document.createElement('div');
    held.className = 'clip-footnote';
    held.textContent =
      `${this.entries.length} of 20 entries, in memory only. They are cleared when the phone ` +
      'disconnects and are never written to disk.';
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
