import { log } from './logger';

/**
 * Switches that let a test reach a path the Mac's own guards make unreachable.
 *
 * Two error paths in the notification pane are real, worth testing, and impossible to reach from
 * the UI, because the Mac refuses the request before it can cross the link:
 *
 *  - **`NOT_FOUND` (step 51).** The step asks for a Dismiss click that *races* `notif.removed`.
 *    The Mac clears the row about 100ms after the phone drops it, and no human can swipe a phone
 *    and click a Mac inside that window — `cmd notification` has no cancel subcommand either, so
 *    it cannot be driven from adb. Stalling `notif.removed` makes the window as wide as you like.
 *  - **`NO_MEDIA_SESSION` and `FEATURE_UNAVAILABLE` (steps 66 and 65).** The remote card draws
 *    only the buttons the playing session says it supports, and draws none at all when nothing is
 *    playing — so the phone's own two refusals sit behind a Mac that has already declined. Both
 *    are the correct UI and both make the last check in the chain untestable.
 *  - **`NO_ACTIVE_CALL` on a stale card (step 61).** The Mac clears its call card the moment
 *    `call.ended` arrives, so a Reject aimed at a finished call is unreachable by hand for the
 *    same reason step 51's stale dismiss was: no human wins that race. Swallowing `call.ended`
 *    makes the window as wide as you like, and lets the clause that actually matters be checked —
 *    that the stale Reject does **not** land on the next call instead.
 *  - **`RECIPIENT_MISMATCH` (step 58a).** `SmsClient.send` takes no recipient parameter at all —
 *    it resolves the addresses from the thread rows it holds, which is what makes a mismatched
 *    pair unconstructable from the UI. That guard is the point, and it is also why the phone's own
 *    check, the one guarding a message delivered to the wrong person, can never otherwise run.
 *    This substitutes a reserved fiction number so the probe cannot reach anybody real.
 *  - **`NO_REPLY_ACTION` (step 49).** The phone's guard exists (`NotificationFeature.kt:437`) and
 *    the Mac's `canReply` check refuses first, so the phone branch never runs. That ordering is
 *    correct — three checks for one rule, because replying is the verb whose failure is visible to
 *    somebody else — and it means the last of the three is untested without this.
 *
 * Both are **off unless `CONNECTSUITE_DEBUG_SWITCHES` names them**, and the whole module is inert
 * in a packaged build — enforced in [readDebugSwitches], which returns all-off when packaged.
 * They weaken guards; they must never be reachable by a user who did not type them on a command
 * line.
 *
 *     CONNECTSUITE_DEBUG_SWITCHES=stallRemoved,bypassReplyGuard npm start
 *
 * Every switch that is *on* announces itself once, at warning level, in the first lines of the log
 * — `main.ts` reads them at startup for exactly that reason. A guard that is quietly disabled is
 * worse than no guard: the next confusing test result would be blamed on the feature.
 */
export interface DebugSwitches {
  /** Drop `notif.removed` instead of applying it, so rows go stale on purpose. Step 51. */
  stallRemoved: boolean;
  /** Let a reply past the Mac's `canReply` refusal so the phone can answer. Step 49. */
  bypassReplyGuard: boolean;
  /**
   * Send a transport command the state says is impossible, so the phone answers. Steps 65 and 66.
   *
   * One switch for two steps because it is one guard: the Mac refuses a command when the session
   * has said it cannot do it (`canSkipNext` false — step 65) and when there is no session at all
   * (step 66). Both refusals happen in `RemoteClient.command` before anything crosses the link.
   */
  bypassRemoteGuard: boolean;
  /**
   * Send an `sms.send` whose addresses disagree with its `threadId`, so the phone refuses. Step 58a.
   *
   * The most dangerous switch here, and the one whose guard matters most: it deliberately breaks
   * the send rule the Mac enforces structurally. It substitutes a documentation-reserved number
   * (`MISMATCH_PROBE_NUMBER`) rather than a real one, so a phone that wrongly *accepted* the pair
   * would still not deliver a message to a person.
   */
  forceRecipientMismatch: boolean;
  /**
   * Drop `call.ended` instead of applying it, so the call card goes stale on purpose. Step 61.
   *
   * The sibling of `stallRemoved`, one feature over, and for the same reason: the interesting
   * behaviour is what an action does when the thing it names is already gone.
   */
  stallCallEnded: boolean;
  /**
   * Delay the float renderer's listener registration, so the `onReady` push **loses** the race.
   *
   * Defect 105 is a race, and a race nobody has watched lose is a fix against a description. The
   * losing side could not be produced on demand: whether main's replay reaches the float before or
   * after its `onVideoFrame` handler exists is decided by process scheduling, and on every machine
   * tried here the push won. This makes the loss deterministic, so the old code can be shown failing
   * before the new code is shown passing.
   *
   * It is the only switch here that exists to prove a *fix* rather than to reach an error path, and
   * it stays after the fix for the same reason the other five stay: the next person to touch the
   * start path needs to be able to lose the race on purpose.
   */
  delayFloatListeners: boolean;
  /**
   * Send `hello` **without** `ext`, so this Mac is an old peer to the phone. Feature A slice 2.
   *
   * The compatibility case the contract promises: a new phone facing an old Mac must not offer and
   * must not wait. An old build is the honest stimulus and is not kept around, so this reproduces
   * the one thing about it that matters — the absent field.
   */
  shareOmitExt: boolean;
  /**
   * Validate a `share.offer` and then **never answer it**. Feature A slice 2.
   *
   * The only way to watch the phone's expiry path end to end: every normal run answers at once with
   * the `not-available` stub, so an offer never lives long enough to expire. With this on, it does.
   */
  shareSilent: boolean;
  /**
   * Accept **synthetic probe offers only** — the debug `ShareOfferProbeActivity`'s
   * `sidekick-offer-probe-<n>.bin`, `application/octet-stream` — once the destination checks pass.
   * Feature A slice 3d, for slice 3e. It never accepts an ordinary share-sheet offer, whatever this
   * says, and `main.ts` forces it off in a packaged build. There is no production auto-accept.
   */
  shareAcceptProbe: boolean;
  /**
   * Receive shares into the development scratch folder (`<userData>/dev-share-receive/`) instead of
   * the configured receive folder, which is left untouched. Forced off in a packaged build.
   */
  shareDevReceive: boolean;
  /**
   * Ask to advertise `share.file: 2`. **Refused unless `shareAcceptProbe` (with at least one
   * allow-listed digest) and `shareDevReceive` are also on**, and forced off in a packaged build —
   * `shareActivation.ts` decides, and fails closed. Feature A slice 3e's gate; off by default.
   */
  shareV2: boolean;
  /**
   * Hold this development Mac at `share.file: 2` — reproduces a **version-2 Mac** for a skew test. An
   * unpackaged Mac advertises `share.file: 3` by default (docs/protocol.md → Share → Version 3); this can
   * only lower that. Forced off in a packaged build, which advertises 3 only under `SHARE_V3_RELEASE`.
   * Off by default.
   */
  shareV3Off: boolean;
  /**
   * The webcam's development gate (docs/protocol.md → Webcam → Development and release gates): this Mac
   * advertises `ext.webcam` 1 and runs the camera bridge, **if** the bridge is built beside the app.
   * Forced off in a packaged build, which waits for `WEBCAM_RELEASE`. It weakens no guard: the bridge
   * still refuses to ask the phone anything while Sidekick Camera is not installed or the build has no
   * producer identity. Off by default.
   */
  webcamDev: boolean;
  /**
   * Arms the Camera v2 **encoder spike** (docs/camera-v2-encoder-spike.md, `webcamSpike.ts`): one
   * person-triggered `webcam.request` per launch, the phone owner's tap, the frames decoded by
   * `sidekick-camera-decode-probe` and discarded. **Needs `webcamDev` too**, the bridge and the probe built
   * at their one paths, and is ignored in a packaged build. It weakens no guard of the production
   * controller — that still refuses every request while Sidekick Camera is absent — and it publishes
   * nothing as a camera. Off by default.
   */
  webcamSpike: boolean;
  /**
   * The incoming-call banner's development gate (`src/shared/callBanner.ts`): a ringing call posts a
   * native banner — *"Incoming call"* — when Sidekick is not in front on Calls. **Not yet verified on
   * hardware**, so it is off by default and forced off in a packaged build by main.ts. It weakens no
   * guard: the banner carries no action and its click only opens the Calls pane.
   */
  callBanner: boolean;
  /**
   * H7 (`docs/pairing-v2-hardware-test-proposal.md`): while pairing is armed, try `127.0.0.1:42611` before
   * every real candidate, so `scripts/pair-decoy.mjs` — an impostor answering without a proof — answers
   * first. It weakens no guard; it lets the guard be read on hardware. Forced off in a packaged build.
   */
  pairDecoyFirst: boolean;
  /**
   * The Keychain notice (2026-10-14, `identityStore.ts`) in a **development** build, so its sheet can be
   * seen on a scratch profile. A packaged build shows it on every fresh profile without this; a
   * development build without it never does, because the development Electron already holds the
   * Keychain item and there is no prompt to warn about.
   */
  keychainNotice: boolean;
}

const NAMES: readonly (keyof DebugSwitches)[] = [
  'stallRemoved',
  'bypassReplyGuard',
  'bypassRemoteGuard',
  'forceRecipientMismatch',
  'stallCallEnded',
  'delayFloatListeners',
  'shareOmitExt',
  'shareSilent',
  'shareAcceptProbe',
  'shareDevReceive',
  'shareV2',
  'shareV3Off',
  'webcamDev',
  'webcamSpike',
  'callBanner',
  'pairDecoyFirst',
  'keychainNotice',
];

/**
 * The switches named by `raw`, the value of `CONNECTSUITE_DEBUG_SWITCHES`.
 *
 * Pure, so the rule is reachable from a test: [debugSwitches] is the only caller, and it passes the
 * real environment and the real packaging fact.
 */
export function readDebugSwitches(raw: string | undefined, packaged: boolean): DebugSwitches {
  const off: DebugSwitches = {
    stallRemoved: false,
    bypassReplyGuard: false,
    bypassRemoteGuard: false,
    forceRecipientMismatch: false,
    stallCallEnded: false,
    delayFloatListeners: false,
    shareOmitExt: false,
    shareSilent: false,
    shareAcceptProbe: false,
    shareDevReceive: false,
    shareV2: false,
    shareV3Off: false,
    webcamDev: false,
    webcamSpike: false,
    callBanner: false,
    pairDecoyFirst: false,
    keychainNotice: false,
  };
  // The one place a packaged build is told apart, for all seventeen: the environment is ignored
  // whole. Six switches are read in their own modules with nothing else between them and a guard,
  // and a packaged build refuses only argv switches (`entry.js`), so this line is what stops
  // `CONNECTSUITE_DEBUG_SWITCHES=bypassReplyGuard /Applications/Sidekick.app/…` weakening one.
  if (packaged) {
    if (raw) log.warn('debug', `CONNECTSUITE_DEBUG_SWITCHES ignored: a packaged build takes no debug switches`);
    return off;
  }
  if (!raw) return off;

  const asked = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const on = { ...off };
  const unknown: string[] = [];
  for (const name of asked) {
    if ((NAMES as readonly string[]).includes(name)) on[name as keyof DebugSwitches] = true;
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    // Loudly, because a typo'd switch is silently *off*, and the test that needed it would then
    // fail for a reason that has nothing to do with the feature.
    log.warn('debug', `Unknown debug switch(es) ignored: ${unknown.join(', ')} — known: ${NAMES.join(', ')}`);
  }
  return on;
}

let cached: DebugSwitches | null = null;

/** The switches for this run. Read once; announced once. */
export function debugSwitches(): DebugSwitches {
  if (cached) return cached;
  cached = readDebugSwitches(process.env.CONNECTSUITE_DEBUG_SWITCHES, isPackaged());
  const on = NAMES.filter((n) => cached![n]);
  if (on.length > 0) {
    log.warn('debug', `DEBUG SWITCHES ON: ${on.join(', ')} — guards are weakened, this is not a normal run`);
  }
  return cached;
}

/** Test seam. Never called by the app. */
export function resetDebugSwitchesForTests(): void {
  cached = null;
}

let packagedForTests: boolean | null = null;

/** Test seam: what [isPackaged] answers, or `null` to ask Electron again. Never called by the app. */
export function setPackagedForTests(packaged: boolean | null): void {
  packagedForTests = packaged;
  cached = null;
}

/**
 * Whether this is a packaged build — asked of Electron lazily, so this module stays importable by
 * tests with no Electron present.
 *
 * Under plain Node (the test runner) `process.versions.electron` is absent and `require('electron')`
 * is a path string, so the answer is *development*. Inside Electron the answer is `app.isPackaged`;
 * if `app` cannot be read there at all, the answer is *packaged*, because the cost of wrongly
 * weakening a guard is higher than the cost of a development run that has to be restarted.
 */
export function isPackaged(): boolean {
  if (packagedForTests !== null) return packagedForTests;
  if (!process.versions.electron) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean } } | string;
    const app = typeof electron === 'object' && electron !== null ? electron.app : undefined;
    return app ? app.isPackaged === true : true;
  } catch {
    return true;
  }
}
