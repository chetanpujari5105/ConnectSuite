/**
 * The app shell: sidebar, nav pill, status island, page header, ⌘K palette, toast, and the
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
 * It never invents a value — and for the battery that used to mean *never shows one*. `battery.state`
 * had no subscriber when this was written; it has had one since `VitalsFeature` landed, and the
 * comment outlived the fact by a phase while three slots stayed `hidden` because of it. The rule is
 * unchanged and the input is not: the slots carry a real percentage when there is one, and are
 * removed — not dashed — when there is not. [batterySlot] holds that decision, beside the ring that
 * makes the same one for Overview.
 *
 * It never draws an unbuilt screen as though it were empty. Five of the eleven sidebar rows have
 * nothing behind them; each draws its `unbuiltReason`, which names the phase and the missing piece.
 *
 * Plain script, not a module — the CSP-locked page has no module loader.
 */

/** `shared/islandState.js`, loaded before this script. It holds the whole island rule. */
declare function islandState(
  link: {
    phase?: string;
    pairing?: { kind: 'unpaired' | 'paired' | 'repudiated' };
    paired?: boolean;
    rttMs?: number;
    lastError?: string | null;
    lastFailureKind?: string | null;
  } | null,
  work: { verb: string; subject: string } | null,
): { text: string; tone: LinkTone };

/*
 * No imports and no `declare` re-statements. Every one of these files is a plain script, so tsc
 * puts them in one global scope: `iconSvg` and `brandGlyph` from icons.ts, and `SCREENS`,
 * `PAIRING_SCREEN`, `TOOL_RAIL`, `GLOBAL_ACTIONS`, `paletteResults`, `screenById` and
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
  /** `LinkFailure.kind`. The island's only failure input; the sentence is for wider surfaces. */
  lastFailureKind?: string;
  paired: boolean;
  /**
   * Pairing as three states — the renderer's copy of `PairingHealth`. Declared inline rather than
   * imported because the renderer loads as plain <script> tags and cannot use `import`; that is the
   * same constraint `CLAUDE.md` records for hanging testable halves on `globalThis`.
   */
  pairing?: { kind: 'unpaired' | 'paired' | 'repudiated' };
}

/** live / working / down / idle — the four the dots, chips and island all read. */
type LinkTone = 'live' | 'working' | 'down' | 'idle';

/**
 * The tone rules, reached the one way that works in both places this file runs: in the browser
 * `shared/linkTone.js` is a plain <script> loaded before this one, so its declarations are already
 * on `globalThis`; under `node --test` there is no script tag, so it is `require`d. Same file
 * either way — an indirection, not a second implementation.
 */
const toneRules = (
  typeof module !== 'undefined'
    ? require('../shared/linkTone')
    : (globalThis as unknown as Record<string, unknown>)
) as {
  linkTone: (p: string | undefined, h: { kind: string } | undefined, l: boolean, e: string | undefined) => LinkTone;
  linkToneLabel: (p: string | undefined, h: { kind: string } | undefined, l: boolean) => string;
};

/**
 * `shared/deviceVitals.js`, loaded before this script. Reached the same way as [toneRules] and for
 * the same reason: under `node --test` there is no script tag, so it is `require`d.
 *
 * **Called rather than re-implemented.** Three slots each deciding for themselves what an unknown
 * battery looks like is three chances to disagree with the ring on Overview, which is the same fact
 * two inches away.
 */
const vitalsRules = (
  typeof module !== 'undefined'
    ? require('../shared/deviceVitals')
    : (globalThis as unknown as Record<string, unknown>)
) as {
  batterySlot: (
    state: { level: number | null; charging: boolean; capacityUnknown: boolean } | null,
    live: boolean,
  ) => { show: boolean; text: string; detail: string; tone: 'ok' | 'low' | 'unknown' };
};

/** One row of the hero's detail grid. */
interface HeroFact {
  icon: string;
  label: string;
  value: string;
  /** Mono + tabular figures. The handoff's closed list: latency, sizes, percentages, IPs, geometry. */
  numeric: boolean;
  /** Drops to --text-body. For a value that must be *available* without competing to be read. */
  advanced: boolean;
}

/**
 * What the Connection row says — **the transport, not the discovery route**.
 *
 * This row used to print `status.via` raw, which is how `last-known` reached a user's screen under
 * the word "Connected". That string is not a transport and never was: `via` is which rung of the
 * discovery order in locked decision #4 *found* the phone — last known IP, then the gateway, then
 * mDNS, then a typed address — and it is a fact about a lookup that finished, often minutes ago.
 * It is `CLAUDE.md`'s package-id rule one namespace over: an internal handle may appear as a
 * handle, never as the only thing a person reads.
 *
 * **"Local network", not "Local Wi-Fi", and the difference is the whole of the honesty here.**
 * Four of the five routes are the same transport — a TLS socket on the LAN, ports 42501-3 — and
 * nothing in this protocol distinguishes Wi-Fi from Ethernet on the Mac's side or from USB
 * tethering on the phone's. `net.state` is the type that would, and it is on the debt list with no
 * handler on either side. So "Wi-Fi" would be a guess rendered as a fact, which is the failure this
 * repo has a table about; "Local network" is the strongest claim the wire actually supports.
 *
 * Tailscale is genuinely a different transport and keeps its own name.
 */
function heroTransportOf(status: ShellStatus | null): string {
  if (status?.phase !== 'connected') return 'Not connected';
  if (status.via === 'tailscale') return 'Tailscale';
  return 'Local network';
}

function toneOf(status: ShellStatus | null): LinkTone {
  if (!status) return 'idle';
  // Delegates. The precedence — repudiation outranks the transport phase, a live session outranks
  // everything — has one home in src/shared/linkHealth.ts where a test can reach it. It was
  // written out here once and got wrong: the phase switch ran first, so a repudiated pairing drew
  // "Reconnecting" forever, which is the exact sentence the state exists to replace.
  return toneRules.linkTone(status.phase, status.pairing, status.paired, status.lastError);
}

function toneLabel(status: ShellStatus | null): string {
  if (!status) return 'Starting…';
  return toneRules.linkToneLabel(status.phase, status.pairing, status.paired);
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;


class ShellView {
  private current = 'overview';

  /**
   * The phone's last `battery.state`, or null before one arrives.
   *
   * Held rather than passed into [setStatus], because the two facts arrive on different messages at
   * different rates — a status heartbeat is seconds, a stationary battery can be an hour — so a
   * parameter would make every status update erase the battery until the next tick. Same reason
   * `main.ts` holds `lastBatteryState` rather than forwarding it blind.
   */
  private battery: { level: number | null; charging: boolean; capacityUnknown: boolean } | null = null;


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
  /**
   * Whether a pairing code can exist — `renderer.ts` tells the shell each time it draws the card,
   * so the header and the card move off one fact. Defaults true: before the first read there is no
   * reason to tell a person their Mac has no network.
   */
  private pairReachable = true;
  private paletteIndex = 0;
  /** What had focus when the palette opened — the Search button, or whatever ⌘K was pressed over. */
  private paletteReturnFocus: HTMLElement | null = null;
  private paletteRows: PaletteResult[] = [];
  private toastTimer: number | undefined;
  private readonly navRows = new Map<string, HTMLButtonElement>();
  private readonly commands = new Map<string, () => void>();
  private readonly settingsPanes = new Map<string, { label: string; build: () => HTMLElement }>();
  private settingsPane = 'connection';

  /**
   * The sidebar badge's number, kept so the Overview tile can read it.
   *
   * Read rather than recomputed: the tile and the badge are the same claim in two places, and two
   * places that count the same thing separately eventually disagree — which on this screen would
   * mean a dashboard tile and a sidebar badge showing different numbers of unread notifications.
   */
  private notificationCount = 0;

  /**
   * What this Mac is doing **right now**, or null. The island's only non-connection input.
   *
   * ### What was here, and why it is gone rather than filtered
   *
   * A six-slot ring of strings and a 5.2-second timer that cycled them into the pill. It had no
   * clock — `ActivityEvent.at` was dropped at the boundary and the ring was never cleared, on
   * disconnect or reconnect or anything else — so a line's maximum age was the whole session. And
   * the timer wrote the ring's *text* with the link's *tone* in one statement, so a refusal from
   * ten minutes ago cycled in green beside a strip reading `Connected · 12 ms`.
   *
   * History belongs to the Activity pane, which records all eleven categories and timestamps them.
   * The island shows current state, so it holds one nullable fact set by whoever starts the work
   * and cleared by whoever finishes it — see [setWork].
   */
  private work: { verb: string; subject: string } | null = null;

  constructor() {
    this.buildBrand();
    this.buildNav();
    this.buildToolbarIcons();
    this.buildMirrorControls();
    this.bindPalette();
    this.bindWindow();
    this.route('overview');
    this.renderIsland();
  }

  // ---- Sidebar -------------------------------------------------------------------------------

  private buildBrand(): void {
    // Both brand marks are markup now: the sidebar lockup (the mask from LOGOS/ plus the word) and
    // Settings' `main_logo.png` app tile (handoff §13). What is left here is the Settings aside's
    // shield and the device card's glyph — drawn once, because both sit in static markup.
    $('settings-shield').replaceChildren(iconSvg('shield', 16));
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
      // The pill follows the selected row and is lime; an unbuilt pane must not take the accent
      // (handoff §11 row 11), so the row says which it is and `shell.css` drops the tint.
      if (screen.state === 'unbuilt') row.dataset.unbuilt = 'true';
      row.dataset.nav = screen.id;
      row.appendChild(iconSvg(screen.icon, 16));

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

      /*
       * The dimming is a colour and the dot is a shape; neither is reachable by a screen reader, so
       * the state goes in the accessible name too. Same rule as the capability chips (defect 26).
       *
       * **And since 2026-09-16 the *reason* comes with it.** The row said `Camera — not built yet`
       * and stopped there; the sentence that names the phase and the missing piece —
       * `unbuiltReason`, which for Camera is *"needs a macOS Camera Extension, which is a signed
       * system extension and a distribution problem before it is a code problem"* — existed only on
       * the screen you reach by pressing the row. So the one question a dimmed row provokes could
       * only be answered by acting on it.
       *
       * It is on the `title` for a pointer and in the accessible name for everything else, which is
       * the ordering defect 118 established: `title` never fires on keyboard focus, so it is never
       * the only carrier.
       */
      const unbuiltReason = screen.state === 'unbuilt' ? screen.unbuiltReason : undefined;
      row.setAttribute(
        'aria-label',
        screen.state === 'unbuilt'
          ? `${screen.label} — not built yet${unbuiltReason ? `. ${unbuiltReason}` : ''}`
          : screen.label,
      );
      if (unbuiltReason) row.title = `${screen.label} — not built yet. ${unbuiltReason}`;
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
    // An unbuilt pane's selected row is neutral, never the accent (handoff §11 row 11): lime says
    // "this works". The pill still moves and still marks the selection — only its fill changes.
    pill.dataset.unbuilt = String(screenById(this.current)?.state === 'unbuilt');
    pill.style.transform = `translateY(${pillOffsetFor(row.offsetTop)}px)`;
  }

  // ---- Toolbar and mirror controls --------------------------------------------------------------

  private buildToolbarIcons(): void {
    // The hero phone's two state marks, drawn once; CSS shows the one the card's state asks for.
    $('hero-phone-badge').replaceChildren(iconSvg('link-minus', 12));
    $('hero-phone-spinner').replaceChildren(iconSvg('spinner', 18));
    $('tb-search-icon').replaceChildren(iconSvg('search', 14));
    $('tb-device-icon').replaceChildren(iconSvg('device-settings', 14));
    $('tb-detach-icon').replaceChildren(iconSvg('detach', 14));
    $('palette-icon').replaceChildren(iconSvg('search', 16));

    $('open-palette').addEventListener('click', () => this.openPalette());
    // Device settings opens Settings on its Connection pane. The Figma header carries exactly two
    // controls, Search and Device settings; the overflow button that routed to Advanced is gone,
    // and Advanced stays one click away in the Settings rail.
    $('open-device-settings').addEventListener('click', () => this.route('settings', 'connection'));
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
  /**
   * Every page subtitle, in one place.
   *
   * Two of the twelve are facts rather than labels — Overview's is the link's tone and pairing's is
   * whether a code can exist — and both were static `SCREENS` sentences that contradicted the pane
   * beneath them. Routed through here so there is one writer of `#page-sub`: the alternative is a
   * second caller assigning it from another source on another clock, which is the status island's
   * defect and the reason that surface was rebuilt.
   */
  private subtitleFor(id: string, fallback: string): string {
    // Under the trial's screen the pane is not drawn, so its subtitle would describe something absent
    // ("Pair a phone to get started" on a paired Mac whose link the trial stopped). The trial says it.
    if (this.trialCovers(id)) return this.trialSubtitle();
    if (id === 'overview') return overviewSubtitle(toneOf(this.status));
    if (id === 'pairing') return pairingSubtitle(this.pairReachable);
    return fallback;
  }

  /** Told by `renderer.ts` whenever the pairing card changes shape. Redraws only if it is on screen. */
  setPairReachable(reachable: boolean): void {
    this.pairReachable = reachable;
    if (this.current === 'pairing') $('page-sub').textContent = this.subtitleFor('pairing', '');
  }

  route(id: string, settingsPane?: string): void {
    const blocked = this.status
      ? (this.status.pairing ? this.status.pairing.kind !== 'paired' : !this.status.paired)
      : false;
    if (blocked && id !== 'pairing') {
      // The toast, not the island. This is an answer to a click — true for the two seconds after
      // the user pressed something — and the island now holds current state only, which for an
      // unpaired Mac is already `No phone paired` in the pill they are looking at.
      this.toast('Pair a phone first — there is nothing to show until you do.');
      return;
    }
    const screen = screenById(id);
    if (!screen) return;

    this.current = id;
    // Told to the main process so the native notifier can tell "focused on the notifications pane"
    // from "focused on Files" — two situations that must not be suppressed alike.
    connect.routeChanged(id);
    if (settingsPane) this.settingsPane = settingsPane;

    this.applyTrialGate();
    for (const [rowId, row] of this.navRows) {
      if (rowId === id) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    }

    // Overview's title is the only one that depends on when it is drawn, so it is computed at
    // route time rather than read out of SCREENS. See `overviewTitle` for why it carries no name.
    $('page-title').textContent = id === 'overview' ? overviewTitle() : screen.title;
    $('page-sub').textContent = this.subtitleFor(id, screen.subtitle);
    document.querySelector('.app-window')!.setAttribute('data-screen', id);

    if (screen.state === 'unbuilt') this.drawUnbuilt(screen);
    if (id === 'settings') this.drawSettings();

    this.movePill();
    this.replayEntrance();
    for (const listener of this.routeListeners) listener(id);
  }

  /**
   * The beta trial's screen (2026-10-12, `trial.ts`): told which routes it covers, and re-applied on
   * every route and every verdict. One writer of which section is visible — here — so the trial screen
   * and a pane can never both show.
   */
  private trialCovers: (id: string) => boolean = () => false;
  private trialSubtitle: () => string = () => '';

  setTrialGate(covers: (id: string) => boolean, subtitle: () => string): void {
    this.trialCovers = covers;
    this.trialSubtitle = subtitle;
    this.applyTrialGate();
  }

  applyTrialGate(): void {
    const covered = this.trialCovers(this.current);
    const gate = document.getElementById('trial-gate');
    if (gate) gate.hidden = !covered;
    document.querySelectorAll<HTMLElement>('.screen').forEach((section) => {
      section.hidden = covered || section.dataset.screen !== this.current;
    });
    const sub = document.getElementById('page-sub');
    const screen = screenById(this.current);
    if (sub && screen) sub.textContent = this.subtitleFor(this.current, screen.subtitle);
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

    /*
     * **The one control, and it is real** (handoff §6 Camera): *"No preview, no disabled Start, no
     * 'coming soon'. The one control is a route to Mirror, which is real."* A route is not a
     * consolation prize here — the thing somebody wants a phone camera on a Mac for is usually to
     * see the phone, and mirroring does that today.
     */
    if (screen.unbuiltRoute) {
      const route = screen.unbuiltRoute;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'button unbuilt-action';
      action.textContent = route.label;
      action.addEventListener('click', () => this.route(route.screen));
      card.appendChild(action);
    }

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
   * Say that a piece of work has started, or that it has finished.
   *
   * The contract is the whole of it: **the caller that starts the work clears it**, in a `finally`,
   * so the island cannot outlive the thing it describes. Nothing expires on a timer, because a line
   * that keeps talking after its subject is over is the defect this file just lost — whether it
   * lasts five seconds or the rest of the session.
   *
   * A clipboard sync is deliberately not one of these. `clip-send` is a request and its reply and
   * `clip-arrived` is an instant; neither has a duration, so both are history the moment they
   * exist. They go to Activity, and the toast gives them the acknowledgement a moment deserves.
   */
  setWork(work: { verb: string; subject: string } | null): void {
    this.work = work;
    this.renderIsland();
  }

  /**
   * **The island's only writer.**
   *
   * It takes no arguments and returns nothing: everything it draws is computed by `islandState`
   * from `this.status`, using the same `linkTone` and `linkToneLabel` the strip, the device card
   * and the hero call. There is no way to tell this function what to say, which is the point — the
   * old defect was a second writer on a 5.2-second timer, sourcing text from a history ring and
   * tone from the live link, so the pill routinely asserted a connection state the strip denied.
   *
   * Called from exactly two places: [setStatus] and [setWork]. If a third appears, it is a line
   * that is not current state, and its home is the toast or the Activity pane.
   */
  private renderIsland(): void {
    const island = islandState(this.status, this.work);
    const text = $('island-text');
    // Words and dot are written together, synchronously, every time — the island is never allowed
    // to show one moment's words beside another moment's tone (defect 96). The first version of
    // this cross-fade deferred the words by half a beat and `shellIsland.test.ts` caught exactly that.
    text.textContent = island.text;
    $('island-dot').setAttribute('data-state', island.tone);
    const toneChanged = this.islandTone !== undefined && this.islandTone !== island.tone;
    this.islandTone = island.tone;
    // Only a tone change fades — a latency tick rewrites these words every few seconds, and a fade
    // there would be constant motion. The new words are already in place; they arrive from 0.
    if (!toneChanged) return;
    text.classList.add('is-arriving');
    void text.offsetWidth; // commit opacity 0 before releasing it, or the transition has no start
    text.classList.remove('is-arriving');
  }

  /** Tone last painted, so a tone change can be told from a latency tick. */
  private islandTone: string | undefined;

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

  /**
   * Run a wired command by id, from anywhere that is not the palette.
   *
   * One registration, several triggers. An accelerator that called the feature directly would be a
   * second path to the same action, and the two drift the first time one of them grows a guard —
   * which is the whole of defect 122's *"do not write a second accelerator table"*.
   *
   * An unwired id says so rather than doing nothing, on the same rule `runSelected` follows: a
   * keystroke that is swallowed is indistinguishable from a keystroke that was not received.
   */
  runCommand(id: string): void {
    const run = this.commands.get(id);
    if (!run) {
      this.toast(`That shortcut is not wired up on this build (${id}).`);
      return;
    }
    run();
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
      /*
       * ⌘⇧M, ⌘⇧. and ⌘⇧T are **not** handled here (defects 123 and 122). They are the application
       * menu's accelerators, built from the palette's own `COMMANDS` and run through `runCommand`
       * (`appMenu.ts`, `renderer.ts`), so the key is consumed before the page — the mirror canvas,
       * which forwards keystrokes to the phone, included — and there is one owner per printed key.
       * None is a `globalShortcut`: taking a key from every other application is not this app's to do.
       */

      if ($('palette').hidden) return;
      // aria-modal promises the rest of the window is inert. The palette's one focusable control is
      // its input — rows are options reached by the arrow keys — so Tab has nowhere to go.
      if (event.key === 'Tab') {
        event.preventDefault();
        $('palette-input').focus();
      } else if (event.key === 'Escape') {
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

  /**
   * The one way the palette opens. The header's Search control and ⌘K both call this, so they open
   * the same dialog with the same focus, the same results and the same way back out.
   */
  /**
   * The one way the palette opens — and it is public because the macOS menu bar now owns ⌘K.
   * A menu accelerator is consumed by the menu, so the keydown handler below never sees it; the
   * item calls this instead, which is the same entry the header's Search control uses.
   */
  openPalette(): void {
    if ($('palette').hidden) {
      const active = document.activeElement as HTMLElement | null;
      this.paletteReturnFocus = active && active !== document.body ? active : null;
    }
    $('palette').hidden = false;
    $('open-palette').setAttribute('aria-expanded', 'true');
    const input = $<HTMLInputElement>('palette-input');
    input.value = '';
    this.drawPalette('');
    input.focus();
  }

  private closePalette(): void {
    if ($('palette').hidden) return;
    $('palette').hidden = true;
    $('open-palette').setAttribute('aria-expanded', 'false');
    $('palette-input').removeAttribute('aria-activedescendant');
    // Back to whatever opened it. A routed result then moves focus on by its own route; an Escape
    // leaves the user where they were rather than on <body>.
    const back = this.paletteReturnFocus;
    this.paletteReturnFocus = null;
    // An opener removed meanwhile is fine to call: focus() on a detached node is a no-op.
    back?.focus();
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
      this.markActiveOption();
      return;
    }

    this.paletteRows.forEach((result, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `palette-row${result.unbuilt ? ' unbuilt' : ''}`;
      row.id = `palette-option-${index}`;
      row.tabIndex = -1;
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
    this.markActiveOption();
  }

  /** The combobox's active option, for a screen reader: focus stays in the input throughout. */
  private markActiveOption(): void {
    const input = $('palette-input');
    if (this.paletteRows.length === 0) input.removeAttribute('aria-activedescendant');
    else input.setAttribute('aria-activedescendant', `palette-option-${this.paletteIndex}`);
  }

  /**
   * Route to a screen and bring one card inside it into view.
   *
   * The flash is not decoration. A palette row that routes to Overview and stops has, from the
   * user's side, done nothing distinguishable from a row that failed — the screen they were
   * looking for a feature on is the screen they now see, with no indication of which part of it
   * answered. `runSelected` already refuses that failure for commands with nothing wired to them;
   * this is the same refusal for a destination that is a card rather than a screen.
   *
   * It says so when the target is missing, for the same reason. An id that no longer exists is a
   * silently dead palette row, and `navModel.test.ts` asserts every `reveal` is a real id — but a
   * test over the model cannot see an element deleted from `index.html`, so the runtime says it
   * too.
   */
  private revealInScreen(
    screen: string | undefined,
    reveal: string | undefined,
    settingsPane?: string,
  ): void {
    if (!screen || !reveal) return;
    // `settingsPane` is passed through rather than set afterwards: Settings swaps its body instead
    // of scrolling it, so routing and then selecting would draw the previous pane first and the
    // reveal would fire against whichever card happened to be under the flash.
    this.route(screen, settingsPane);
    // After the route, so the section is no longer `hidden` — a hidden element cannot be scrolled
    // into view and reports no geometry, which is the measurement fault CLAUDE.md records against
    // the photo grid, here as a behaviour rather than as a reading.
    window.requestAnimationFrame(() => {
      const target = document.getElementById(reveal);
      if (!target) {
        this.toast(`Nothing on this screen is called “${reveal}” any more`);
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('deep-reveal');
      window.setTimeout(() => target.classList.remove('deep-reveal'), 1400);
    });
  }

  private moveSelection(delta: number): void {
    if (this.paletteRows.length === 0) return;
    const count = this.paletteRows.length;
    this.paletteIndex = (this.paletteIndex + delta + count) % count;
    // The listbox's children are exactly its options (the empty-state line only exists when there
    // are no rows, and this returned above), so no selector is needed to find them.
    const rows = Array.from($('palette-results').children) as HTMLElement[];
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === this.paletteIndex)));
    rows[this.paletteIndex]?.scrollIntoView({ block: 'nearest' });
    this.markActiveOption();
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
    if (result.kind === 'deep') {
      this.revealInScreen(result.screen, result.reveal, result.settingsPane);
      return;
    }
    const run = this.commands.get(result.id);
    if (!run) {
      // Also the toast, and for the same reason: an unwired command is a fact about the keystroke
      // that just happened, not about the link. It used to sit in the island until a rota tick
      // replaced it with something unrelated.
      this.toast(`“${result.label}” is not wired up on this build.`);
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
    // The sidebar and the pairing screen read the same fact. They disagreed on 2026-09-02 —
    // "Samsung SM-S938B · Reconnecting" beside a pairing screen asking for a scan — because the
    // sidebar read the remembered name and the router read `paired`.
    const health = status?.pairing;
    const name =
      health?.kind === 'repudiated'
        ? (status?.deviceName ?? 'Phone')
        : (status?.deviceName ?? (status?.paired ? 'Phone' : 'No phone paired'));
    // A round trip is a reading about a live link. Kept after a disconnect it is a stale number in
    // the present tense beside a red chip, so anything but `live` draws the dash.
    const latency = tone !== 'live' || status?.rttMs === undefined ? '—' : `${status.rttMs} ms`;
    if (this.current === 'overview') $('page-sub').textContent = this.subtitleFor('overview', '');

    $('device-name').textContent = name;
    $('device-state').textContent = label;
    $('device-dot').setAttribute('data-state', tone);
    /*
     * The handoff's device card, connected-device strip and hero all carry a battery percentage,
     * and `battery.state` now arrives: `VitalsFeature` pushes it, `main.ts` holds and forwards it,
     * and this is the chrome's third of it.
     *
     * **`tone` is not read here and that is deliberate.** The slot's *presence* is the whole signal
     * and it sits inside a status line that already carries a coloured dot for the link. A second
     * colour in the same 200px, answering to a different fact, is the two-writers-one-surface shape
     * defect 96 was: a reader cannot tell which of the two the red belongs to. Low battery is drawn
     * where it has room to say so — the O4 ring, which has a caption.
     *
     * The slot is removed rather than filled with a dash whenever there is nothing to say, which
     * now includes a link that is not live: see [batterySlot] for why a stale percentage is worse
     * than none.
     */
    const battery = vitalsRules.batterySlot(this.battery, tone === 'live');
    $('device-battery').hidden = !battery.show;
    $('device-battery').textContent = battery.text;

    $('hero-name').textContent = name;
    $('hero-state').textContent = label;
    $('hero-dot').setAttribute('data-state', tone);
    $('hero-chip').setAttribute('data-state', tone);
    // The hero card and its phone visual follow the same tone: forest wash and lime bloom when
    // live, neutral grey with a quiet spinner while working, desaturated with a muted-red
    // link-minus disc when down. One attribute, written here with the chip's, so the picture and
    // the words cannot disagree.
    $('hero-card').setAttribute('data-state', tone);
    this.drawHeroFacts(status, latency);
    // The hero's primary action is only offered while the phone advertises mirroring, on the same
    // rule as the Mirror pane's own button: no button for a promise the phone has not made.
    ($('hero-mirror') as HTMLButtonElement).disabled = status?.phase !== 'connected';

    /*
     * **The island is the fifth view of this one fact, and now it is fed like the other four.**
     *
     * It used to be the exception: a seize on transitions, and then a 5.2-second timer that wrote
     * text from a six-slot history ring and tone from `toneOf(this.status)` — two clocks in one
     * pill. There was no "one function so the four cannot disagree" for the island, and it
     * disagreed constantly. `renderIsland` reads the same `status` this function just assigned, and
     * `islandState` derives the connection claim from the same `linkToneLabel` two lines up.
     *
     * Unconditional, and that is safe now for the reason the seize existed to work around: the
     * output is a pure function of the status, so a heartbeat that only moves `rttMs` redraws the
     * latency and nothing else. There is nothing underneath it to overwrite.
     */
    this.renderIsland();

    // Pairing is forced while unpaired and released the moment the phone is trusted, rather than
    // leaving the user on a pairing screen they have already finished with.
    const mustPair = status
      ? (status.pairing ? status.pairing.kind !== 'paired' : !status.paired)
      : false;
    if (mustPair && this.current !== 'pairing') this.route('pairing');
    if (status?.paired && wasPaired === false) this.route('overview');
  }

  /**
   * The phone's battery, from `battery.state`.
   *
   * Separate from [setStatus] because the two arrive on different messages at different rates, and
   * it re-renders through `setStatus` rather than touching the slots itself — one writer for the
   * chrome, which is the rule defect 96 cost this project a month to learn.
   */
  setBattery(state: { level: number | null; charging: boolean; capacityUnknown: boolean } | null): void {
    this.battery = state;
    this.setStatus(this.status);
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
    /*
     * ### Why this is four cells and not six — reverted 2026-09-16, departure O11
     *
     * Slice 59 added **Battery** and **Storage** rows here, against a reference mockup that is not
     * the handoff and is now recorded as superseded (`docs/design-departures.md`, top of file).
     * Against `ConnectSuite.dc.html` they are duplicates: the Overview draws battery in exactly two
     * places — the sidebar device card and the O4 ring — and storage in exactly one, the ring. With
     * the two rows here it was **three** and **two**, measured on hardware, with the ring and the
     * row four hundred pixels apart saying the same number in two different faces.
     *
     * The fact is not hidden by removing it. The ring has room for a caption and says
     * *"This phone does not report its level"* where a fact cell could only manage a dash; Settings
     * → Advanced carries `batteryDiagnostic` with the reading's age. This card is the link, and the
     * ring card is the device — which is the split the handoff draws and the split that makes the
     * two cards stop restating each other.
     */
    // The handoff's 2 × 2, read row by row: Connection, Address / Security, Latency.
    const facts: HeroFact[] = [
      { icon: 'wifi', label: 'Connection', value: heroTransportOf(status), numeric: false, advanced: false },
      // Signal's old slot (departure S5): nothing on the wire reports link quality, so the address
      // — how you would debug this — sits here instead of a made-up "Excellent".
      { icon: 'network', label: 'Address', value: status?.address ?? '—', numeric: true, advanced: false },
      // Not a reading and not dressed as one: locked decision #3 is TLS 1.3, both ends pinned, no
      // plaintext fallback ever — a fact about the architecture, true before the phone answers.
      // The value is the promise in plain words; the mechanism (TLS 1.3, both ends pinned) is the
      // security card's and Device info's to explain, not a tile's (UX batch 2026-10-10).
      { icon: 'lock', label: 'Security', value: 'Encrypted', numeric: false, advanced: false },
      { icon: 'activity', label: 'Latency', value: latency, numeric: true, advanced: false },
    ];

    const host = $('hero-facts');
    host.replaceChildren();
    for (const fact of facts) {
      // The pair is one grid cell. A bare dt/dd pair in a two-column grid separates the label from
      // its value by the width of the card, which is a table, not a fact.
      const cell = document.createElement('div');
      cell.className = 'detail';

      const glyph = document.createElement('span');
      glyph.className = 'detail-icon';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.appendChild(iconSvg(fact.icon, 15));

      const lines = document.createElement('div');
      lines.className = 'detail-lines';
      const dt = document.createElement('dt');
      dt.className = 'detail-label';
      dt.textContent = fact.label;
      const dd = document.createElement('dd');
      dd.className = 'detail-value';
      if (fact.numeric) dd.classList.add('mono');
      if (fact.advanced) dd.classList.add('is-advanced');
      dd.textContent = fact.value;
      lines.append(dt, dd);

      cell.append(glyph, lines);
      host.appendChild(cell);
    }
  }

  /** The sidebar badge. Hidden at zero — a badge reading "0" is a count nobody needs. */
  setNotificationCount(count: number): void {
    this.notificationCount = count;
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
    this.settingsPanes.set(id, {
      label,
      build: () => {
        const wrap = document.createElement('div');
        const title = document.createElement('h2');
        title.className = 'settings-title';
        title.textContent = label;
        const subtitle = document.createElement('p');
        subtitle.className = 'settings-sub';
        subtitle.textContent = sub;
        wrap.append(title, subtitle, build());
        return wrap;
      },
    });
  }

  private drawSettings(): void {
    const rail = $('settings-rail');
    rail.replaceChildren();
    // **The rail's label is the pane's own**, not a title-cased id. It was
    // `id.charAt(0).toUpperCase() + id.slice(1)`, which is right for three panes named after single
    // words and silently wrong for the fourth: the `transfer` pane is called *File transfer*
    // everywhere in the design and everywhere in its own heading, and the rail would have called it
    // *Transfer*. One name, one place.
    for (const [id, pane] of this.settingsPanes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'settings-tab';
      tab.textContent = pane.label;
      tab.setAttribute('aria-current', String(id === this.settingsPane));
      tab.addEventListener('click', () => {
        this.settingsPane = id;
        this.drawSettings();
      });
      rail.appendChild(tab);
    }
    const pane = this.settingsPanes.get(this.settingsPane);
    $('settings-body').replaceChildren(pane ? pane.build() : document.createElement('div'));
  }

  /** Redraw the open Settings pane. Called when the data behind it moves. */
  refreshSettings(): void {
    if (this.current === 'settings') this.drawSettings();
  }

  get screen(): string {
    return this.current;
  }

  /** What the sidebar badge is showing. See [notificationCount]. */
  get unread(): number {
    return this.notificationCount;
  }
}

/**
 * One instance, in the global scope renderer.ts shares. It is created at parse time rather than on
 * DOMContentLoaded because index.html loads every script at the end of <body>, so the DOM this
 * constructor reads is already there — and a shell that builds one tick later would let
 * renderer.ts's first `render()` reach it before the nav exists.
 */
const shell = new ShellView();

/**
 * The class itself, so `shellIsland.test.ts` drives the real one rather than a paraphrase.
 *
 * `ShellView` was on `scripts/check-renderer-views.mjs`'s debt list with the reason *"the window
 * frame; its rules live in shell.css and stylesheets.test.ts guards those"*. That was true of the
 * frame and false of this file's other job: it owns the **status island and the connected-device
 * strip**, which are two surfaces that must agree about one fact, and no test could see either
 * being written. The island contradicted the strip for a month underneath a green suite.
 */
(globalThis as Record<string, unknown>).ShellView = ShellView;
// The hero's one pure decision, for `shellHero.test.ts`. Same seam rule as the island's.
(globalThis as Record<string, unknown>).heroTransportOf = heroTransportOf;
