import type { PhoneNotification } from './protocol';
import { withinCooldown, type KeyHistory } from './notifyCooldown';

/**
 * Whether one `notif.posted` earns a **native macOS notification**.
 *
 * ### Why this is a pure function in `src/shared/`
 *
 * The decision has to be testable and it has to have exactly one home. `main.ts` cannot be reached
 * by a test and a second copy of the rule in the renderer is the shape `CLAUDE.md` warns about —
 * two expressions of one rule disagree eventually, and the test is the one that turns out to be
 * wrong. The badge and the banner both call this, so they cannot disagree about whether you saw
 * something.
 *
 * ### The exclusions, and what each one is actually about
 *
 * There is **no package allowlist**, deliberately. A curated list of "important apps" is a guess
 * that is wrong for everybody but its author and fails *silently, in the direction of not telling
 * you things* — which is the failure this whole feature exists to remove. Every rule below is a
 * fact about the notification, never an opinion about the app that sent it.
 *
 * The one that would have shipped this broken is {@link NotifyDecision.REPLAY}. See
 * `docs/phase-7-native-notifications.md` §1.4: the phone replays its whole shade as ordinary
 * `notif.posted` on every session, there is no end-of-replay marker on the wire, and the link
 * reconnects on every sleep, network change and reboot — so without it, waking a laptop dumps
 * fourteen banners at once, and the better Phase 6 made the link the more often it happens.
 */
export const NotifyDecision = Object.freeze({
  /** Post it. */
  NOTIFY: 'notify',
  /** Android's collapse header: no title, no text — an empty banner. The pane hides these too. */
  GROUP_SUMMARY: 'group-summary',
  /** A persistent status, not an event: music, downloads, navigation, our own foreground service. */
  ONGOING: 'ongoing',
  /**
   * A re-post of a key we hold **whose timestamp did not advance** — a ticking progress bar.
   *
   * Deliberately *not* every re-post. Messaging apps put one notification per conversation and
   * update it, so a second message in a chat you have not read arrives as the same key: suppressing
   * on the key alone would silence exactly the notification this feature exists for. A progress bar
   * keeps its original `when`; a new message advances it.
   */
  UPDATE: 'update',
  /** Posted on the phone before this session existed — the replay burst. */
  REPLAY: 'replay',
  /** The window is focused *and* the notifications pane is open, so the row is already on screen. */
  ALREADY_VISIBLE: 'already-visible',
  /**
   * This key bannered recently — defect 84.
   *
   * The door `UPDATE` and `ONGOING` between them do not stand in: a key that **advances its
   * timestamp** on every tick *and* **flaps its `ongoing` flag** is caught by neither, and produced
   * eleven native banners for one notification in three and a half minutes. How long "recently" is
   * depends on whether the key has ever been `ongoing`; see `notifyCooldown.ts`.
   */
  COOLDOWN: 'cooldown',
});

export type NotifyDecisionValue = (typeof NotifyDecision)[keyof typeof NotifyDecision];

/**
 * How far a phone's clock may be behind this Mac's before a genuinely new notification would be
 * mistaken for a replayed one.
 *
 * It is a **grace on a comparison between two clocks**, not a debounce and not a settling delay —
 * nothing here waits. Thirty seconds is wide enough for ordinary NTP drift between two devices and
 * far narrower than the age of anything sitting in a phone's shade.
 *
 * **It is a judgement, not a measurement, and this comment used to claim otherwise** — it said the
 * measured skew was logged on every session, and no line in this repo has ever written one. The
 * session handshake carries no phone clock, so there is nothing to compare against at the instant
 * the cutoff is armed; see `NativeNotifier.onSessionReady`. Thirty seconds is chosen against the
 * two numbers it sits between — ordinary NTP drift, and the age of anything sitting in a shade —
 * and a grace that turns out to be wrong will show up as a genuine notification suppressed as
 * `replay`, in the per-reason tally, rather than as a skew reading.
 */
export const CLOCK_SKEW_GRACE_MS = 30_000;

export interface NotifyContext {
  /** Wall time when the current session became ready. `null` before any session. */
  sessionReadyAtMs: number | null;
  /**
   * The notification this one replaces, when its key is already in the live set.
   *
   * Carries the timestamp rather than a boolean, because *whether it is a replace* is not the
   * question — a replace whose `whenMs` advanced is a new event, and one whose `whenMs` stood still
   * is the same event redrawn.
   */
  previous: { whenMs: number } | null;
  /** The ConnectSuite window is focused. */
  windowFocused: boolean;
  /** The renderer's current route. */
  currentScreen: string;
  /**
   * What this key has done before — defect 84. `NO_HISTORY` for a key never seen.
   *
   * Passed in rather than looked up, so this function stays pure and the **write** that produces it
   * lives in `NotifyCooldown`, where a test can reach it. A decision fed by an untestable write is
   * defect 67.
   */
  history: KeyHistory;
  /** Now, on this Mac's clock. Injected so the window is testable without waiting. */
  nowMs: number;
}

/**
 * The decision, as a reason rather than a boolean.
 *
 * A boolean would make every suppression look the same in the log, and "no banner appeared" is
 * exactly the reading that needs to say *which* rule produced it — the same reason
 * `LinkAutoStart` names its route instead of logging one line for all of them.
 */
export function notifyDecision(
  notification: PhoneNotification,
  context: NotifyContext,
): NotifyDecisionValue {
  if (notification.isGroupSummary) return NotifyDecision.GROUP_SUMMARY;
  if (notification.ongoing) return NotifyDecision.ONGOING;
  // Same key, no newer timestamp: the same event redrawn. `<=` rather than `<` because a redraw
  // that reuses the exact millisecond is the common case, and only a genuine advance counts.
  if (context.previous && notification.whenMs <= context.previous.whenMs) {
    return NotifyDecision.UPDATE;
  }

  // Older than this session: it was already in the shade when we connected. `sessionReadyAtMs` of
  // null means no session has been established, in which case nothing should be posting anyway.
  if (context.sessionReadyAtMs === null) return NotifyDecision.REPLAY;
  if (notification.whenMs < context.sessionReadyAtMs - CLOCK_SKEW_GRACE_MS) {
    return NotifyDecision.REPLAY;
  }

  // Precise rather than generous: focused on Files or Mirror is *not* suppressed, because the row
  // is not on screen there and staying quiet would be the silence this feature exists to remove.
  if (context.windowFocused && context.currentScreen === 'notifications') {
    return NotifyDecision.ALREADY_VISIBLE;
  }

  // Last, and deliberately so: this is the gate on a notification that has passed every other rule
  // — a genuine, new, unseen event whose only problem is that its key said the same thing moments
  // ago. Ahead of `ALREADY_VISIBLE` it would report a quiet window as a cooldown and lose the
  // distinction the per-reason tally exists for.
  if (withinCooldown(context.history, context.nowMs)) return NotifyDecision.COOLDOWN;

  return NotifyDecision.NOTIFY;
}

/** The banner's two lines. Falls back the way the pane does, never to an empty string. */
export function notifyCopy(n: PhoneNotification): { title: string; body: string } {
  const title = n.title?.trim() || n.appName || n.package;
  const bodyParts = [n.text?.trim(), n.subText?.trim()].filter(
    (p): p is string => !!p && p.length > 0,
  );
  // The app name goes in the body when it is not already the title, because macOS attributes the
  // banner to *Electron* (docs/phase-7-native-notifications.md §5) and would otherwise show no
  // indication of which phone app this came from.
  const from = title === n.appName ? '' : n.appName;
  const body = [bodyParts.join(' — '), from].filter((p) => p.length > 0).join('\n');
  return { title, body: body || n.appName };
}


/**
 * What to tell someone whose notifications macOS refused — and **the two cases need different
 * sentences, because only one of them has a switch.**
 *
 * ### The defect this replaces
 *
 * The first version said *"Turn them on in System Settings → Notifications, under Electron"* in
 * every case. On an unpackaged run **there is no such row**: not switched off, absent. Sending
 * someone to a Setting that does not exist is worse than saying nothing — it is the
 * `fixHint`-pointing-at-a-nonexistent-Setting failure that `PHONE_NOT_FOCUSED` got its own error
 * code to avoid.
 *
 * ### Why the row is absent, measured
 *
 * macOS lists an app under Notifications only once it has registered as a notification client, and
 * it will not register a bundle whose identity it cannot verify. A dev run is `linker-signed` with
 * `Info.plist=not bound` and `Sealed Resources=none`, so the `CFBundleIdentifier` in its Info.plist
 * is not covered by the signature and the code-signing identifier falls back to a bare `Electron`.
 * The request is refused *before* any registration happens: no prompt, no record, no row.
 *
 * The packaged build is **also ad-hoc**, and it works — `Info.plist entries=33`,
 * `Sealed Resources version=2`, `Identifier=com.chetan.connectsuite.desktop`. So the discriminator
 * is the **seal**, not ad-hoc-versus-Developer-ID. `docs/testing.md` → Phase 7 Slice 13.
 */
export function refusalCopy(refused: { packaged: boolean }): {
  headline: string;
  body: string;
  /** True only where a Setting genuinely exists to change. */
  actionable: boolean;
} {
  if (refused.packaged) {
    return {
      headline: 'macOS is not showing these notifications',
      body: 'Open System Settings \u2192 Notifications, find ConnectSuite, and turn on Allow Notifications.',
      actionable: true,
    };
  }
  return {
    headline: 'Notifications cannot work in this development build',
    // No instruction, because there is no action. Saying "check System Settings" here would send
    // someone looking for a row that macOS never created.
    body:
      'macOS only registers an app for notifications once its bundle is sealed, and a development ' +
      'run is not \u2014 so there is no ConnectSuite entry in System Settings to switch on. ' +
      'Everything else on this screen works normally. Run a packaged build to see banners.',
    actionable: false,
  };
}
