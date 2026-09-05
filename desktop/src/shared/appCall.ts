/**
 * Naming a call the phone network is not hosting — a WhatsApp or Signal call — from the
 * notification that app posts while it rings.
 *
 * ### Why this is a join on the Mac and not a new field on the wire
 *
 * Both halves already arrive. `call.incoming` carries the episode; `notif.posted` carries
 * `package`, `appName` (already resolved through `AppLabels.of` on the phone), `category` and
 * `ongoing`. So this is a correlation between two streams the Mac already holds, and it needs **no
 * contract change and no new grant** — the notification-listener permission it depends on is the
 * one the notifications feature already requires.
 *
 * ### What it is for
 *
 * `CallWatcher` already sees these calls: a 68-minute WhatsApp video call produced a complete
 * episode with correct timing (`docs/defects.md` → 47). What it cannot get is **identity**. A
 * self-managed call carries no `EXTRA_INCOMING_NUMBER` — correctly, there is no phone number — so
 * the card reads `Unknown number · In progress`, which is true, useless, and *pixel-identical to a
 * withheld-number cellular call*. Two very different facts drawn as one card.
 *
 * ### The discriminator, and its limitation, stated rather than assumed
 *
 * "There is a call notification" does **not** separate them: the phone's own dialer posts one too,
 * with the same `category`. The package is what separates them, so [TELEPHONY_PACKAGES] is an
 * exclusion set — and it is a **list from one handset**, which is this repo's standing single-device
 * problem (`docs/single-device-audit.md`). A dialer package not on it would have its call named
 * after the dialer.
 *
 * That is why this function only ever **adds a name**. It does not remove a control, gate an
 * action, or change what any button does. The worst case for a wrong answer is a wrong label on a
 * card whose buttons behave exactly as they did before — chosen deliberately, because the failure
 * mode of the other direction is taking Reject away from a real ringing call.
 *
 * ### What this deliberately does not claim
 *
 * **Not whether the call is audio or video.** `Notification.category` is `"call"` for both. The
 * distinction lives either in the app's own prose (`"Incoming video call"`), which is another app's
 * copy in the user's locale and changes silently in any update, or in `Notification.CallStyle`'s
 * `EXTRA_CALL_IS_VIDEO`, which is structured and correct — and which this phone does not put on the
 * wire, because nothing has yet measured whether WhatsApp populates it. So the card says
 * *"WhatsApp call"*, never *"WhatsApp video call"*. See `docs/testing.md` → Phase 7 Slice 35.
 */

/**
 * Packages whose call notification means *the phone network is ringing*, not an app.
 *
 * Read as: a notification from one of these is the dialer telling you about a cellular call, and
 * the call card should stay exactly as it is. Everything else is an app hosting its own call.
 *
 * **This list came off one SM-S938B and is the weakest part of this file.** It is a prefix match so
 * that OEM variants (`com.samsung.android.dialer`, `com.samsung.android.incallui`) are covered by
 * one entry, and the fallback when it is wrong is a wrong label rather than a lost control.
 */
const TELEPHONY_PACKAGES = [
  'com.android.server.telecom',
  'com.android.phone',
  'com.android.dialer',
  'com.android.incallui',
  'com.google.android.dialer',
  'com.samsung.android.dialer',
  'com.samsung.android.incallui',
  'com.samsung.android.app.telephonyui',
];

/** Android's `Notification.CATEGORY_CALL`. Verified live on this device: `category` is populated. */
const CALL_CATEGORY = 'call';

interface CallNotif {
  package: string;
  appName?: string;
  title?: string;
  text?: string;
  category?: string;
  ongoing: boolean;
}

interface CallEpisode {
  number?: string;
  contactName?: string;
}

/** What was found, or `null` for "this is an ordinary phone call, leave the card alone". */
interface AppCall {
  /** The resolved label — *WhatsApp*. Never a package id in a sentence; that is defect 28's rule. */
  appName: string;
  /** The package, as a machine handle only. */
  package: string;
  /** Whoever the app named in its notification, if it named anyone. */
  who?: string;
}

/** True when this notification is an app telling us it is hosting a call right now. */
function isAppCallNotification(notif: CallNotif): boolean {
  if (notif.category !== CALL_CATEGORY) return false;
  // A call notification that is not ongoing is a *missed* call summary, which is history rather
  // than a live call. Naming a live card from one would put a stale caller on screen.
  if (!notif.ongoing) return false;
  const pkg = notif.package ?? '';
  return !TELEPHONY_PACKAGES.some((known) => pkg === known || pkg.startsWith(`${known}.`));
}

/**
 * The app hosting this call, or `null`.
 *
 * Requires the episode to have **no number**. A call with a number came from the phone network and
 * is not this, whatever notifications happen to be on screen — which is the guard against naming an
 * ordinary call after whichever app posted a call notification at the same moment.
 */
function appCallFor(call: CallEpisode | null, notifications: readonly CallNotif[]): AppCall | null {
  if (!call) return null;
  if ((call.number ?? '').trim().length > 0) return null;

  const hit = notifications.find(isAppCallNotification);
  if (!hit) return null;

  return {
    appName: hit.appName?.trim() || hit.package,
    package: hit.package,
    // The app's own title is the caller. Only used when the phone could not resolve a contact
    // name, which for a self-managed call it never can — there is no number to look up.
    who: hit.title?.trim() || undefined,
  };
}

/**
 * The one sentence the card carries for an app call.
 *
 * Every clause is something this Mac can stand behind. It says which app owns the call, because
 * that is measured; it says the two controls may not reach it, because that is **unmeasured** and
 * saying so is cheaper than a person discovering it while a phone rings; and it names the way out.
 *
 * It deliberately does **not** say audio or video — see the file comment — and it does not say
 * "cannot", because nobody has established that. `docs/testing.md` → Phase 7 Slice 35 carries the
 * stimulus that would settle it.
 */
function appCallNote(appName: string): string {
  return (
    `${appName} is hosting this call, not the phone network. Mute, speaker and keypad tones are ` +
    `on the phone, and whether Answer and Reject reach an in-app call is not measured — if ` +
    `nothing happens, answer on the phone.`
  );
}

/** The card's headline for an app call: the person if the app named one, else the app. */
function appCallWho(found: AppCall): string {
  return found.who ?? `${found.appName} call`;
}

/** The card's second line. Names the app rather than a number, because there is no number. */
function appCallStatus(state: string, found: AppCall): string {
  const label = state === 'ringing' ? 'Ringing' : state === 'dialing' ? 'Dialling' : 'In progress';
  return `${label} · ${found.appName}`;
}

/*
 * No `export` anywhere in this file, and that is load-bearing rather than a style choice: the page
 * loads it as a plain `<script>`, an `export` compiles to CommonJS whose first emitted line
 * references `exports`, and there is no `exports` in a classic script — see defect 94 and
 * `scripts/check-renderer-scripts.mjs`, which refuses a commit that reintroduces one.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.appCallFor = appCallFor;
  g.appCallNote = appCallNote;
  g.appCallWho = appCallWho;
  g.appCallStatus = appCallStatus;
  g.isAppCallNotification = isAppCallNotification;
}

if (typeof module !== 'undefined') {
  module.exports = {
    appCallFor,
    appCallNote,
    appCallWho,
    appCallStatus,
    isAppCallNotification,
    TELEPHONY_PACKAGES,
  };
}
