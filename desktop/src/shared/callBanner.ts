import { callHistoryName } from './callRecord';
import type { IncomingCall } from './protocol';

/**
 * Whether a ringing call earns a **native macOS banner**, and when that banner goes away.
 *
 * ### Why this exists
 *
 * A ringing call reached exactly one surface: the Calls pane. `call.incoming` was never given to the
 * notifier, and the phone's own in-call notification arrives `ongoing`, which the mirrored path
 * suppresses by rule — measured on this Mac's own log, `com.samsung.android.incallui → ongoing` 76
 * times and never anything else (single device). So with Sidekick not open on Calls, a call rang
 * unseen.
 *
 * ### The decision is here, and Electron is not
 *
 * Same split as `nativeNotify.ts`: this file decides and holds the state, `nativeNotifier.ts` posts
 * and closes, `main.ts` wires them. Every rule below is reachable by a test, and every transition is
 * a method call a test can make in production order.
 *
 * ### The rules
 *
 *  - **Gate first.** Off unless the development switch is on in an unpackaged build. Not yet
 *    verified on hardware, so it does not exist for anyone who did not ask for it.
 *  - **Ringing only.** A dialled or answered call has nobody to tell. No missed-call banner.
 *  - **Not while Calls is in front**, and a call suppressed that way stays suppressed — the person
 *    already saw it, so a later re-send must not banner it after the fact.
 *  - **Once per session per call.** The key is `session:callId:startedAtMs`. The session part means a
 *    call still ringing after a reconnect is bannered again (the drop closed the first banner); the
 *    `startedAtMs` part means a *different* call reusing an id after a phone restart is not mistaken
 *    for the old one. Both fields are on the production event.
 *  - **Held briefly for the number.** The inbound number arrives as a second `call.incoming`,
 *    16–535 ms after the first (defect 45, 7 of 7 episodes, one handset). A banner on the first event
 *    would nearly always say "Unknown number", so a ringing call with no number yet is held for
 *    {@link CALL_BANNER_HOLD_MS} and posted on the correction, or on expiry with what is known.
 *  - **Closed** when the call is answered, ends, is replaced, or the session ends.
 *  - **Never the number.** The body names the contact or says "Unknown number" — the same rule as the
 *    persisted history, because macOS keeps notification content on disk.
 *  - **Nothing to press but the banner.** The copy has a title and a body; there is no action.
 *    Clicking opens the Calls pane and does nothing else.
 */

/** How long a ringing call with no number yet waits for the phone's correction. */
export const CALL_BANNER_HOLD_MS = 1_000;

export const CallBannerDecision = Object.freeze({
  POST: 'post',
  HOLD: 'hold',
  GATE_OFF: 'gate-off',
  NO_SESSION: 'no-session',
  NOT_RINGING: 'not-ringing',
  ALREADY_HANDLED: 'already-handled',
  CALLS_IN_FRONT: 'calls-in-front',
  NONE: 'none',
});
export type CallBannerDecisionValue = (typeof CallBannerDecision)[keyof typeof CallBannerDecision];

/** What the Mac's window is doing, and whether the feature may run at all. */
export interface CallBannerView {
  enabled: boolean;
  windowFocused: boolean;
  currentScreen: string;
}

export interface CallBannerCopy {
  title: string;
  body: string;
}

/** What `main.ts` must do. Every field is acted on independently; any may be empty. */
export interface CallBannerAction {
  decision: CallBannerDecisionValue;
  /** Post this banner. */
  post: ({ key: string } & CallBannerCopy) | null;
  /** Close the banner posted under this key. */
  close: string | null;
  /** Start a timer that calls {@link CallBannerState.holdExpired} with this key. */
  hold: { key: string; ms: number } | null;
  /** Stop the running hold timer, if any. */
  cancelHold: boolean;
}

export function callBannerCopy(call: { contactName?: string; number?: string }): CallBannerCopy {
  return {
    title: 'Incoming call',
    body: `${callHistoryName(call.contactName, call.number)}. Answer or decline on your phone, or in Sidekick.`,
  };
}

function action(decision: CallBannerDecisionValue, extra: Partial<CallBannerAction> = {}): CallBannerAction {
  return { decision, post: null, close: null, hold: null, cancelHold: false, ...extra };
}

export class CallBannerState {
  private sessions = 0;
  private session: number | null = null;
  /** Keys posted or deliberately not posted (Calls in front) this session. */
  private handled = new Set<string>();
  /** The banner on screen, by key. */
  private showing: string | null = null;
  /** A ringing call waiting for its number. */
  private pending: { key: string; call: IncomingCall } | null = null;

  /** The link is up. Whatever an earlier session left is closed rather than carried over. */
  sessionReady(): CallBannerAction {
    const close = this.showing;
    const cancelHold = this.pending !== null;
    this.sessions += 1;
    this.session = this.sessions;
    this.handled.clear();
    this.showing = null;
    this.pending = null;
    return action(CallBannerDecision.NONE, { close, cancelHold });
  }

  /** The link went down. A banner for a call this Mac can no longer see is closed. */
  sessionEnded(): CallBannerAction {
    const close = this.showing;
    const cancelHold = this.pending !== null;
    this.session = null;
    this.handled.clear();
    this.showing = null;
    this.pending = null;
    return action(CallBannerDecision.NONE, { close, cancelHold });
  }

  /** The call card changed — a new or re-sent `call.incoming`, or `null` when it was cleared. */
  onCall(call: IncomingCall | null, view: CallBannerView): CallBannerAction {
    const key = call && this.session !== null ? `${this.session}:${call.callId}:${call.startedAtMs}` : null;
    const ringing = call?.state === 'ringing';

    // Anything on screen or held that is not this call, still ringing, goes.
    let close: string | null = null;
    if (this.showing && (this.showing !== key || !ringing)) {
      close = this.showing;
      this.showing = null;
    }
    let cancelHold = false;
    if (this.pending && (this.pending.key !== key || !ringing)) {
      this.pending = null;
      cancelHold = true;
    }

    if (!call) return action(CallBannerDecision.NOT_RINGING, { close, cancelHold });
    if (!view.enabled) return action(CallBannerDecision.GATE_OFF, { close, cancelHold });
    if (key === null) return action(CallBannerDecision.NO_SESSION, { close, cancelHold });
    if (!ringing) return action(CallBannerDecision.NOT_RINGING, { close, cancelHold });

    // The correction for a held call: post now, with the name, instead of on expiry.
    if (this.pending?.key === key) {
      this.pending.call = call;
      if (!hasNumber(call)) return action(CallBannerDecision.HOLD, { close, cancelHold });
      this.pending = null;
      return this.decide(key, call, view, { close, cancelHold: true });
    }
    if (this.handled.has(key)) return action(CallBannerDecision.ALREADY_HANDLED, { close, cancelHold });

    if (!hasNumber(call) && !inFront(view)) {
      this.pending = { key, call };
      return action(CallBannerDecision.HOLD, { close, cancelHold, hold: { key, ms: CALL_BANNER_HOLD_MS } });
    }
    return this.decide(key, call, view, { close, cancelHold });
  }

  /** The hold timer fired. Posts what is known now, unless the call has moved on. */
  holdExpired(key: string, view: CallBannerView): CallBannerAction {
    if (!this.pending || this.pending.key !== key) return action(CallBannerDecision.NONE);
    const { call } = this.pending;
    this.pending = null;
    if (!view.enabled) return action(CallBannerDecision.GATE_OFF);
    return this.decide(key, call, view, {});
  }

  private decide(
    key: string,
    call: IncomingCall,
    view: CallBannerView,
    extra: Partial<CallBannerAction>,
  ): CallBannerAction {
    this.handled.add(key);
    if (inFront(view)) return action(CallBannerDecision.CALLS_IN_FRONT, extra);
    this.showing = key;
    return action(CallBannerDecision.POST, { ...extra, post: { key, ...callBannerCopy(call) } });
  }
}

function hasNumber(call: IncomingCall): boolean {
  return (call.number ?? '').trim().length > 0 || (call.contactName ?? '').trim().length > 0;
}

function inFront(view: CallBannerView): boolean {
  return view.windowFocused && view.currentScreen === 'calls';
}
