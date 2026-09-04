import { app, Notification } from 'electron';
import {
  NotifyDecision,
  type NotifyDecisionValue,
  notifyCopy,
  notifyDecision,
  refusalCopy,
} from '../shared/nativeNotify';
import { LiveNotifications } from '../shared/liveNotifications';
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

  /**
   * Keys posted natively and not yet seen in the pane, **each holding its own banner**. The badge is
   * this registry's size.
   *
   * The handle is held because Electron delivers `click` through the instance and nothing in the
   * platform keeps that instance alive — see {@link LiveNotifications}. Measured on 2026-09-04: a
   * banner clicked minutes after posting was lost, one clicked within a second was delivered.
   */
  private live = new LiveNotifications<Notification>();

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

  /** Clicks delivered to this process. The denominator for it is `notify` in {@link tally}. */
  private clicks = 0;

  constructor(
    private readonly reveal: (key: string) => void,
    private readonly soundEnabled: () => boolean,
  ) {}

  /**
   * A session became ready. Everything the phone replays now is older than this instant.
   *
   * **No skew is measured here, and this comment used to say one was.** It claimed the skew between
   * the two clocks was logged every session so that a wrong grace would be a number somebody could
   * read — over ten `Session ready` lines and zero skew lines in the same file. Measuring it needs
   * the phone's clock at a known instant on this one, and nothing on the wire carries it: the only
   * phone timestamps that reach here are each notification's own `whenMs`, which is when the
   * notification happened rather than when the session began. So {@link CLOCK_SKEW_GRACE_MS} is a
   * fixed 30 s with judgement behind it and no reading, which is a smaller claim than the one this
   * comment was making. Adding a timestamp to the session handshake is what would change that.
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
    const released = this.live.releaseAll();
    if (released.length === 0) return;
    this.refreshBadge();
    log.info('native-notif', `pane is in front — ${released.length} marked seen, ${this.tallyLine()}`);
  }

  /** Dropped with the set the pane holds — a badge outliving its rows counts nothing real. */
  onCleared(): void {
    this.live.releaseAll();
    this.refreshBadge();
  }

  /**
   * The phone removed it, so it stops being outstanding here and its handle is let go.
   *
   * A banner still on screen at this instant is no longer protected — releasing the reference makes
   * the instance collectable rather than destroying it, so a click on it becomes a race. Chosen
   * rather than missed. Holding the handle longer means holding it until
   * macOS reports the banner closed, and Electron's `close` is not guaranteed to arrive on macOS, so
   * the alternative trades a bounded silence for an unbounded leak in an app meant to run all day.
   * Closing the banner here instead would be a product change — a notification dismissed on the
   * phone vanishing from the Mac — and is not one to make inside a defect fix.
   */
  onRemoved(key: string): void {
    if (this.live.release(key)) this.refreshBadge();
  }

  /**
   * What the pane needs to draw the degraded banner, and nothing more.
   *
   * The copy is chosen by {@link refusalCopy} on **whether this build is packaged**, because that is
   * the thing that decides whether a Setting exists at all. An unpackaged run is refused before
   * macOS ever registers it, so no row is created and there is nothing to switch on — and the first
   * version of this told people to go and find one.
   */
  permissionState(): {
    refused: boolean;
    headline: string | null;
    body: string | null;
    actionable: boolean;
    message: string | null;
  } {
    if (!this.refusal) {
      return { refused: false, headline: null, body: null, actionable: false, message: null };
    }
    const copy = refusalCopy({ packaged: app.isPackaged });
    return { refused: true, ...copy, message: this.refusal.message };
  }

  /**
   * One `notif.posted`, already accepted by {@link NotificationClient}.
   *
   * `previous` is the notification this one replaces, read from the live set **before** it is
   * overwritten. It carries the timestamp rather than a boolean, because a re-post that advanced its
   * `whenMs` is a new message in a conversation and a re-post that did not is a redraw.
   *
   * Returns the decision so the caller can log one line per notification with its reason, rather
   * than a single "posted"/"didn't" that makes every suppression look the same.
   */
  consider(
    notification: PhoneNotification,
    previous: PhoneNotification | null,
  ): NotifyDecisionValue {
    const decision = notifyDecision(notification, {
      sessionReadyAtMs: this.sessionReadyAtMs,
      previous,
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
      /*
       * Logged first, and logged at all.
       *
       * This handler used to write nothing, and its only trace was the Dock badge — a number with
       * four writers, two of which fired during the run that tried to read it. A click that never
       * arrived and a click whose reveal failed were the same observation from outside, and the
       * three candidate bugs behind them are three different fixes. The line goes before the work so
       * a click that arrives and then throws still leaves evidence that it arrived.
       *
       * `held` is the discriminator that matters now: a click for a key this registry no longer
       * holds is the failure this retention exists to prevent, arriving by another route.
       */
      const held = this.live.release(n.key);
      this.clicks += 1;
      log.info(
        'native-notif',
        `click ${n.package} — ${held ? 'handle held' : 'HANDLE ALREADY RELEASED (seen, removed, or lost)'}, ` +
          `${this.live.size} still unseen — ${this.clicks} clicked / ${this.tally[NotifyDecision.NOTIFY] ?? 0} posted since launch`,
      );
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
        const copy = refusalCopy({ packaged: app.isPackaged });
        log.warn(
          'native-notif',
          `macOS refused a notification — ${message}. ` +
            `Everything since launch: ${this.tallyLine()}. ` +
            `${copy.headline}: ${copy.body}`,
        );
      }
    });

    native.show();
    /*
     * Retained here, and this line is the fix.
     *
     * A second post under one key is ordinary — a messaging app keeps one notification per
     * conversation and advances it, which {@link notifyDecision} deliberately treats as a new event.
     * Only one handle can be held per key, so the banner this one supersedes is closed rather than
     * left on screen with nothing able to deliver its click.
     */
    this.live.retain(n.key, native)?.close();
    this.refreshBadge();
  }

  private refreshBadge(): void {
    // Counts what you have not seen, never what the phone holds. A badge reading `14` because a
    // shade holds 14 is permanent furniture, and permanent furniture stops being read. This is the
    // Mac-side "seen in this pane" that departure row N2 says such a thing would have to be.
    app.setBadgeCount(this.live.size);
  }

  private tallyLine(): string {
    const parts = Object.entries(this.tally).map(([reason, n]) => `${reason}=${n}`);
    return parts.length > 0 ? parts.join(' ') : 'nothing considered yet';
  }

  private publishTally(why: string): void {
    log.info('native-notif', `${why} — ${this.tallyLine()}`);
  }
}
