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
  /** The current cover's stable id, or absent when the session has none. See remote.artwork. */
  artworkKey?: string;
  /** Where the phone is sending its audio, or absent when it could not name a route. */
  output?: { name: string; kind: 'bluetooth' | 'headphones' | 'speaker' | 'unknown' };
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
  /**
   * The Apps pane's own verb, reused. **Optional, and that is not defensive typing** — the view
   * test's bridge does not implement it, and a pane that threw on a bridge without it would be a
   * pane whose art depends on a capability the remote does not advertise. No art is a state this
   * widget already draws; a crash is not.
   */
  appsIcons?(options: { packages: string[]; maxEdge?: number }): Promise<{
    ok: boolean;
    data?: Array<[string, string]>;
  }>;
  /**
   * The cover for one `artworkKey`. Optional for the same reason `appsIcons` is: the view test's
   * bridge does not implement it, and no cover is a state this widget already draws properly.
   *
   * `ok: true` with `data: null` is the common answer, not an error — a session with no art.
   */
  remoteArtwork?(key: string, maxEdge?: number): Promise<{ ok: boolean; data?: string | null }>;
  /** `apps.open.ask`. Optional like the two above — the view test's bridge does not implement it,
   *  and a card with no way to ask degrades to a source label rather than throwing. */
  appsOpenAsk?(options: { package: string }): Promise<{ ok: boolean; reason?: string }>;
}

/** How often the bar redraws itself between pushes. Four a second reads as smooth and costs nothing. */
const TICK_MS = 250;

class RemoteView {
  private state: RemoteStateView = { active: false, receivedAtMs: 0 };

  /** True while a seek is being dragged, so an arriving push does not yank the handle away. */
  private scrubbing = false;

  /**
   * Launcher icons by package, and the packages already asked for.
   *
   * Two maps rather than one because a package with *no* icon has to be remembered as asked —
   * otherwise every render re-requests the one package that will never answer, which is a round
   * trip per track change forever. The negative is the entry worth caching.
   */
  private readonly icons = new Map<string, string>();
  private readonly iconAsked = new Set<string>();

  /** Covers by `artworkKey`, and the keys already asked for. Same two-collection reason as above. */
  private readonly covers = new Map<string, string>();
  private readonly artAsked = new Set<string>();

  /** Dominant colour by cover, so the canvas read happens once per album rather than per render. */
  private readonly glow = new Map<string, string>();

  private noticeTimer: number | null = null;

  /**
   * Whether a session can exist at all. `live` until told otherwise, so a pushed state draws; the
   * other two are the handoff's unavailable states, each with no transport: `permission` is the
   * phone connected but not offering `remote` (the notification-listener grant, same as
   * Notifications), `offline` is no phone to ask.
   */
  private availability: 'live' | 'permission' | 'offline' = 'live';
  /** The phone's own sentence for `permission`, verbatim — never a Mac-side paraphrase. */
  private unavailableReason: string | null = null;

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

  /**
   * The card is always on Overview now (handoff component 15): a phone that is not offering the
   * remote gets the amber permission state, and no phone gets the disconnected one. Neither draws
   * a transport, and **last-known media is never redrawn as if it were playing** — the state is
   * forgotten the moment the capability goes.
   */
  setAdvertised(advertised: boolean, connected = advertised, reason: string | null = null): void {
    this.card.classList.remove('hidden');
    this.availability = advertised ? 'live' : connected ? 'permission' : 'offline';
    this.unavailableReason = reason;
    if (!advertised) this.state = { active: false, receivedAtMs: 0 };
    this.card.dataset.availability = this.availability;
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
    const total = this.body.querySelector<HTMLElement>('.remote-total');
    if (bar && !bar.matches(':active')) {
      bar.value = String(at);
      // The fill is repainted here and not only on `input`, or the bar would advance its value
      // four times a second and its colour never — which is the same frozen bar this tick exists
      // to prevent, one property along.
      fillOf(bar);
    }
    if (elapsed) elapsed.textContent = clock(at);
    // Remaining counts down as elapsed counts up. Drawn from the same `at`, so the two cannot
    // disagree — the second writer this project keeps finding is usually a second source.
    const duration = this.state.durationMs ?? 0;
    if (total && duration) total.textContent = `-${clock(Math.max(0, duration - at))}`;
  }

  /**
   * This session's app icon, if we already have it — and a request for it if we do not.
   *
   * Synchronous by design: the widget draws now with whatever it has, and a later arrival triggers
   * one re-render. An `await` here would make every track change wait on an icon the user has
   * usually already seen, for a picture that is not the point of the card.
   */
  private appIcon(): string | undefined {
    const pkg = this.state.package;
    if (!pkg) return undefined;
    const have = this.icons.get(pkg);
    if (have !== undefined) return have || undefined;
    if (!this.iconAsked.has(pkg)) {
      this.iconAsked.add(pkg);
      void this.fetchIcon(pkg);
    }
    return undefined;
  }

  /**
   * One launcher icon, at 96px — and this is the badge's whole brand-colour story.
   *
   * The brief asked for each service's real brand colour on the badge. This is that, sourced from
   * the service rather than approximated by us: Spotify's icon *is* the green disc, YouTube
   * Music's *is* the red one. A hard-coded table of three brand colours would cover three apps,
   * be wrong the first time one rebrands, and draw a grey nothing for the other 120 apps on the
   * phone. The real asset covers all of them and cannot drift.
   */
  private async fetchIcon(pkg: string): Promise<void> {
    if (!this.bridge.appsIcons) return;
    const result = await this.bridge
      .appsIcons({ packages: [pkg], maxEdge: 96 })
      .catch(() => ({ ok: false }) as { ok: boolean; data?: Array<[string, string]> });
    const data = result.ok ? (result.data ?? []).find(([p]) => p === pkg)?.[1] : undefined;
    // An empty string is the remembered negative: `appIcon` reads it as "asked, nothing there".
    this.icons.set(pkg, data ?? '');
    if (data && this.state.package === pkg) this.render();
  }

  /**
   * The current track's cover, if we have it — and a request for it if we do not.
   *
   * Keyed on `artworkKey`, which the phone changes when the art changes and **not** when the
   * position does. That is the entire reason the key exists rather than the bytes riding along on
   * the state; see `docs/protocol.md` → `remote.artwork`.
   */
  private artworkNow(): string | undefined {
    const key = this.state.artworkKey;
    if (!key) return undefined;
    const have = this.covers.get(key);
    if (have !== undefined) return have || undefined;
    if (!this.artAsked.has(key)) {
      this.artAsked.add(key);
      void this.fetchArt(key);
    }
    return undefined;
  }

  private async fetchArt(key: string): Promise<void> {
    if (!this.bridge.remoteArtwork) return;
    const result = await this.bridge
      .remoteArtwork(key, 256)
      .catch(() => ({ ok: false }) as { ok: boolean; data?: string | null });
    const data = result.ok ? (result.data ?? null) : null;
    this.covers.set(key, data ?? '');
    // Only redraw if this is still the track on screen. A reply for a key we have moved past would
    // otherwise hang the previous album's cover on the current song — the failure the echoed key
    // exists to prevent, and it has to be checked at every layer that can still get it wrong.
    if (this.state.artworkKey === key) this.render();
  }

  private render(): void {
    this.body.textContent = '';

    const now = document.createElement('div');
    now.className = 'remote-now';
    if (!this.state.active) now.classList.add('remote-idle');

    now.appendChild(this.header());

    if (this.availability !== 'live') {
      this.note.textContent =
        this.availability === 'permission'
          ? 'The media remote needs notification access on the phone.'
          : 'The phone is not connected.';
      now.classList.add('remote-idle');
      now.appendChild(this.unavailable());
      this.body.appendChild(now);
      return;
    }

    this.note.textContent = this.state.active
      // Composed in shared/appLabel.ts, never here. Defect 46: this line interpolated
      // `appName ?? package ?? 'an app'`, so a package with no launcher icon produced
      // "Paused in com.spotify.music." — a raw handle as the only thing a person reads.
      ? remoteNowPlayingNoteOf(this.state)
      // An empty remote, not an error. See the file comment and step 66.
      : 'Nothing is playing on the phone.';

    now.appendChild(this.mainRow());

    /*
     * **Idle draws no transport — the Sidekick handoff (component 15), 2026-09-19.** With no session
     * the phone refuses every `remote.command` with `NO_MEDIA_SESSION`, so a disabled Previous /
     * Play / Next row over "Nothing playing" is a set of controls that can never work. The card
     * names what will appear instead. It replaces the 2026-09-16 rule (transport drawn, disabled),
     * which followed the superseded reference.
     */
    if (!this.state.active) {
      now.appendChild(this.idlePanel());
      this.body.appendChild(now);
      this.paintGlow(now);
      return;
    }

    // A scrubber is not drawn at all when the track has no length (handoff §5c).
    if ((this.state.durationMs ?? 0) > 0) now.appendChild(this.scrubber());
    now.appendChild(this.transport());

    // **One row, not two stacked controls.** Volume and output answer the same question — where
    // the sound goes and how loud — so they share `remote-foot`, the readout at its far right.
    const foot = document.createElement('div');
    foot.className = 'remote-foot';
    foot.append(this.volume(), this.outputRow());
    now.appendChild(foot);

    this.body.appendChild(now);
    this.paintGlow(now);
  }

  /** The permission and offline states: a sentence and nothing to press that could not work. */
  private unavailable(): HTMLElement {
    const block = document.createElement('div');
    block.className = `remote-unavailable is-${this.availability}`;
    const badge = document.createElement('span');
    badge.className = 'remote-unavailable-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.appendChild(iconSvg(this.availability === 'permission' ? 'alert' : 'link-minus', 18));
    const text = document.createElement('div');
    text.className = 'remote-track';
    const title = document.createElement('div');
    title.className = 'remote-title';
    title.textContent =
      this.availability === 'permission' ? 'Needs notification access' : 'Phone not connected';
    const sub = document.createElement('div');
    sub.className = 'remote-sub small';
    sub.textContent =
      this.availability === 'permission'
        ? (this.unavailableReason ??
          'Turn on notification access for Sidekick on the phone. The remote uses the same grant as Notifications.')
        : 'Media controls come back when your phone reconnects. Nothing is being controlled now.';
    text.append(title, sub);
    block.append(badge, text);
    return block;
  }

  /** What an idle card says will appear here — a panel, not a row of dead controls. */
  private idlePanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'remote-idle-panel';
    for (const [icon, text] of [
      ['music', 'Title, artist and artwork'],
      ['play', 'Play, pause and skip, where the app allows it'],
      ['volume-high', 'Volume, and where the phone is sending the sound'],
    ] as [string, string][]) {
      const line = document.createElement('div');
      line.className = 'remote-idle-line';
      line.append(iconSvg(icon, 14), document.createTextNode(text));
      panel.appendChild(line);
    }
    return panel;
  }

  /**
   * The colour glow behind the card, taken from the cover.
   *
   * **It writes three numbers, never a colour.** `--art-rgb` is a channel triplet and every alpha
   * that composes it lives in `styles.css` — the same split `--overlay-rgb` already uses here, and
   * the reason is not stylistic: `check-color-tokens.mjs` requires every colour outside
   * `tokens.css` to read a token, and a renderer interpolating `rgba(${r},${g},${b},0.22)` would
   * be a colour literal built at runtime, in a file that is not allowed to have one. Keeping the
   * alpha in the stylesheet keeps the guard meaningful instead of routed around.
   *
   * With no cover the property is removed rather than set to a neutral, so the CSS falls back to
   * the accent through `var(--art-rgb, var(--tint-violet-rgb))`. One fallback, declared where the
   * colour is drawn.
   */
  private paintGlow(now: HTMLElement): void {
    const data = this.artworkNow();
    if (!data) {
      now.style.removeProperty('--art-rgb');
      return;
    }
    const cached = this.glow.get(data.slice(0, 64));
    if (cached) {
      now.style.setProperty('--art-rgb', cached);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const rgb = dominantRgbOf(img);
      if (!rgb) return;
      this.glow.set(data.slice(0, 64), rgb);
      // Re-read the element rather than closing over a stale one: a track can change while the
      // image decodes, and the node this was called with may no longer be in the page.
      const live = this.body.querySelector<HTMLElement>('.remote-now');
      if (live && this.artworkNow() === data) live.style.setProperty('--art-rgb', rgb);
    };
    img.src = `data:image/jpeg;base64,${data}`;
  }

  /**
   * The card's own label, and the one action that belongs to the *app* rather than the playback.
   *
   * ### Why the action is "Open on phone" and not "Open in Spotify"
   *
   * `apps.open.ask` is real, shipped and proven on 123 packages — and it **asks**. It posts a
   * notification the phone's owner taps; `main/apps.ts` says so on its own log line: *"whether it
   * opens is a tap on the phone, and this Mac will never know."* That is the whole reason the verb
   * is named `apps.open.ask` and `scripts/check-apps-verb.mjs` keeps `apps.launch` from existing.
   *
   * So a button reading *"Open in Spotify"* would promise the thing the measurement refused. The
   * verb is real, the label says what it does, and the tooltip says the rest.
   *
   * With no package — nothing playing, or a session whose owner the phone could not name — there is
   * nothing to ask about, so the slot degrades to a **non-interactive source label** rather than to
   * a dead button.
   */
  private header(): HTMLElement {
    const head = document.createElement('div');
    head.className = 'remote-head';

    const label = document.createElement('span');
    label.className = 'remote-label';
    label.textContent = 'Media remote';
    head.appendChild(label);

    const pkg = this.state.active ? this.state.package : undefined;
    if (!pkg || !this.bridge.appsOpenAsk) {
      const source = document.createElement('span');
      source.className = 'remote-source-label';
      source.textContent = this.state.active ? appPhrase(this.state, 'an app') : '';
      head.appendChild(source);
      return head;
    }

    const app = appPhrase(this.state, 'an app');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'remote-open';
    const text = document.createElement('span');
    text.textContent = 'Open on phone';
    open.append(text, iconSvg('detach', 13));
    open.title = `Ask your phone to offer ${app}. It opens when you tap the notification.`;
    open.setAttribute('aria-label', `Ask the phone to open ${app}`);
    open.addEventListener('click', () => {
      void this.run(
        this.bridge.appsOpenAsk!({ package: pkg }).then((r) => r as unknown as RemoteAck),
      );
    });
    head.appendChild(open);
    return head;
  }

  /**
   * The source-app badge, top of the card on the right.
   *
   * The reference puts it at the **card's** corner rather than overlaid on the artwork, which is
   * what is built here — the brief's prose said "overlaid on the artwork" and the image it points
   * at does not do that. The image wins because "match the reference exactly" is the instruction
   * the prose was describing; it is called out in the write-up rather than silently chosen.
   */
  private sourceBadge(): HTMLElement | null {
    // Nothing playing has no source, and a neutral disc in the corner of a fallback glyph is
    // furniture that reads as a logo at 26px. The empty state draws no badge at all.
    if (!this.state.active) return null;

    const wrap = document.createElement('div');
    wrap.className = 'remote-source';
    const data = this.appIcon();
    if (data) {
      const label = appPhrase(this.state, 'an app');
      wrap.title = label;
      wrap.setAttribute('aria-label', `Playing in ${label}`);
      wrap.appendChild(this.image(data));
      return wrap;
    }
    // No icon resolved, and the reference's own empty state draws exactly this: a neutral disc
    // with a music mark. It is not a placeholder for a missing picture — it is the picture for
    // "no particular app", which is a real state whenever nothing holds a session.
    wrap.classList.add('remote-source-none');
    wrap.appendChild(iconSvg('music', 13));
    return wrap;
  }

  /** Art on the left, title and artist stacked beside it. The one row every state draws. */
  private mainRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'remote-main';
    row.appendChild(this.art());
    row.appendChild(this.nowPlaying());
    return row;
  }

  /**
   * The cover, in the two states it can honestly be in.
   *
   * There is no grey placeholder here and there will not be one. A grey square makes "this session
   * has no cover" and "we could not load the cover" the same picture, which is the empty-versus-
   * failed collapse this repo has a whole proposal about. A podcast, a browser tab and a game all
   * hold perfectly good sessions with no art, so the fallback is a *drawn* state — the music mark —
   * and it claims nothing beyond what it knows.
   */
  private art(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'remote-art';
    const cover = this.artworkNow();
    if (cover) {
      wrap.appendChild(this.image(cover, 'image/jpeg'));
    } else {
      // Missing-data only. With a cover on the wire the <img> above is what draws; this is not the
      // default look, and it is a drawn state rather than a grey placeholder — a grey square makes
      // "this session has no art" and "we could not load the art" the same picture.
      wrap.classList.add('remote-art-none');
      wrap.appendChild(iconSvg('music', 38));
    }
    // The badge lives ON the cover, overlapping its top-right corner. The reference image floats it
    // at the card's corner instead; this follows the brief, which named that difference explicitly.
    const badge = this.sourceBadge();
    if (badge) wrap.appendChild(badge);
    return wrap;
  }

  /** A base64 image from the phone. `alt` is empty: text beside it already names the thing. */
  private image(data: string, mime = 'image/png'): HTMLImageElement {
    const img = document.createElement('img');
    img.src = data.startsWith('data:') ? data : `data:${mime};base64,${data}`;
    img.alt = '';
    return img;
  }

  private nowPlaying(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'remote-track';

    const title = document.createElement('div');
    title.className = 'remote-title';
    title.textContent = this.state.active ? (this.state.title ?? 'Untitled') : 'Nothing playing';
    wrap.appendChild(title);

    // Artist and album are separate fields on the wire and are joined only for display. An
    // absent one is dropped rather than drawn as an empty separator.
    const line = this.state.active
      ? [this.state.artist, this.state.album].filter(Boolean).join(' — ')
      : 'Play something on your phone to control it here.';
    if (line) {
      const sub = document.createElement('div');
      sub.className = 'remote-sub small';
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

    const bar = document.createElement('input');
    bar.className = 'remote-seek';
    bar.type = 'range';
    bar.min = '0';
    bar.max = String(duration || 1);
    bar.value = String(at ?? 0);
    bar.setAttribute('aria-label', 'Playback position');
    // A track with no duration cannot be scrubbed, and neither can a session that says it cannot
    // seek, and neither can silence. Disabled with the reason on it rather than live and ignored.
    const seekable = this.state.active && duration > 0 && this.state.canSeek !== false;
    bar.disabled = !seekable;
    if (!seekable && this.state.active) {
      bar.title =
        duration > 0
          ? remoteSeekDisabledTitleOf(this.state)
          : 'This track has no length the phone can report, so there is nothing to seek within.';
    }
    bar.addEventListener('pointerdown', () => {
      if (bar.disabled) return;
      this.scrubbing = true;
    });
    // The filled portion is a CSS gradient stop, so dragging repaints one property on one element.
    // It follows `input` rather than `change`, because a fill that only caught up on release would
    // lag the thumb the user is holding.
    bar.addEventListener('input', () => fillOf(bar));
    const commit = (): void => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      void this.run(this.bridge.remoteCommand('seek', { positionMs: Number(bar.value) }));
    };
    bar.addEventListener('pointerup', commit);
    bar.addEventListener('change', commit);
    fillOf(bar);

    // Times **below** the track, which is where the reference puts them, and it is the better of
    // the two: the track stays one uninterrupted line rather than being cut into three by a clock
    // at each end. `--:--` in the idle state, never `0:00` — a zero is a reading and there is none.
    const times = document.createElement('div');
    times.className = 'remote-times';

    const elapsed = document.createElement('span');
    elapsed.className = 'remote-elapsed';
    elapsed.textContent = this.state.active && at !== null ? clock(at) : '--:--';

    const total = document.createElement('span');
    total.className = 'remote-total';
    // Remaining, not total, and negative-signed the way every Apple transport writes it: the
    // question at 1:24 into a track is how much is left, and the total is implied by the bar.
    total.textContent =
      this.state.active && duration ? `-${clock(Math.max(0, duration - (at ?? 0)))}` : '--:--';

    times.append(elapsed, total);
    wrap.append(bar, times);
    return wrap;
  }

  private transport(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'remote-transport';

    const idle = !this.state.active;
    bar.appendChild(
      this.button(
        'Previous',
        'skip-back',
        'previous',
        idle || this.state.canSkipPrevious === false,
        'the previous track',
      ),
    );
    // One button, two verbs, because that is what the phone's `play_pause` is and what a person
    // reaches for. Its label *and its glyph* follow the state so it never claims the opposite of
    // what it does — the glyph is the half a person actually reads at this size.
    const playPause = this.button(
      this.state.playing ? 'Pause' : 'Play',
      this.state.playing ? 'pause' : 'play',
      'play_pause',
      idle,
      '',
    );
    playPause.classList.add('primary');
    bar.appendChild(playPause);
    bar.appendChild(
      this.button(
        'Next',
        'skip-forward',
        'next',
        idle || this.state.canSkipNext === false,
        'the next track',
      ),
    );
    return bar;
  }

  /**
   * One transport button, disabled where the session has said the action does nothing.
   *
   * **The label is still in the DOM, clipped rather than removed.** An icon-only button with no
   * text has no accessible name at all, and `aria-label` alone would take the pane's one testable
   * statement — *this button says Pause and not Play* — out of reach of the view test, which reads
   * `textContent`. So the word is a clipped span and the glyph sits beside it.
   *
   * It is deliberately **not** `.visually-hidden`: in this pane that class means "the reason this
   * control is unavailable", and `remoteView.test.ts` counts it to assert a live button has nothing
   * to explain. One class with two meanings is the collision that assertion exists to catch.
   *
   * **The click handler re-checks `disabled` itself**, which a real DOM would enforce anyway. It is
   * here because the view test's DOM double does not, so without it the guard that idle buttons
   * dispatch nothing would be asserting against a rule no test could reach — defect 67's lesson,
   * one layer down: move the write to where a test can see it.
   */
  private button(
    label: string,
    icon: string,
    action: string,
    unsupported: boolean,
    what: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'remote-button';
    // The clipped word first, so the accessible name and `textContent` both begin with the verb.
    const name = document.createElement('span');
    name.className = 'remote-button-label';
    name.textContent = label;
    button.appendChild(name);
    button.appendChild(iconSvg(icon, 18));
    button.dataset.action = action;
    button.disabled = unsupported;
    // An idle remote's buttons are disabled and carry no reason, because "nothing is playing" is
    // already the headline two lines above them. A tooltip repeating it would be noise; the
    // capability case below is different, because *why this one button is dead* is not on screen.
    if (unsupported && what) {
      // Was `appName ?? 'This app'`, which is defect 46's *other* wrong fix: safe, and it throws
      // away the only identifying information there is. The handle appears; it is never alone.
      const why = remoteSkipTitleOf(this.state, what);
      button.title = why;
      const spoken = document.createElement('span');
      spoken.className = 'visually-hidden';
      spoken.textContent = ` — unavailable: ${why}`;
      button.append(spoken);
    }
    button.addEventListener('click', () => {
      if (button.disabled) return;
      void this.run(this.bridge.remoteCommand(action));
    });
    return button;
  }

  /**
   * The output device row — **a readout, and it carries no chevron.**
   *
   * The reference draws one, and the brief asks for it "indicating it's tappable to switch
   * outputs". Nothing in this protocol switches the phone's audio route, and a chevron over a row
   * that cannot open anything is the affordance failure this project keeps ruling out — the same
   * reason `apps.launch` does not exist. Android's own output switcher is an activity, and this
   * handset refuses a backgrounded `startActivity` **silently** (Phase 7 Slice 8), so the route to
   * a real chevron is `apps.open.ask`'s shape — a notification the user taps — and that is a
   * feature, not a glyph. The row is styled to the reference in every other respect.
   */
  private outputRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'remote-output';

    const output = this.state.active ? this.state.output : undefined;
    row.appendChild(iconSvg(outputIconFor(output?.kind), 16));

    const name = document.createElement('span');
    name.className = 'remote-output-name';
    // Three states, three sentences. "No active device" is the idle one the reference names; a
    // playing session whose route the phone could not read gets its own line rather than being
    // folded into the idle one, because *we could not ask* and *there is nothing* are different.
    name.textContent = !this.state.active
      ? 'No active device'
      : (output?.name ?? 'Output device unknown');
    row.appendChild(name);

    // **No chevron — the Sidekick handoff (§5c).** Nothing in this protocol switches the phone's
    // audio route, so the output is a readout: no tabindex, no click handler, no dropdown mark.

    if (!this.state.active) row.classList.add('remote-output-idle');
    return row;
  }

  private volume(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'remote-volume';

    const max = this.state.volumeMax ?? 15;
    const live = this.state.active && this.state.volumeMax !== undefined;

    wrap.appendChild(iconSvg('volume-low', 15));

    const slider = document.createElement('input');
    slider.id = 'remote-volume-input';
    slider.className = 'remote-vol';
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(max);
    slider.value = String(this.state.volume ?? 0);
    slider.disabled = !live;
    // The label was a visible "Volume" beside the track. The slider now sits between two speaker
    // marks, which say the same thing in less room — but the accessible name it carried is not
    // optional, and moves here.
    slider.setAttribute('aria-label', 'Volume');
    // The number beside the maximum, not on its own: "7" says nothing without knowing it is out
    // of 15. Same rule as every other count in this project — it is the accessible reading here
    // rather than a drawn one, because the reference draws no number and the rule is about what a
    // person can find out, not about pixels.
    slider.setAttribute('aria-valuetext', `${this.state.volume ?? 0} of ${max}`);
    slider.addEventListener('input', () => fillOf(slider));
    slider.addEventListener('change', () => {
      if (slider.disabled) return;
      void this.run(this.bridge.remoteCommand('volume_set', { volume: Number(slider.value) }));
    });
    fillOf(slider);
    wrap.appendChild(slider);

    /*
     * The percentage, drawn — and it is a different thing from the "7 of 15" this pane used to
     * print. A raw step count needs its maximum beside it or it says nothing; **a percentage
     * carries its own denominator**, which is the whole of why the rule that governs the first one
     * does not govern this. `aria-valuetext` keeps the step form for a reader who wants the
     * granularity, so neither audience loses anything.
     *
     * Drawn only when the phone reported a maximum. A percentage computed from a guessed 15 would
     * be a number about nothing.
     */
    if (live) {
      const reading = document.createElement('span');
      reading.className = 'remote-volume-read mono';
      reading.textContent = `${Math.round(((this.state.volume ?? 0) / max) * 100)}%`;
      wrap.appendChild(reading);
    }
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

/** The icon for an output kind. A closed map over a closed set — the phone classifies, not us. */
function outputIconFor(kind: string | undefined): string {
  switch (kind) {
    case 'bluetooth':
      return 'airpods';
    case 'headphones':
      return 'headphones';
    case 'speaker':
      return 'volume-high';
    default:
      // Covers both `unknown` (asked, no icon for it) and absent (could not ask). They differ in
      // the *sentence* beside this glyph, which is where the distinction is worth drawing; a third
      // icon for "we could not read the route" would be a picture nobody can interpret.
      return 'phone';
  }
}

/**
 * The cover's dominant colour, as an `"r, g, b"` triplet — or null if it cannot be read.
 *
 * Deliberately crude, and crude is correct here: this feeds a glow at 22% alpha behind a card, not
 * a palette. It averages a 16×16 downscale, weighting by saturation so a cover that is 80% black
 * border and 20% album still glows the album's colour rather than a dark grey — an unweighted mean
 * of almost any sleeve is mud.
 *
 * Returns null rather than a default when the canvas is unreadable, so the caller falls back to the
 * accent in CSS instead of this function inventing a neutral that would read as a real reading.
 */
function dominantRgbOf(img: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (!context) return null;
  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(img, 0, 0, 16, 16);
    pixels = context.getImageData(0, 0, 16, 16).data;
  } catch {
    // A tainted or zero-sized canvas. Nothing to report to the user: the glow is decoration and
    // its absence is the accent, which is a perfectly good card.
    return null;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const pr = pixels[i]!;
    const pg = pixels[i + 1]!;
    const pb = pixels[i + 2]!;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    // Saturation times brightness: a near-grey contributes almost nothing, and so does near-black.
    const w = (max - min) * (max / 255) + 1;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }
  if (weight === 0) return null;
  return `${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)}`;
}

/**
 * Write a range input's filled fraction onto the element as `--fill`, for the CSS gradient to stop
 * at.
 *
 * One expression of the fill, in one place, read by both sliders and by the tick. The alternative —
 * a second painted element sized to the value — is two things that have to agree about a number,
 * which is the shape of half the defects in this repo.
 *
 * A zero-width range (`min === max`) would divide by zero; it reads as full rather than as NaN,
 * because a single-valued scrubber is at its end by definition.
 */
function fillOf(input: HTMLInputElement): void {
  const min = Number(input.min) || 0;
  const span = (Number(input.max) || 0) - min;
  const fraction = span > 0 ? (Number(input.value) - min) / span : 1;
  const clamped = Math.max(0, Math.min(1, fraction));
  input.style.setProperty('--fill', `${(clamped * 100).toFixed(2)}%`);
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
(globalThis as Record<string, unknown>).remoteFillOf = fillOf;
