/**
 * The shell's route table and its ⌘K palette, as data. Nothing here touches the DOM.
 *
 * The shell itself — sidebar, pill, island, dock, palette — is `shell.ts`, and it draws whatever
 * this file says. The split is the testable-seam rule: what the palette *ranks*, which screens
 * exist, and which of them are honest are all decisions with a right answer, and they are asserted
 * in `navModel.test.ts` against this file rather than against a screenshot of the sidebar.
 *
 * ### The `state` field is the load-bearing one
 *
 * Eleven screens are drawn in the sidebar. Five of them have nothing behind them yet — Files and
 * Photos and Clipboard are Phase 5, Camera is unscheduled, Activity has no store. A nav row that
 * opens a blank page is `CLAUDE.md` decision 6 failing exactly where it is easiest to fail: the
 * user cannot tell "nothing has arrived" from "this was never built", and the design cannot tell
 * them because the design assumes all eleven work.
 *
 * So every screen declares its state, [unbuiltReason] is the sentence the empty screen prints, and
 * the sentence is a *reason with a phase in it*, not "coming soon". A screen that is `built` has no
 * reason and the test asserts that both ways round: `built` screens must not carry one, and
 * everything else must.
 *
 * Plain script, not a module — same shape as chips.ts, notifyLabels.ts and icons.ts.
 */

/** Where a screen's content comes from today. */
type ScreenState =
  /** The pane exists, is wired to the phone, and has passed on hardware. */
  | 'built'
  /** Drawn, but the feature behind it is not written yet. Carries a reason naming the phase. */
  | 'unbuilt';

/**
 * `NavScreen`, not `Screen`: these files are plain scripts sharing one global TypeScript scope, and
 * `Screen` is already taken by the DOM lib. A collision there does not fail loudly — it silently
 * structurally-checks every entry below against `window.screen`.
 */
interface NavScreen {
  id: string;
  /** Sidebar row label, and the palette's label for the navigation half. */
  label: string;
  /** Page header, 31px. The handoff's own titles. */
  title: string;
  /** Page subtitle, 13.5px. The handoff's own copy, verbatim where it exists. */
  subtitle: string;
  /** A key of ICON_GEOMETRY in icons.ts. `navModel.test.ts` asserts every one of them resolves. */
  icon: string;
  group: 'MENU' | 'SYSTEM';
  /** Displayed in the palette. Not bound — see the note on KEY_BINDINGS below. */
  shortcut: string;
  state: ScreenState;
  /**
   * Why this screen is empty, for an `unbuilt` one. Absent on a `built` one.
   *
   * Written as a fact about this repo, with the phase named. "Coming soon" is the sentence that
   * makes decision 6 useless — it is indistinguishable from a feature that is broken today.
   */
  unbuiltReason?: string;
  /**
   * The one bold line above the reason. 15px/600, per state A in
   * `docs/mac-ui-design-proposals.md` §3.
   *
   * It says *what is missing*, not "Not built yet" — the tag says that. A headline that repeats the
   * tag wastes the one line a reader is guaranteed to take in.
   */
  unbuiltHeadline?: string;
  /**
   * The mono footer: the wire namespace that does not exist, as a machine handle.
   *
   * This is the package-id rule applied in the direction it points — *a handle may appear, never as
   * the only thing a user reads.* The sentence above it is what a person reads; this is what
   * someone grepping `docs/protocol.md` needs. Where no namespace has been proposed at all, it says
   * so rather than inventing a plausible one, because a made-up namespace is worse than none: it
   * would send a reader looking for something that was never designed.
   */
  unbuiltHandle?: string;
}

/**
 * The eleven screens, in sidebar order. This array *is* the sidebar order and the palette's
 * navigation order; there is no second list to keep in step with it.
 */
const SCREENS: NavScreen[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'Good morning, Chetan',
    subtitle: 'Your phone and Mac are in sync.',
    icon: 'overview',
    group: 'MENU',
    shortcut: '⌘1',
    state: 'built',
  },
  {
    id: 'mirror',
    label: 'Mirror',
    title: 'Screen mirror',
    subtitle: 'Control your phone from your Mac in real time.',
    icon: 'mirror',
    group: 'MENU',
    shortcut: '⌘2',
    state: 'built',
  },
  {
    id: 'files',
    label: 'Files',
    title: 'Files',
    subtitle: 'Browse and move files between your phone and Mac.',
    icon: 'files',
    group: 'MENU',
    shortcut: '⌘3',
    state: 'unbuilt',
    unbuiltReason:
      'File transfer is Phase 5 and no part of it is written yet — the bulk socket on port 42503 ' +
      'is open and carries nothing. Nothing here is broken; there is nothing here.',
    unbuiltHeadline: 'Nothing moves files yet',
    unbuiltHandle: 'fs.* — not in this build',
  },
  {
    id: 'photos',
    label: 'Photos',
    title: 'Photos',
    subtitle: 'View, organise and import photos from your phone.',
    icon: 'photos',
    group: 'MENU',
    shortcut: '⌘4',
    state: 'unbuilt',
    unbuiltReason:
      'The photo browser is Phase 5, and it rides the same bulk channel as Files. It has no wire ' +
      'messages yet, so the Mac cannot ask the phone for a thumbnail.',
    unbuiltHeadline: 'The phone has no way to send a thumbnail',
    unbuiltHandle: 'media.* — not in this build',
  },
  {
    id: 'messages',
    label: 'Messages',
    title: 'Messages',
    subtitle: 'Send and receive SMS and chat messages.',
    icon: 'messages',
    group: 'MENU',
    shortcut: '⌘5',
    state: 'built',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    title: 'Notifications',
    subtitle: 'Mirror and reply to phone notifications.',
    icon: 'notifications',
    group: 'MENU',
    shortcut: '⌘6',
    state: 'built',
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    title: 'Clipboard',
    subtitle: 'Copy on your phone, paste on your Mac.',
    icon: 'clipboard',
    group: 'MENU',
    shortcut: '⌘7',
    state: 'unbuilt',
    unbuiltReason:
      'Clipboard sync is Phase 5. The phone half is also gated: background clipboard reads have ' +
      'been blocked since Android 10 unless the app holds an enabled AccessibilityService, which ' +
      'Phase 3 gives us — so this is scheduled work, not a platform wall.',
    unbuiltHeadline: 'Nothing carries a clipboard between the two',
    unbuiltHandle: 'no namespace proposed yet',
  },
  {
    id: 'calls',
    label: 'Calls',
    title: 'Calls',
    subtitle: 'Make and receive phone calls from your Mac.',
    icon: 'calls',
    group: 'MENU',
    shortcut: '⌘8',
    state: 'built',
  },
  {
    id: 'camera',
    label: 'Camera',
    title: 'Camera',
    subtitle: 'Use your phone camera as a Mac webcam.',
    icon: 'camera',
    group: 'MENU',
    shortcut: '⌘9',
    state: 'unbuilt',
    unbuiltReason:
      'The virtual webcam is not in any phase yet. It needs a macOS Camera Extension, which is a ' +
      'signed system extension and a distribution problem before it is a code problem.',
    unbuiltHeadline: 'There is no virtual camera on this Mac',
    unbuiltHandle: 'no namespace proposed yet',
  },
  {
    id: 'activity',
    label: 'Activity',
    title: 'Activity',
    subtitle: 'Every sync, transfer and session, logged.',
    icon: 'activity',
    group: 'SYSTEM',
    shortcut: '',
    state: 'unbuilt',
    unbuiltReason:
      'Nothing stores a session history yet. The rotating log file behind Settings → Advanced is ' +
      'the closest thing that exists, and it is a log, not a timeline.',
    unbuiltHeadline: 'Nothing keeps a history to show',
    unbuiltHandle: 'no session store — see Settings → Advanced for the log',
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Settings',
    subtitle: 'Tune ConnectSuite to your workflow.',
    icon: 'settings',
    group: 'SYSTEM',
    shortcut: '⌘,',
    state: 'built',
  },
];

/**
 * The pairing screen, which is not in [SCREENS] and deliberately has no sidebar row.
 *
 * The handoff has no drawn state for an unpaired Mac at all — its first screen assumes a paired
 * phone (`docs/design-departures.md`, row X5, "pairing is the urgent one"). Rather than invent a
 * twelfth nav row the designer did not draw, pairing is a *route without a row*: the shell forces
 * it whenever `paired` is false and lets go the moment the phone is trusted. That keeps the
 * sidebar the design's eleven and still means a fresh Mac cannot land on a dashboard describing a
 * phone it has never met.
 */
const PAIRING_SCREEN: NavScreen = {
  id: 'pairing',
  label: 'Pair a phone',
  title: 'Pair your phone',
  subtitle: 'Scan this code once. After that the Mac reconnects on its own.',
  icon: 'link',
  group: 'MENU',
  shortcut: '',
  state: 'built',
};

interface Command {
  id: string;
  label: string;
  group: string;
  shortcut: string;
}

/**
 * The four commands, in the handoff's order.
 *
 * The handoff is explicit that these rank **above** navigation in the palette, and the reason is
 * worth keeping: a palette that lists eleven screens before "Stop mirroring" makes the fastest way
 * to stop a live capture slower than the sidebar, which is the opposite of what a palette is for.
 */
const COMMANDS: Command[] = [
  { id: 'mirror.start', label: 'Mirror phone', group: 'Mirror', shortcut: '⌘⇧M' },
  { id: 'mirror.stop', label: 'Stop mirroring', group: 'Mirror', shortcut: '⌘⇧.' },
  { id: 'float.toggle', label: 'Toggle floating window', group: 'Mirror', shortcut: '⌘⇧T' },
  { id: 'mirror.capture', label: 'Take screenshot', group: 'Mirror', shortcut: '⌘⇧4' },
];

interface PaletteResult {
  id: string;
  label: string;
  group: string;
  shortcut: string;
  /** 'command' or 'navigation' — the shell uses it to pick the tile colour, tests use it to rank. */
  kind: 'command' | 'navigation';
  /** For a navigation result whose screen is unbuilt, so the palette can dim it honestly. */
  unbuilt: boolean;
}

/** Case- and accent-insensitive enough for a two-word query. Not a fuzzy matcher, on purpose. */
function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * The palette's rows for a query, commands before navigation.
 *
 * Ordering is the assertion `navModel.test.ts` leads with, because it is the handoff's one explicit
 * instruction about this control and it is the kind of thing a later refactor silently reverses by
 * concatenating the arrays the other way round.
 *
 * An unbuilt screen still appears — it is a real screen with a real explanation on it, and hiding
 * it from the palette would make the palette disagree with the sidebar about which screens exist.
 * It is marked instead.
 */
function paletteResults(query: string): PaletteResult[] {
  const q = query.trim();
  const commands: PaletteResult[] = COMMANDS.filter(
    (c) => q.length === 0 || matches(c.label, q) || matches(c.group, q),
  ).map((c) => ({ ...c, kind: 'command' as const, unbuilt: false }));

  const navigation: PaletteResult[] = SCREENS.filter(
    (s) => q.length === 0 || matches(s.label, q) || matches(s.title, q) || matches(s.subtitle, q),
  ).map((s) => ({
    id: s.id,
    label: s.label,
    group: 'Go to',
    shortcut: s.shortcut,
    kind: 'navigation' as const,
    unbuilt: s.state === 'unbuilt',
  }));

  return [...commands, ...navigation];
}

/** The screen with this id, or undefined. Pairing is included: it is a route, just not a row. */
function screenById(id: string): NavScreen | undefined {
  return id === PAIRING_SCREEN.id ? PAIRING_SCREEN : SCREENS.find((s) => s.id === id);
}

/**
 * The five dock tiles, in the handoff's order, with its tints.
 *
 * Colour is carried here rather than in CSS because the dock is the one place the design assigns a
 * *per-feature* hue that appears nowhere else, and five hex values scattered across a stylesheet
 * are five values that drift. Files and Camera are dock tiles for screens that are unbuilt: the
 * dock is the design's, and a tile that opens an honest empty screen is better than a dock with
 * holes in it that has to be explained.
 */
const DOCK: { id: string; label: string; icon: string; tint: string }[] = [
  { id: 'mirror', label: 'Mirror', icon: 'mirror', tint: '139,107,255' },
  { id: 'files', label: 'Files', icon: 'files', tint: '96,165,250' },
  { id: 'messages', label: 'Messages', icon: 'messages', tint: '50,229,138' },
  { id: 'calls', label: 'Calls', icon: 'calls', tint: '34,211,238' },
  { id: 'camera', label: 'Camera', icon: 'camera', tint: '244,114,182' },
];

/**
 * The Mirror tool rail, and the six global actions under the stage.
 *
 * These live here rather than in `renderer.ts` for one reason: **the icons that shipped as empty
 * rings were Capture and Refresh**, and an icon name that is not in an enumeration is an icon name
 * no test can check. `navModel.test.ts` asserts that every name in [iconNamesUsedByTheShell]
 * resolves in `icons.ts`, and that assertion is only worth its green if the two glyphs the defect
 * was actually about are inside it.
 *
 * `action` is the wire value for `input.global`; `renderer.ts` reads it and this file never sends
 * anything. The rail's two entries carry no action because they are not global actions — Capture is
 * Mac-side and Refresh is `mirror.keyframe`.
 */
const TOOL_RAIL: { id: string; label: string; icon: string }[] = [
  { id: 'capture', label: 'Capture', icon: 'capture' },
  { id: 'refresh', label: 'Refresh', icon: 'refresh' },
];

const GLOBAL_ACTIONS: { id: string; label: string; icon: string; action: string }[] = [
  { id: 'back', label: 'Back', icon: 'back', action: 'back' },
  { id: 'home', label: 'Home', icon: 'home', action: 'home' },
  { id: 'recents', label: 'Recents', icon: 'recents', action: 'recents' },
  { id: 'notifications', label: 'Alerts', icon: 'alerts', action: 'notifications' },
  { id: 'quick-settings', label: 'Quick settings', icon: 'quick-settings', action: 'quick_settings' },
  { id: 'lock', label: 'Lock', icon: 'lock', action: 'lock_screen' },
];

/**
 * Every icon name the shell asks `icons.ts` for, in one array.
 *
 * The enumeration is the enforcement point for the empty-ring defect, in the same way
 * `userVisibleStringsOf` is the enforcement point for defect 28: a test over the whole list catches
 * an icon added tomorrow, where a test over the names somebody remembered catches only today's.
 *
 * The toolbar and utility marks are listed literally because they are drawn from `shell.ts` rather
 * than from a table — if that changes, they move into their own table and this function reads it.
 */
function iconNamesUsedByTheShell(): string[] {
  return [
    ...SCREENS.map((s) => s.icon),
    PAIRING_SCREEN.icon,
    ...DOCK.map((d) => d.icon),
    ...TOOL_RAIL.map((t) => t.icon),
    ...GLOBAL_ACTIONS.map((g) => g.icon),
    'search',
    'device-settings',
    'detach',
    'dots',
    'phone',
    'close',
    'check',
    'chevron',
  ];
}

/**
 * The nav pill's Y offset and height, from a row that has already been measured.
 *
 * The handoff is emphatic about this and gives the reason: group headers and badges change the
 * row rhythm, so a pill positioned from an assumed pitch desynchronises. This function therefore
 * takes an `offsetTop` that the caller read from the live DOM — it cannot compute one, which is
 * the point. It exists as a function at all so the clamp is testable: a row scrolled out of the
 * nav's viewport must not drag the pill off the top of the sidebar.
 */
function pillOffsetFor(rowOffsetTop: number): number {
  return Math.max(0, rowOffsetTop);
}

if (typeof module !== 'undefined') {
  module.exports = {
    SCREENS,
    PAIRING_SCREEN,
    COMMANDS,
    DOCK,
    TOOL_RAIL,
    GLOBAL_ACTIONS,
    iconNamesUsedByTheShell,
    paletteResults,
    screenById,
    pillOffsetFor,
  };
}
