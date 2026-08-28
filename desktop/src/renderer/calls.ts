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
}

class CallsView {
  private call: CallCard | null = null;
  private log: CallLogRow[] = [];
  private logHasMore = false;
  private loaded = false;

  /** The number awaiting a second click. Cleared by any other interaction. See the file comment. */
  private pendingDial: string | null = null;

  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly live: HTMLElement,
    private readonly body: HTMLElement,
    private readonly dialInput: HTMLInputElement,
    private readonly dialButton: HTMLButtonElement,
    private readonly notice: HTMLElement,
    private readonly bridge: CallsBridge,
  ) {
    bridge.onCallChanged((call) => {
      this.call = call;
      this.renderLive();
      // A call that has just ended is a new row in the log.
      if (!call && this.loaded) void this.loadLog();
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
  }

  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.call = null;
      this.log = [];
      this.loaded = false;
      this.pendingDial = null;
      this.renderLive();
      this.renderLog();
      this.renderDialButton();
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

  private async refreshCurrent(): Promise<void> {
    this.call = await this.bridge.callCurrent().catch(() => null);
    this.renderLive();
  }

  private async loadLog(): Promise<void> {
    const result = await this.bridge.callLog({ limit: 50 }).catch(
      (error): CallsResult<{ calls: CallLogRow[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own calls channel (${String(error)}).`,
      }),
    );
    if (!result.ok) {
      this.showNotice(result.reason ?? 'The call log could not be read.', result.fixHint);
      return;
    }
    this.loaded = true;
    this.log = result.data.calls;
    this.logHasMore = result.data.hasMore;
    this.renderLog();
  }

  /** The live card: the one call that can be acted on, or nothing. */
  private renderLive(): void {
    this.live.textContent = '';
    if (!this.call) {
      this.live.classList.add('hidden');
      return;
    }
    this.live.classList.remove('hidden');

    const who = document.createElement('div');
    who.className = 'call-who';
    // Name when contacts can supply one, number when it cannot, never blank — the same rule as
    // the SMS thread list, and the reason contacts was brought forward into this phase.
    //
    // Defect 35: this was `??`, which does not catch an empty string. `"" ?? x` is `""`, so a
    // phone that reported `number: ""` walked straight past the fallback chain written to
    // prevent exactly this, and the card drew a blank. Emptiness, not nullishness.
    who.textContent = callWho(this.call);

    const state = document.createElement('div');
    state.className = 'muted small';
    state.textContent = callStatus(this.call);

    const bar = document.createElement('div');
    bar.className = 'row';

    if (this.call.state === 'ringing') {
      const answer = document.createElement('button');
      answer.id = 'call-answer';
      answer.textContent = 'Answer on phone';
      // The label says where it answers. There is no audio path and there never will be — see the
      // file comment and docs/permissions.md — so a bare "Answer" would be a promise this cannot keep.
      answer.title = 'Answers on the phone. There is no audio between the phone and this Mac.';
      answer.addEventListener('click', () => void this.run(this.bridge.callAnswer()));
      bar.appendChild(answer);
    }

    const reject = document.createElement('button');
    reject.id = 'call-reject';
    reject.className = 'danger';
    reject.textContent = this.call.state === 'active' ? 'Hang up' : 'Reject';
    reject.addEventListener('click', () => void this.run(this.bridge.callReject()));
    bar.appendChild(reject);

    const audio = document.createElement('div');
    audio.className = 'muted small';
    audio.textContent =
      'Audio stays on the phone — pair the Mac to it over Bluetooth to listen through the Mac.';

    this.live.append(who, state, bar, audio);
  }

  private renderLog(): void {
    this.body.textContent = '';
    if (!this.loaded) {
      this.note.textContent = 'Reading the phone’s call log…';
      return;
    }
    if (this.log.length === 0) {
      this.note.textContent = 'There are no calls in the phone’s log.';
      return;
    }
    // Both numbers again: a call log is a column of phone numbers without contacts.
    const named = this.log.filter((c) => c.contactName).length;
    const missed = this.log.filter((c) => c.type === 'missed').length;
    this.note.textContent =
      `${this.log.length} recent call${this.log.length === 1 ? '' : 's'}, ` +
      `${named} showing a contact name, ${missed} missed.` +
      (this.logHasMore ? ' Older calls are not shown.' : '');

    const list = document.createElement('div');
    list.className = 'call-log';
    for (const entry of this.log) list.appendChild(this.logRow(entry));
    this.body.appendChild(list);
  }

  private logRow(entry: CallLogRow): HTMLElement {
    const row = document.createElement('div');
    row.className = `call-row ${entry.type}`;

    const who = document.createElement('span');
    who.className = 'call-log-who';
    who.textContent = firstNonEmpty(entry.contactName, entry.number) ?? 'Unknown number';

    const kind = document.createElement('span');
    kind.className = 'muted small';
    // An unrecognised type is shown as itself rather than guessed at — the protocol has an
    // `unknown` member precisely so a new platform value is not silently drawn as "incoming".
    kind.textContent = entry.type;

    const when = document.createElement('span');
    when.className = 'muted small';
    when.textContent =
      timeOfCall(entry.dateMs) + (entry.durationMs ? ` · ${duration(entry.durationMs)}` : '');

    const dial = document.createElement('button');
    dial.className = 'secondary small';
    dial.textContent = 'Call back';
    dial.addEventListener('click', () => {
      // Fills the dialler rather than placing the call: the confirm step is the dialler's, and
      // there is exactly one of it.
      this.dialInput.value = entry.number;
      this.pendingDial = null;
      this.renderDialButton();
      this.dialInput.focus();
    });

    row.append(who, kind, when, dial);
    return row;
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
    this.dialButton.classList.toggle('danger', this.pendingDial !== null);
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

function timeOfCall(whenMs: number): string {
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
(globalThis as Record<string, unknown>).__callLabels = { firstNonEmpty, callWho, callStatus };
