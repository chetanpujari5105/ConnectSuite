/**
 * The media remote: what is playing on the phone, and the transport for it.
 *
 * Module-free on purpose, like the other renderer files: the page is CSP-locked and loads plain
 * scripts, so a top-level `export` here would emit a CommonJS module the renderer cannot require.
 *
 * ### The two rules this pane enforces
 *
 * **Nothing playing is a normal state, not a failure.** `active: false` draws an empty card that
 * says so in a sentence. It is not an error, not a red banner, and not a hidden card — a phone
 * with no music on it is a phone working correctly, and a remote that reported that as a fault
 * would cry wolf every time somebody stopped listening to something. See step 66.
 *
 * **A button is only drawn where the player has said it works.** `canSkipNext`, `canSkipPrevious`
 * and `canSeek` come from the session's own `PlaybackState.actions`, and a control the app will
 * ignore is disabled with the reason on it rather than left live to do nothing. See step 65 — a
 * remote that silently does nothing is the failure this project keeps ruling out.
 */

/** Mirrors `RemoteState` in shared/protocol.ts, plus the arrival stamp the main process adds. */
interface RemoteStateView {
  active: boolean;
  package?: string;
  appName?: string;
  playing?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
  positionAtMs?: number;
  canSeek?: boolean;
  canSkipNext?: boolean;
  canSkipPrevious?: boolean;
  volume?: number;
  volumeMax?: number;
  /** This Mac's clock when the state arrived. The anchor the progress bar runs from. */
  receivedAtMs: number;
}

interface RemoteAck {
  ok: boolean;
  reason?: string;
  fixHint?: string;
}

interface RemoteBridge {
  remoteState(): Promise<RemoteStateView>;
  remoteCommand(action: string, extra?: Record<string, unknown>): Promise<RemoteAck>;
  onRemoteChanged(callback: (state: RemoteStateView) => void): void;
}

/** How often the bar redraws itself between pushes. Four a second reads as smooth and costs nothing. */
const TICK_MS = 250;

class RemoteView {
  private state: RemoteStateView = { active: false, receivedAtMs: 0 };

  /** True while a seek is being dragged, so an arriving push does not yank the handle away. */
  private scrubbing = false;

  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly body: HTMLElement,
    private readonly notice: HTMLElement,
    private readonly bridge: RemoteBridge,
  ) {
    bridge.onRemoteChanged((state) => {
      this.state = state;
      this.render();
    });
    // The bar has to move between pushes or it looks frozen — the phone pushes on a track change,
    // not on every second. This is the whole reason `positionMs` travels with a timestamp; see
    // remote.ts in the main process for which clock the timestamp is read against.
    window.setInterval(() => this.tick(), TICK_MS);
  }

  /** Hidden until the phone advertises `remote`, like the notifications and contacts cards. */
  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) this.state = { active: false, receivedAtMs: 0 };
    this.render();
  }

  /** Pulls the state the main process already holds, for a window that opened late. */
  async refresh(): Promise<void> {
    this.state = await this.bridge
      .remoteState()
      .catch(() => ({ active: false, receivedAtMs: 0 }) as RemoteStateView);
    this.render();
  }

  /**
   * Where playback has reached now, extrapolated from the last state.
   *
   * Two corrections, both of which the protocol's `positionMs`/`positionAtMs` pair exists to make
   * possible: how stale the reading already was when it arrived, and how long ago it arrived. A
   * bar drawn from `positionMs` alone would sit still between pushes and then jump.
   *
   * Only while playing. A paused track's position does not advance, and a bar that crept forward
   * on a paused song would be inventing playback that is not happening.
   */
  private positionNow(): number | null {
    const { positionMs, durationMs, playing, receivedAtMs } = this.state;
    if (positionMs === undefined) return null;
    if (!playing) return positionMs;
    const sinceArrival = Math.max(0, Date.now() - receivedAtMs);
    const at = positionMs + sinceArrival;
    return durationMs ? Math.min(at, durationMs) : at;
  }

  private tick(): void {
    if (!this.state.active || !this.state.playing || this.scrubbing) return;
    const at = this.positionNow();
    if (at === null) return;
    const bar = this.body.querySelector<HTMLInputElement>('.remote-seek');
    const elapsed = this.body.querySelector<HTMLElement>('.remote-elapsed');
    if (bar && !bar.matches(':active')) bar.value = String(at);
    if (elapsed) elapsed.textContent = clock(at);
  }

  private render(): void {
    this.body.textContent = '';

    if (!this.state.active) {
      // An empty remote, not an error. See the file comment and step 66.
      this.note.textContent = 'Nothing is playing on the phone.';
      return;
    }

    // Composed in shared/appLabel.ts, never here. Defect 46: this line interpolated
    // `appName ?? package ?? 'an app'`, so a package with no launcher icon produced
    // "Paused in com.spotify.music." — a raw handle as the only thing a person reads.
    this.note.textContent = remoteNowPlayingNoteOf(this.state);

    this.body.appendChild(this.nowPlaying());
    this.body.appendChild(this.scrubber());
    this.body.appendChild(this.transport());
    if (this.state.volumeMax) this.body.appendChild(this.volume());
  }

  private nowPlaying(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'remote-track';

    const title = document.createElement('div');
    title.className = 'remote-title';
    title.textContent = this.state.title ?? 'Untitled';
    wrap.appendChild(title);

    // Artist and album are separate fields on the wire and are joined only for display. An
    // absent one is dropped rather than drawn as an empty separator.
    const line = [this.state.artist, this.state.album].filter(Boolean).join(' — ');
    if (line) {
      const sub = document.createElement('div');
      sub.className = 'remote-sub muted small';
      sub.textContent = line;
      wrap.appendChild(sub);
    }
    return wrap;
  }

  private scrubber(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'remote-scrub';

    const at = this.positionNow();
    const duration = this.state.durationMs ?? 0;

    const elapsed = document.createElement('span');
    elapsed.className = 'remote-elapsed muted small';
    elapsed.textContent = at === null ? '—' : clock(at);

    const bar = document.createElement('input');
    bar.className = 'remote-seek';
    bar.type = 'range';
    bar.min = '0';
    bar.max = String(duration || 1);
    bar.value = String(at ?? 0);
    // A track with no duration cannot be scrubbed, and neither can a session that says it cannot
    // seek. Disabled with the reason on it rather than live and ignored.
    const seekable = duration > 0 && this.state.canSeek !== false;
    bar.disabled = !seekable;
    if (!seekable) {
      bar.title =
        duration > 0
          ? remoteSeekDisabledTitleOf(this.state)
          : 'This track has no length the phone can report, so there is nothing to seek within.';
    }
    bar.addEventListener('pointerdown', () => {
      this.scrubbing = true;
    });
    const commit = (): void => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      void this.run(this.bridge.remoteCommand('seek', { positionMs: Number(bar.value) }));
    };
    bar.addEventListener('pointerup', commit);
    bar.addEventListener('change', commit);

    const total = document.createElement('span');
    total.className = 'remote-total muted small';
    total.textContent = duration ? clock(duration) : '—';

    wrap.append(elapsed, bar, total);
    return wrap;
  }

  private transport(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'row remote-transport';

    bar.appendChild(
      this.button('Previous', 'previous', this.state.canSkipPrevious === false, 'the previous track'),
    );
    // One button, two verbs, because that is what the phone's `play_pause` is and what a person
    // reaches for. Its label follows the state so it never claims the opposite of what it does.
    const playPause = this.button(
      this.state.playing ? 'Pause' : 'Play',
      'play_pause',
      false,
      '',
    );
    playPause.classList.remove('secondary');
    bar.appendChild(playPause);
    bar.appendChild(
      this.button('Next', 'next', this.state.canSkipNext === false, 'the next track'),
    );
    return bar;
  }

  /**
   * One transport button, disabled where the session has said the action does nothing.
   *
   * The reason goes on the `title` *and* into a visually hidden span, for the reason the capability
   * chips were rebuilt (defect 26): a disabled button with a tooltip tells a sighted mouse user why
   * and tells everybody else nothing. The state has to be part of the accessible name.
   */
  private button(label: string, action: string, unsupported: boolean, what: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.append(document.createTextNode(label));
    button.dataset.action = action;
    button.disabled = unsupported;
    if (unsupported) {
      // Was `appName ?? 'This app'`, which is defect 46's *other* wrong fix: safe, and it throws
      // away the only identifying information there is. The handle appears; it is never alone.
      const why = remoteSkipTitleOf(this.state, what);
      button.title = why;
      const spoken = document.createElement('span');
      spoken.className = 'visually-hidden';
      spoken.textContent = ` — unavailable: ${why}`;
      button.append(spoken);
    }
    button.addEventListener('click', () => void this.run(this.bridge.remoteCommand(action)));
    return button;
  }

  private volume(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'row remote-volume';

    const label = document.createElement('label');
    label.className = 'small';
    label.textContent = 'Volume';
    label.htmlFor = 'remote-volume-input';

    const slider = document.createElement('input');
    slider.id = 'remote-volume-input';
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(this.state.volumeMax ?? 15);
    slider.value = String(this.state.volume ?? 0);
    slider.addEventListener('change', () => {
      void this.run(this.bridge.remoteCommand('volume_set', { volume: Number(slider.value) }));
    });

    const reading = document.createElement('span');
    reading.className = 'muted small';
    // The number beside the maximum, not on its own: "7" says nothing without knowing it is out
    // of 15. Same rule as every other count in this project.
    reading.textContent = `${this.state.volume ?? 0} of ${this.state.volumeMax ?? '?'}`;

    wrap.append(label, slider, reading);
    return wrap;
  }

  private async run(intent: Promise<RemoteAck>): Promise<void> {
    const result = await intent.catch((error): RemoteAck => ({
      ok: false,
      reason: `The Mac could not reach its own media channel (${String(error)}).`,
    }));
    if (!result.ok) this.showNotice(result.reason ?? 'That did not work.', result.fixHint);
  }

  /** Same shape as the other panes' notices, and the same reason: no silent refusal. */
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

/** `m:ss`, or `h:mm:ss` for anything over an hour. A track position, not a duration in words. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// The view class, where a test can construct it. `clock` goes too: it is the pane's one pure
// decision and a second copy of it in a test is a copy that would not get the next fix.
(globalThis as Record<string, unknown>).RemoteView = RemoteView;
(globalThis as Record<string, unknown>).remoteClock = clock;
