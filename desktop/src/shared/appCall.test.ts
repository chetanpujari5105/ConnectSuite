import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// `createRequire`, not `import`: the file under test carries no `export` keyword, because a shared
// file that does compiles to CommonJS and throws on its first line in the browser (defect 94).
const require_ = createRequire(import.meta.url);
const { appCallFor, appCallNote, appCallWho, appCallStatus, isAppCallNotification, TELEPHONY_PACKAGES } =
  require_('./appCall.ts') as {
    appCallFor(
      call: { number?: string; contactName?: string } | null,
      notifications: readonly Notif[],
    ): { appName: string; package: string; who?: string } | null;
    appCallNote(appName: string): string;
    appCallWho(found: { appName: string; who?: string }): string;
    appCallStatus(state: string, found: { appName: string }): string;
    isAppCallNotification(notif: Notif): boolean;
    TELEPHONY_PACKAGES: string[];
  };

interface Notif {
  package: string;
  appName?: string;
  title?: string;
  text?: string;
  category?: string;
  ongoing: boolean;
}

const whatsappRinging: Notif = {
  package: 'com.whatsapp',
  appName: 'WhatsApp',
  title: 'Sahil Chaudhary',
  text: 'Incoming video call',
  category: 'call',
  ongoing: true,
};

/** What the phone's own dialer posts for a cellular call. The lookalike this rule must exclude. */
const dialerRinging: Notif = {
  package: 'com.samsung.android.incallui',
  appName: 'Phone',
  title: 'Unknown',
  category: 'call',
  ongoing: true,
};

test('a call with no number and a live WhatsApp call notification is named', () => {
  const found = appCallFor({ number: '' }, [whatsappRinging]);
  assert.deepEqual(found, {
    appName: 'WhatsApp',
    package: 'com.whatsapp',
    who: 'Sahil Chaudhary',
  });
  assert.equal(appCallWho(found!), 'Sahil Chaudhary');
  assert.equal(appCallStatus('ringing', found!), 'Ringing · WhatsApp');
});

/**
 * The discriminator, and the reason "there is a call notification" is not one.
 *
 * A withheld-number cellular call has an empty number too, and the phone's own dialer posts a
 * `category: "call"` notification for it. Without the package exclusion this rule would rename an
 * ordinary phone call after the dialer.
 */
test('the phone dialer own call notification does NOT name the call', () => {
  assert.equal(appCallFor({ number: '' }, [dialerRinging]), null);
  // The control: the identical shape from a non-dialer package is found, so this is the package
  // doing the work rather than the rule failing to match anything at all.
  assert.ok(appCallFor({ number: '' }, [whatsappRinging]));
});

test('every excluded package is excluded, and a suffixed variant of one is too', () => {
  for (const pkg of TELEPHONY_PACKAGES) {
    assert.equal(
      isAppCallNotification({ package: pkg, category: 'call', ongoing: true }),
      false,
      `${pkg} was treated as an app call`,
    );
  }
  assert.equal(
    isAppCallNotification({ package: 'com.android.dialer.google', category: 'call', ongoing: true }),
    false,
    'a package under an excluded prefix is excluded',
  );
  // Control: a package that merely *starts with the same letters* is not swallowed by the prefix.
  assert.equal(
    isAppCallNotification({ package: 'com.android.dialerish', category: 'call', ongoing: true }),
    true,
    'the prefix match is on a path segment, not on characters',
  );
});

/**
 * The guard that keeps this from touching ordinary calls at all.
 *
 * A call with a number came from the phone network, whatever happens to be on screen. Without this
 * a WhatsApp notification arriving during a real call would rename the real call.
 */
test('a call that HAS a number is never renamed, even with an app call notification up', () => {
  assert.equal(appCallFor({ number: '+919604375820' }, [whatsappRinging]), null);
  assert.equal(appCallFor({ number: ' ' }, [whatsappRinging])?.appName, 'WhatsApp');
});

test('a call notification that is not ongoing is history, not a live call', () => {
  // A missed-call summary carries category `call` and is dismissible. Naming a live card from one
  // would put a caller from an hour ago on screen.
  assert.equal(appCallFor({ number: '' }, [{ ...whatsappRinging, ongoing: false }]), null);
  assert.ok(appCallFor({ number: '' }, [whatsappRinging]), 'control: ongoing is what differs');
});

test('a non-call notification never names a call', () => {
  const message: Notif = {
    package: 'com.whatsapp',
    appName: 'WhatsApp',
    title: 'Sahil Chaudhary',
    text: 'see you at 6',
    category: 'msg',
    ongoing: false,
  };
  assert.equal(appCallFor({ number: '' }, [message]), null);
});

test('no call, and no notifications, are both null rather than a throw', () => {
  assert.equal(appCallFor(null, [whatsappRinging]), null);
  assert.equal(appCallFor({ number: '' }, []), null);
  assert.equal(appCallFor({}, []), null);
});

test('an app that names nobody still names itself', () => {
  const anonymous: Notif = { package: 'org.thoughtcrime.securesms', appName: 'Signal', category: 'call', ongoing: true };
  const found = appCallFor({ number: '' }, [anonymous])!;
  assert.equal(found.who, undefined);
  assert.equal(appCallWho(found), 'Signal call');
});

/**
 * Defect 28's rule, which is that a package id is a handle and never the only thing a person reads.
 * The phone resolves `appName` through `AppLabels.of`; if it somehow arrives blank the package is
 * the honest fallback, and it is still better than an empty headline.
 */
test('a missing app label falls back to the package rather than to a blank card', () => {
  const unlabelled: Notif = { package: 'com.example.dialer2', appName: '  ', category: 'call', ongoing: true };
  assert.equal(appCallFor({ number: '' }, [unlabelled])!.appName, 'com.example.dialer2');
});

/**
 * The copy is asserted rather than eyeballed, because its whole job is to be careful about what is
 * and is not established, and a later edit that made it confident would be invisible.
 */
test('the note claims only what is measured, and refuses the two things that are not', () => {
  const note = appCallNote('WhatsApp');
  assert.match(note, /WhatsApp is hosting this call/);
  assert.match(note, /not measured/, 'it must say the controls are unproven, not that they fail');
  assert.match(note, /answer on the phone/, 'and it must name the way out');
  assert.doesNotMatch(note, /cannot|can't|will not/, 'nobody has established that');
  assert.doesNotMatch(note, /video|audio-only|voice call/, 'category "call" does not carry that');
});

test('the status line never claims a call kind, at any state', () => {
  for (const state of ['ringing', 'active', 'dialing']) {
    const line = appCallStatus(state, { appName: 'WhatsApp' });
    assert.match(line, / · WhatsApp$/);
    assert.doesNotMatch(line, /video/);
  }
  assert.equal(appCallStatus('active', { appName: 'WhatsApp' }), 'In progress · WhatsApp');
});
