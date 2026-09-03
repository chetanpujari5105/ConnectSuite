import { app, Notification } from 'electron';
import {
  NotifyDecision,
  type NotifyDecisionValue,
  notifyCopy,
  notifyDecision,
} from '../shared/nativeNotify';
import type { PhoneNotification } from '../shared/protocol';
import { log } from './logger';

/**
 * The Mac's native notifications — the half of notification mirroring that reaches a person who is
 * not looking at this app.
 *
 * ### Why this exists
 *
 * Everything else was already built: the phone's listener, the relay, `AppLabels`, the reply path,
 * the pane, the sidebar count. All of it terminated in a pane, and `Notification` had never been
 * imported in this project — 13 electron symbols across 91 files and not that one. So a phone
 * notification crossed TLS, was parsed, stored, rendered and counted, and **nothing told the
 * person**. `docs/phase-7-state.md` §5.2 is the argument; `docs/phase-7-native-notifications.md` is
 * the scope this implements.
 *
 * ### What is deliberately not here
 *
 * The *decision* is not here. It is {@link notifyDecision} in `src/shared/`, where a test can reach
 * it, because this class needs Electron and therefore cannot be unit-tested. This file is the part
 * that posts, badges and logs; everything it chooses is chosen somewhere testable.
 *
 * ### Permission, and why nothing is claimed up front
 *
 * **Measured, not assumed** — `docs/phase-7-native-notifications.md` §0. `Notification.isSupported()`
 * returns `true` on a machine that refuses every notification: it is a static capability answer and
 * gating on it would be reading one fact as another. Electron exposes no way to read macOS
 * authorization at all, and a signed control app's `requestAuthorization` hung with no callback.
 *
 * What *is* observable is the `failed` event, carrying `UNErrorDomain error 1`. So this class claims
 * nothing about permission until a post has actually failed, and then says exactly what macOS said.
 * That is reactive by necessity rather than by preference, and the pane says so.
 */
export class NativeNotifier {
  /** Wall time this session became ready. The replay burst is everything older — §1.4. */
  private sessionReadyAtMs: number | null = null;

  private windowFocused = false;
  private currentScreen = 'overview';

  /** Keys posted natively and not yet seen in the pane. The badge is this set's size. */
  private unseen = new Set<string>();

  /** Set by the first `failed`. Until then nothing is claimed — see the class comment. */
  private refusal: { message: string; atMs: number } | null = null;

  /**
   * Counted per reason, and published together.
   *
   * A suppression count with no posted count beside it reads as whichever story the reader already
   * believes — `CLAUDE.md`'s denominator rule. "0 posted" on a quiet evening and "0 posted" over a
   * rule that suppresses everything are the same line without these.
   */
  private tally: Record<string, number> = {};

  constructor(
    private readonly reveal: (key: string) => void,
    private readonly soundEnabled: () => boolean,
  ) {}

  /**
   * A session became ready. Everything the phone replays now is older than this instant.
   *
   * The skew between the two clocks is logged rather than corrected: a grace that turns out to be
   * wrong should be a number somebody can read, not a silence.
   */
  onSessionReady(nowMs = Date.now()): void {
    this.sessionReadyAtMs = nowMs;
    this.tally = {};
    log.info('native-notif', `Session ready at ${new Date(nowMs).toISOString()} — replay cutoff armed`);
  }

  onSessionEnded(): void {
    this.sessionReadyAtMs = null;
    this.publishTally('session ended');
  }

  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
    if (focused && this.currentScreen === 'notifications') this.markAllSeen();
  }

  setCurrentScreen(screen: string): void {
    this.currentScreen = screen;
    if (this.windowFocused && screen === 'notifications') this.markAllSeen();
  }

  /** The pane is in front of the person, so nothing is outstanding any more. */
  private markAllSeen(): void {
    if (this.unseen.size === 0) return;
    this.unseen.clear();
    this.refreshBadge();
  }

  /** Dropped with the set the pane holds — a badge outliving its rows counts nothing real. */
  onCleared(): void {
    this.unseen.clear();
    this.refreshBadge();
  }

  onRemoved(key: string): void {
    if (this.unseen.delete(key)) this.refreshBadge();
  }

  /** What the pane needs to draw the degraded banner, and nothing more. */
  permissionState(): { refused: boolean; message: string | null; bundleName: string } {
    return {
      refused: this.refusal !== null,
      message: this.refusal?.message ?? null,
      // Named honestly: a dev run and the ad-hoc signed .dmg alike post as `Electron`
      // (Phase 9, D12), so telling anyone to look for "ConnectSuite" in System Settings would
      // send them to a row that does not exist.
      bundleName: app.isPackaged ? 'ConnectSuite' : 'Electron',
    };
  }

  /**
   * One `notif.posted`, already accepted by {@link NotificationClient}.
   *
   * Returns the decision so the caller can log one line per notification with its reason, rather
   * than a single "posted"/"didn't" that makes every suppression look the same.
   */
  consider(notification: PhoneNotification, isUpdate: boolean): NotifyDecisionValue {
    const decision = notifyDecision(notification, {
      sessionReadyAtMs: this.sessionReadyAtMs,
      isUpdate,
      windowFocused: this.windowFocused,
      currentScreen: this.currentScreen,
    });
    this.tally[decision] = (this.tally[decision] ?? 0) + 1;
    if (decision !== NotifyDecision.NOTIFY) return decision;

    this.post(notification);
    return decision;
  }

  private post(n: PhoneNotification): void {
    const { title, body } = notifyCopy(n);
    const native = new Notification({
      title,
      body,
      // Off unless asked for. A sound per message is what makes people uninstall a mirror — the
      // phone in their pocket has already made one.
      silent: !this.soundEnabled(),
    });

    native.on('click', () => {
      this.unseen.delete(n.key);
      this.refreshBadge();
      // Routing to the pane and stopping is doing nothing — the deep-link lesson. The row itself
      // is revealed, through the same mechanism the palette's deep links use.
      this.reveal(n.key);
    });

    // The only permission signal that exists. The exception's own text is kept intact rather than
    // paraphrased: defect 57's whole lesson is that a platform's failure name is about the
    // platform's model, and discarding it discards the diagnosis.
    native.on('failed', (_event, error) => {
      const message = String(error ?? 'unknown');
      if (!this.refusal) {
        this.refusal = { message, atMs: Date.now() };
        log.warn(
          'native-notif',
          `macOS refused a notification — ${message}. ` +
            `Everything since launch: ${this.tallyLine()}. ` +
            `The switch is under "${this.permissionState().bundleName}" in System Settings → Notifications.`,
        );
      }
    });

    native.show();
    this.unseen.add(n.key);
    this.refreshBadge();
  }

  private refreshBadge(): void {
    // Counts what you have not seen, never what the phone holds. A badge reading `14` because a
    // shade holds 14 is permanent furniture, and permanent furniture stops being read. This is the
    // Mac-side "seen in this pane" that departure row N2 says such a thing would have to be.
    app.setBadgeCount(this.unseen.size);
  }

  private tallyLine(): string {
    const parts = Object.entries(this.tally).map(([reason, n]) => `${reason}=${n}`);
    return parts.length > 0 ? parts.join(' ') : 'nothing considered yet';
  }

  private publishTally(why: string): void {
    log.info('native-notif', `${why} — ${this.tallyLine()}`);
  }
}
