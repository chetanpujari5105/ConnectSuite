/**
 * The app shell: sidebar, nav pill, status island, page header, dock, ⌘K palette, toast, and the
 * connected-device strip.
 *
 * ### What this file is and is not
 *
 * It draws the frame and routes between screens. It holds no protocol knowledge, opens no socket
 * and decides nothing about a feature — every screen's contents belong to that screen's view
 * (`MirrorView`, `NotificationsView`, …) and `renderer.ts` is what wires the two together.
 *
 * Its *decisions* — which screens exist, in what order, which are honest, what the palette ranks
 * first — are all in `navModel.ts`, which is pure and tested. This file is the DOM half and is
 * deliberately thin on judgement: if a rule here has a right answer, it belongs one file over.
 *
 * ### The nav pill is measured, never computed
 *
 * The handoff is explicit and gives the reason: group headers and the notifications badge change
 * the row rhythm, so a pill positioned from an assumed pitch desynchronises. [movePill] reads the
 * target row's live `offsetTop` at the moment it moves. It is also re-measured on resize and after
 * the sidebar scrolls, because both change the number it read.
 *
 * ### Two things it deliberately does not do
 *
 * It never invents a value. The device battery is `—` rather than the handoff's "79%": the phone
 * declares `battery.state` in `docs/protocol.md` and nothing subscribes to it yet, so there is no
 * number to show and a plausible one is worse than a dash. The island cycles only events that
 * actually happened.
 *
 * It never draws an unbuilt screen as though it were empty. Five of the eleven sidebar rows have
 * nothing behind them; each draws its `unbuiltReason`, which names the phase and the missing piece.
 *
 * Plain script, not a module — the CSP-locked page has no module loader.
 */

/*
 * No imports and no `declare` re-statements. Every one of these files is a plain script, so tsc
 * puts them in one global scope: `iconSvg` and `brandGlyph` from icons.ts, and `SCREENS`,
 * `PAIRING_SCREEN`, `DOCK`, `TOOL_RAIL`, `GLOBAL_ACTIONS`, `paletteResults`, `screenById` and
 * `pillOffsetFor` from navModel.ts are simply in scope here.
 *
 * Re-declaring them would compile — for exactly as long as the two copies agreed. The point of the
 * split is that navModel.ts is the one definition and this file cannot hold a second.
 */

/** What the shell needs to know about the link. A narrowing of RendererStatus, on purpose. */
interface ShellStatus {
  phase: string;
  deviceName?: string;
  address?: string;
  via?: string;
  rttMs?: number;
  lastError?: string;
  paired: boolean;
}

/** live / working / down / idle — the four the dots, chips and island all read. */
type LinkTone = 'live' | 'working' | 'down' | 'idle';

function toneOf(status: ShellStatus | null): LinkTone {
  if (!status) return 'idle';
  if (status.phase === 'connected') return 'live';
  if (status.phase === 'searching' || status.phase === 'connecting' || status.phase === 'handshaking') {
    return 'working';
  }
  if (status.phase === 'reconnecting') return 'working';
  if (!status.paired) return 'idle';
  return status.lastError ? 'down' : 'idle';
}

function toneLabel(status: ShellStatus | null): string {
  if (!status) return 'Starting…';
  switch (status.phase) {
    case 'connected':
      return 'Connected';
    case 'searching':
      return 'Looking for phone';
    case 'connecting':
    case 'handshaking':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    default:
      return status.paired ? 'Disconnected' : 'Not paired';
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

class ShellView {
  private current = 'overview';

  /**
   * Called after a screen becomes visible, with its id.
   *
   * Exists so a pane can fetch when it is opened rather than at launch. Photos is the first that
   * needs it: pulling 12 albums and a page of thumbnails on startup would spend a round trip and a
   * megabyte on a screen nobody has looked at. The shell still decides nothing about the feature —
   * it says *this screen is now showing*, and the view decides what that means.
   */
  private routeListeners: Array<(id: string) => void> = [];
  private status: ShellStatus | null = null;
  private paletteIndex = 0;
  private paletteRows: PaletteResult[] = [];
  private toastTimer: number | undefined;
  private readonly navRows = new Map<string, HTMLButtonElement>();
  private readonly commands = new Map<string, () => void>();
  private readonly settingsPanes = new Map<string, () => HTMLElement>();
  private settingsPane = 'connection';

  /**
   * Session events, newest last, for the island to cycle.
   *
   * Only real events go in. The handoff's island cycles "Clipboard synced" and "Transfer complete ·
   * 4.2 MB"; neither feature exists, so neither string does. An island that narrates transfers this
   * app cannot perform is the most visible possible version of the thing decision 6 forbids.
   */
  private readonly events: string[] = [];
  private eventIndex = 0;
  private islandTimer: number | undefined;

  constructor() {
    this.buildBrand();
    this.buildNav();
    this.buildDock();
    this.buildToolbarIcons();
    this.buildMirrorControls();
    this.bindPalette();
    this.bindWindow();
    this.route('overview');
    this.startIsland();
  }

  // ---- Sidebar -------------------------------------------------------------------------------

  private buildBrand(): void {
    $('brand-glyph').replaceChildren(brandGlyph(24));
    $('device-icon').replaceChildren(iconSvg('phone', 16));
  }

  private buildNav(): void {
    const nav = $('nav');
    const pill = $('nav-pill');
    // The pill is the one child that survives a rebuild: it is positioned over the rows, not
    // between them.
    nav.replaceChildren(pill);

    let group: string | null = null;
    for (const screen of SCREENS) {
      if (screen.group !== group) {
        group = screen.group;
        const header = document.createElement('div');
        header.className = `group-header${group === 'SYSTEM' ? ' system' : ''}`;
        header.textContent = group === 'MENU' ? 'Menu' : 'System';
        nav.appendChild(header);
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `nav-row${screen.state === 'unbuilt' ? ' unbuilt' : ''}`;
      row.dataset.nav = screen.id;
      row.appendChild(iconSvg(screen.icon, 20));

      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = screen.label;
      row.appendChild(label);

      if (screen.id === 'notifications') {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.id = 'nav-badge-notifications';
        badge.hidden = true;
        row.appendChild(badge);
      }

      // The dimming is a colour and the dot is a shape; neither is reachable by a screen reader,
      // so the state goes in the accessible name too. Same rule as the capability chips (defect 26).
      row.setAttribute(
        'aria-label',
        screen.state === 'unbuilt' ? `${screen.label} — not built yet` : screen.label,
      );
      row.addEventListener('click', () => this.route(screen.id));
      nav.appendChild(row);
      this.navRows.set(screen.id, row);
    }

    const spacer = document.createElement('div');
    spacer.className = 'nav-spacer';
    nav.appendChild(spacer);

    // The pill's number goes stale whenever the rows move under it.
    nav.addEventListener('scroll', () => this.movePill());
  }

  /**
   * Slide the pill to the current row, from that row's live `offsetTop`.
   *
   * Read at the moment of moving rather than cached: the nav scrolls, the badge appears and
   * disappears with the notification count, and the window resizes. A cached offset is correct
   * until the first of those happens.
   */
  private movePill(): void {
    const pill = $('nav-pill');
    const row = this.navRows.get(this.current);
    if (!row) {
      // Pairing has no row. Nothing to point at, so nothing is drawn — a pill parked at the top
      // would read as "Overview is selected".
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    pill.style.transform = `translateY(${pillOffsetFor(row.offsetTop)}px)`;
  }

  // ---- Dock, toolbar, mirror controls ---------------------------------------------------------

  private buildDock(): void {
    const dock = $('dock');
    dock.replaceChildren();
    for (const tile of DOCK) {
      const slot = document.createElement('div');
      slot.className = 'dock-slot';

      /*
       * Two of the design's five dock tiles — Files and Camera — lead to screens with nothing
       * behind them. State A says "nothing routes to it that implies it works", and a full-colour
       * dock tile is the strongest such implication in the app.
       *
       * The tile is kept and **marked** rather than removed. Removing two would leave a three-tile
       * dock, which is a change to the design's own composition for a reason that expires as each
       * phase lands; a desaturated tile whose tooltip reads "Files — not built yet" carries the
       * same information without reflowing the dock every time a feature ships. Recorded as a
       * deliberate deviation from my own state-A note in docs/design-departures.md.
       */
      const target = screenById(tile.id);
      const unbuilt = target?.state === 'unbuilt';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dock-tile${unbuilt ? ' unbuilt' : ''}`;
      button.style.setProperty('--dock-tint', tile.tint);
      button.setAttribute('aria-label', unbuilt ? `${tile.label} — not built yet` : tile.label);
      button.appendChild(iconSvg(tile.icon, 17));
      button.addEventListener('click', () => this.route(tile.id));

      const tip = document.createElement('span');
      tip.className = 'dock-tip';
      tip.textContent = unbuilt ? `${tile.label} — not built yet` : tile.label;

      slot.append(button, tip);
      dock.appendChild(slot);
    }
  }

  private buildToolbarIcons(): void {
    $('tb-search-icon').replaceChildren(iconSvg('search', 14));
    $('tb-device-icon').replaceChildren(iconSvg('device-settings', 15));
    $('tb-detach-icon').replaceChildren(iconSvg('detach', 15));
    $('tb-dots-icon').replaceChildren(iconSvg('dots', 16));
    $('palette-icon').replaceChildren(iconSvg('search', 16));

    $('open-palette').addEventListener('click', () => this.openPalette());
    // Both of these go to the same place, which is what the design's two buttons mean here: one
    // is the phone's connection settings and the other is the overflow, and we have one Settings
    // screen with a Connection pane on it.
    $('open-device-settings').addEventListener('click', () => this.route('settings', 'connection'));
    $('open-overflow').addEventListener('click', () => this.route('settings', 'advanced'));
  }

  /**
   * The Mirror tool rail and the six global actions, from `navModel` so their icon names sit
   * inside the enumeration `navModel.test.ts` asserts over.
   *
   * The rail's readout is written in the HTML and kept: it is a value, not a command, and putting
   * it in the table would mean the table carried an entry with no icon.
   */
  private buildMirrorControls(): void {
    const rail = $('tool-rail');
    const readout = rail.querySelector('.readout');
    const tools = TOOL_RAIL.map((tool) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `mirror-${tool.id}`;
      button.className = 'tool';
      const glyph = document.createElement('span');
      glyph.className = 'tool-glyph';
      glyph.appendChild(iconSvg(tool.icon, 18));
      const label = document.createElement('span');
      label.className = 'tool-label';
      label.textContent = tool.label;
      button.append(glyph, label);
      return button;
    });
    rail.replaceChildren(...tools, ...(readout ? [readout] : []));

    const row = $('input-row');
    row.replaceChildren();
    for (const action of GLOBAL_ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `input-${action.id}`;
      button.className = 'global';
      button.appendChild(iconSvg(action.icon, 16));
      const label = document.createElement('span');
      label.className = 'global-label';
      label.textContent = action.label;
      button.appendChild(label);
      row.appendChild(button);
    }
  }

  // ---- Routing --------------------------------------------------------------------------------

  /**
   * Show one screen.
   *
   * Refuses to leave the pairing screen while the phone is unpaired. That is a gate, not a
   * suggestion: the design has no unpaired state at all, so every other screen would describe a
   * phone this Mac has never met — Overview most of all, whose whole content is that phone. It
   * says so in the island rather than no-opping silently.
   */
  route(id: string, settingsPane?: string): void {
    if (this.status && !this.status.paired && id !== 'pairing') {
      this.setIsland('Pair a phone first — there is nothing to show until you do.', 'working');
      return;
    }
    const screen = screenById(id);
    if (!screen) return;

    this.current = id;
    if (settingsPane) this.settingsPane = settingsPane;

    document.querySelectorAll<HTMLElement>('.screen').forEach((section) => {
      section.hidden = section.dataset.screen !== id;
    });
    for (const [rowId, row] of this.navRows) {
      if (rowId === id) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    }

    $('page-title').textContent = screen.title;
    $('page-sub').textContent = screen.subtitle;
    document.querySelector('.app-window')!.setAttribute('data-screen', id);

    if (screen.state === 'unbuilt') this.drawUnbuilt(screen);
    if (id === 'settings') this.drawSettings();

    this.movePill();
    this.replayEntrance();
    for (const listener of this.routeListeners) listener(id);
  }

  /** Register a listener for [route]. See [routeListeners]. */
  onRoute(listener: (id: string) => void): void {
    this.routeListeners.push(listener);
  }

  /** Re-trigger the 260ms page-in. Removing and re-adding the class in two frames is what makes
   *  the animation restart; setting it once only ever plays on first paint. */
  private replayEntrance(): void {
    const page = $('page');
    page.classList.remove('route-in');
    void page.offsetWidth;
    page.classList.add('route-in');
    page.scrollTop = 0;
  }

  /**
   * The empty state for a screen with nothing behind it.
   *
   * The reason comes from `navModel` and names a phase and a missing piece. A screen that draws a
   * spinner, or nothing, or "coming soon", is indistinguishable from one that is broken — which is
   * decision 6 failing at the largest possible scale, a whole screen at a time.
   */
  /**
   * **State A — unbuilt**, per `docs/mac-ui-design-proposals.md` §3.
   *
   * The four nothing-here states must not look alike; using one pattern for all four is defect
   * 24/26's shape one layer up, where an empty list and an ungranted permission are indistinguishable.
   * This is the one for "the feature has no protocol in this build", and its distinguishing marks
   * are deliberate:
   *
   * - **Elevation 2, never 3.** One primary card per screen is the handoff's rule, and a pane with
   *   nothing in it must not claim the screen's heaviest surface. The nothing reads lighter than
   *   the something next door.
   * - **Neutral, never `--warning` and never `--destructive`.** An unwritten feature has not failed
   *   and is not a permission problem. The first version of this card used `--warning` on its tag,
   *   which is state B's colour — it would have made five screens read as "something is wrong"
   *   rather than "this was never written".
   * - **A mono handle at the foot** naming the wire namespace that does not exist. That is the
   *   package-id rule applied in the direction it points: a handle may appear, never as the only
   *   thing a user reads. The sentence above it is what a person reads.
   * - **~300px**, so it reads as a note rather than as a pane that failed to fill.
   */
  private drawUnbuilt(screen: NavScreen): void {
    const host = document.querySelector<HTMLElement>(`.screen[data-screen="${screen.id}"]`);
    if (!host) return;

    const card = document.createElement('div');
    card.className = 'unbuilt-screen';

    const mark = document.createElement('span');
    mark.className = 'unbuilt-mark';
    mark.appendChild(iconSvg(screen.icon, 40));

    const tag = document.createElement('div');
    tag.className = 'unbuilt-tag';
    tag.textContent = 'Not built yet';

    const headline = document.createElement('h2');
    headline.className = 'unbuilt-headline';
    headline.textContent = screen.unbuiltHeadline ?? '';

    const why = document.createElement('p');
    why.className = 'unbuilt-why';
    why.textContent = screen.unbuiltReason ?? '';

    const handle = document.createElement('p');
    handle.className = 'unbuilt-handle mono';
    handle.textContent = screen.unbuiltHandle ?? '';

    card.append(mark, tag, headline, why, handle);

    // The card is centred by a host that has a height to centre it in; see `.unbuilt-host`. The
    // section itself shrink-wraps to its content, so centring the card against the section alone
    // would centre it against its own height and move nothing.
    const centred = document.createElement('div');
    centred.className = 'unbuilt-host';
    centred.appendChild(card);
    host.replaceChildren(centred);
  }

  // ---- The status island ------------------------------------------------------------------------

  /**
   * Push a real session event onto the island's rota.
   *
   * Deduplicated against the last one so a reconnect loop does not fill the rota with one sentence
   * repeated eleven times, which would look like a cycling island that is in fact stuck.
   */
  note(text: string): void {
    if (this.events[this.events.length - 1] === text) return;
    this.events.push(text);
    if (this.events.length > 6) this.events.shift();
  }

  setIsland(text: string, tone: LinkTone): void {
    $('island-text').textContent = text;
    $('island-dot').setAttribute('data-state', tone);
  }

  /** ~5.2s per the handoff. Cycles the rota; with one event it simply holds it. */
  private startIsland(): void {
    this.islandTimer = window.setInterval(() => {
      if (this.events.length === 0) return;
      this.eventIndex = (this.eventIndex + 1) % this.events.length;
      this.setIsland(this.events[this.eventIndex]!, toneOf(this.status));
    }, 5200);
  }

  // ---- Toast -------------------------------------------------------------------------------------

  toast(text: string): void {
    const host = $('toast');
    $('toast-text').textContent = text;
    host.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      host.hidden = true;
    }, 2400);
  }

  // ---- ⌘K ------------------------------------------------------------------------------------------

  /** Wire a palette command id to what it does. `renderer.ts` owns the doing. */
  onCommand(id: string, run: () => void): void {
    this.commands.set(id, run);
  }

  private bindPalette(): void {
    const input = $<HTMLInputElement>('palette-input');
    input.addEventListener('input', () => this.drawPalette(input.value));
    $('palette').addEventListener('mousedown', (event) => {
      if (event.target === $('palette')) this.closePalette();
    });
  }

  private bindWindow(): void {
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.openPalette();
        return;
      }
      if ($('palette').hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveSelection(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.runSelected();
      }
    });

    // The pill's offset is a layout measurement, so it is re-read whenever layout changes.
    window.addEventListener('resize', () => this.movePill());
  }

  private openPalette(): void {
    $('palette').hidden = false;
    const input = $<HTMLInputElement>('palette-input');
    input.value = '';
    this.drawPalette('');
    input.focus();
  }

  private closePalette(): void {
    $('palette').hidden = true;
  }

  private drawPalette(query: string): void {
    this.paletteRows = paletteResults(query);
    this.paletteIndex = 0;
    const host = $('palette-results');
    host.replaceChildren();

    if (this.paletteRows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'palette-empty';
      empty.textContent = `Nothing matches “${query}”.`;
      host.appendChild(empty);
      return;
    }

    this.paletteRows.forEach((result, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `palette-row${result.unbuilt ? ' unbuilt' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === this.paletteIndex));

      const tile = document.createElement('span');
      tile.className = 'palette-tile';
      const screen = screenById(result.id);
      tile.appendChild(iconSvg(result.kind === 'command' ? 'mirror' : screen?.icon ?? 'chevron', 15));

      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = result.label;

      const group = document.createElement('span');
      group.className = 'palette-group';
      // An unbuilt destination says so here rather than being dimmed and left to be guessed at.
      group.textContent = result.unbuilt ? 'Not built yet' : result.group;

      const key = document.createElement('span');
      key.className = 'palette-key mono';
      key.textContent = result.shortcut;

      row.append(tile, label, group, key);
      row.addEventListener('click', () => {
        this.paletteIndex = index;
        this.runSelected();
      });
      host.appendChild(row);
    });
  }

  private moveSelection(delta: number): void {
    if (this.paletteRows.length === 0) return;
    const count = this.paletteRows.length;
    this.paletteIndex = (this.paletteIndex + delta + count) % count;
    const rows = $('palette-results').querySelectorAll('.palette-row');
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === this.paletteIndex)));
    rows[this.paletteIndex]?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Run the highlighted row.
   *
   * A command with nothing wired to it does not fail silently: it says which command, in the
   * island. A palette that swallows a keystroke is the same shape as a check that does not gate —
   * the user sees the right row highlighted and nothing happens.
   */
  private runSelected(): void {
    const result = this.paletteRows[this.paletteIndex];
    if (!result) return;
    this.closePalette();
    if (result.kind === 'navigation') {
      this.route(result.id);
      return;
    }
    const run = this.commands.get(result.id);
    if (!run) {
      this.setIsland(`“${result.label}” is not wired up on this build.`, 'working');
      return;
    }
    run();
  }

  // ---- Live status ------------------------------------------------------------------------------

  /**
   * Everything in the chrome that reflects the link: sidebar device card, connected-device strip,
   * Overview hero, island tone.
   *
   * One function so the four cannot disagree. They are four views of one fact, and the last time
   * two views of one fact were fed separately in this codebase it was defect 27.
   */
  setStatus(status: ShellStatus | null): void {
    const wasPaired = this.status?.paired;
    this.status = status;

    const tone = toneOf(status);
    const label = toneLabel(status);
    const name = status?.deviceName ?? (status?.paired ? 'Phone' : 'No phone paired');
    const latency = status?.rttMs === undefined ? '—' : `${status.rttMs} ms`;

    $('device-name').textContent = name;
    $('device-state').textContent = label;
    $('device-dot').setAttribute('data-state', tone);
    /*
     * The handoff's device card, connected-device strip and hero all carry a battery percentage.
     * `battery.state` is declared in docs/protocol.md and **nothing subscribes to it**, so there is
     * no number to show.
     *
     * The slot is removed rather than filled with a dash. A lone "—" tucked between "Connected" and
     * a divider is a glyph with no label, which a reader has to decode instead of read — and the
     * one thing worse than an absent battery reading is one people cannot tell from a flat one. The
     * fact itself is not hidden: it is a line in Settings → Advanced, where facts live, and that
     * line says `not subscribed` rather than `0%`.
     */
    $('device-battery').hidden = true;
    $('strip-battery').hidden = true;
    $('strip-divider-battery').hidden = true;

    $('strip-name').textContent = name;
    $('strip-state-label').textContent = label;
    $('strip-dot').setAttribute('data-state', tone);
    $('strip-latency').textContent = latency;

    $('hero-name').textContent = name;
    $('hero-state').textContent = label;
    $('hero-dot').setAttribute('data-state', tone);
    $('hero-chip').setAttribute('data-state', tone);
    this.drawHeroFacts(status, latency);
    // The hero's primary action is only offered while the phone advertises mirroring, on the same
    // rule as the Mirror pane's own button: no button for a promise the phone has not made.
    ($('hero-mirror') as HTMLButtonElement).disabled = status?.phase !== 'connected';

    this.setIsland(status?.lastError ?? `${label}${status?.rttMs === undefined ? '' : ` · ${latency}`}`, tone);
    if (status?.phase === 'connected') this.note(`Connected · ${latency}`);
    if (status?.lastError) this.note(status.lastError);

    // Pairing is forced while unpaired and released the moment the phone is trusted, rather than
    // leaving the user on a pairing screen they have already finished with.
    if (status && !status.paired && this.current !== 'pairing') this.route('pairing');
    if (status?.paired && wasPaired === false) this.route('overview');
  }

  private drawHeroFacts(status: ShellStatus | null, latency: string): void {
    /*
     * The handoff's four: Connected via / Latency / Encryption / Signal.
     *
     * Three are kept. **Signal is cut** — nothing on the wire reports link quality, and a made-up
     * "Excellent" beside three measured values is the one lie that would make the other three
     * unreadable. Its slot goes to the address, which the discovery order (locked decision #4)
     * makes the most useful fact on this card when something is wrong.
     *
     * Encryption is not a placeholder: the transport is TLS 1.3 with pinned self-signed
     * certificates on both ends, and no plaintext fallback exists. It is the one claim on this
     * card that is true before the phone answers.
     */
    /*
     * The third field is whether the value is a *numeric* in the handoff's sense — "latency, byte
     * sizes, percentages, timestamps, IPs, window geometry, dialer digits, file names" — and it is
     * the only thing that puts a value in the mono face. It is a closed list with a stated reason
     * (proportional figures jitter as the value updates), so `last-known` and `TLS 1.3, pinned`
     * are prose and belong in the UI face. All four carried `.fact-value` and therefore the mono
     * face until docs/testing.md, "Measurement pass, third run", section 1.3.
     */
    const facts: [label: string, value: string, numeric: boolean][] = [
      ['Connected via', status?.via ?? '—', false],
      ['Latency', latency, true],
      ['Encryption', 'TLS 1.3, pinned', false],
      ['Address', status?.address ?? '—', true],
    ];
    const host = $('hero-facts');
    host.replaceChildren();
    for (const [label, value, numeric] of facts) {
      // The pair is one grid cell. A bare dt/dd pair in a two-column grid separates the label from
      // its value by the width of the card, which is a table, not a fact.
      const cell = document.createElement('div');
      cell.className = 'fact';
      const dt = document.createElement('dt');
      dt.className = 'fact-label';
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.className = numeric ? 'fact-value mono' : 'fact-value';
      dd.textContent = value;
      cell.append(dt, dd);
      host.appendChild(cell);
    }
  }

  /** The sidebar badge. Hidden at zero — a badge reading "0" is a count nobody needs. */
  setNotificationCount(count: number): void {
    const badge = document.getElementById('nav-badge-notifications');
    if (!badge) return;
    badge.hidden = count <= 0;
    badge.textContent = String(count);
    // The badge changes the row's height rhythm by nothing, but it changes its *content*, and the
    // pill is measured from the row. Re-measuring here costs one layout read per notification and
    // removes a whole class of "the pill drifted" bug.
    this.movePill();
  }

  // ---- Settings ----------------------------------------------------------------------------------

  /**
   * Register one Settings pane. `renderer.ts` supplies the bodies, because every one of them is
   * made of controls that talk to the main process.
   */
  addSettingsPane(id: string, label: string, sub: string, build: () => HTMLElement): void {
    this.settingsPanes.set(id, () => {
      const wrap = document.createElement('div');
      const title = document.createElement('h2');
      title.className = 'settings-title';
      title.textContent = label;
      const subtitle = document.createElement('p');
      subtitle.className = 'settings-sub';
      subtitle.textContent = sub;
      wrap.append(title, subtitle, build());
      return wrap;
    });
  }

  private drawSettings(): void {
    const rail = $('settings-rail');
    rail.replaceChildren();
    for (const [id] of this.settingsPanes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'settings-tab';
      tab.textContent = id.charAt(0).toUpperCase() + id.slice(1);
      tab.setAttribute('aria-current', String(id === this.settingsPane));
      tab.addEventListener('click', () => {
        this.settingsPane = id;
        this.drawSettings();
      });
      rail.appendChild(tab);
    }
    const build = this.settingsPanes.get(this.settingsPane);
    $('settings-body').replaceChildren(build ? build() : document.createElement('div'));
  }

  /** Redraw the open Settings pane. Called when the data behind it moves. */
  refreshSettings(): void {
    if (this.current === 'settings') this.drawSettings();
  }

  get screen(): string {
    return this.current;
  }
}

/**
 * One instance, in the global scope renderer.ts shares. It is created at parse time rather than on
 * DOMContentLoaded because index.html loads every script at the end of <body>, so the DOM this
 * constructor reads is already there — and a shell that builds one tick later would let
 * renderer.ts's first `render()` reach it before the nav exists.
 */
const shell = new ShellView();
