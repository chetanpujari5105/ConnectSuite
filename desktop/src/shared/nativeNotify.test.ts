import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CLOCK_SKEW_GRACE_MS,
  NotifyDecision,
  notifyCopy,
  notifyDecision,
  refusalCopy,
  type NotifyContext,
} from './nativeNotify';
import type { PhoneNotification } from './protocol';

const SESSION_AT = 1_700_000_000_000;

function notification(over: Partial<PhoneNotification> = {}): PhoneNotification {
  return {
    key: 'k1',
    package: 'com.whatsapp',
    appName: 'WhatsApp',
    title: 'Ana',
    text: 'on my way',
    whenMs: SESSION_AT + 5_000,
    ongoing: false,
    clearable: true,
    isGroupSummary: false,
    canReply: true,
    actions: [],
    ...over,
  };
}

function context(over: Partial<NotifyContext> = {}): NotifyContext {
  return {
    sessionReadyAtMs: SESSION_AT,
    previous: null,
    windowFocused: false,
    currentScreen: 'overview',
    ...over,
  };
}

test('an ordinary new message notifies', () => {
  assert.equal(notifyDecision(notification(), context()), NotifyDecision.NOTIFY);
});

test('a group summary does not — it has no title and no text to draw', () => {
  assert.equal(
    notifyDecision(notification({ isGroupSummary: true }), context()),
    NotifyDecision.GROUP_SUMMARY,
  );
});

test('an ongoing notification does not — it is a status, not an event', () => {
  assert.equal(notifyDecision(notification({ ongoing: true }), context()), NotifyDecision.ONGOING);
});

test('a re-post whose timestamp did not advance does not — a ticking progress bar', () => {
  const n = notification();
  assert.equal(
    notifyDecision(n, context({ previous: { whenMs: n.whenMs } })),
    NotifyDecision.UPDATE,
  );
});

test('a re-post with an OLDER held copy still counts as the same event', () => {
  const n = notification({ whenMs: SESSION_AT + 5_000 });
  assert.equal(
    notifyDecision(n, context({ previous: { whenMs: SESSION_AT + 9_000 } })),
    NotifyDecision.UPDATE,
  );
});

/*
 * The case that would have broken a real test of this feature. Messaging apps put one notification
 * per conversation and update it in place, so a second message in an unread chat arrives with the
 * SAME key. Suppressing on the key alone silences exactly the notification this feature exists for.
 */
test('a SECOND message in an unread chat notifies — same key, later timestamp', () => {
  const first = notification({ key: 'chat-ana', whenMs: SESSION_AT + 5_000 });
  const second = notification({ key: 'chat-ana', whenMs: SESSION_AT + 60_000, text: 'still there?' });
  assert.equal(
    notifyDecision(second, context({ previous: { whenMs: first.whenMs } })),
    NotifyDecision.NOTIFY,
    'a new message in a thread you have not read is a new event, not a redraw',
  );
});

// --- the replay burst, which is the rule this whole file exists for -------------------------------

test('a notification older than the session is the replay burst and does not notify', () => {
  const old = notification({ whenMs: SESSION_AT - 60 * 60 * 1000 });
  assert.equal(notifyDecision(old, context()), NotifyDecision.REPLAY);
});

test('the whole shade replaying on reconnect produces zero banners', () => {
  // Fourteen notifications that were already on the phone, arriving at once on a wake-from-sleep.
  const shade = Array.from({ length: 14 }, (_, i) =>
    notification({ key: `old${i}`, whenMs: SESSION_AT - (i + 1) * 60_000 }),
  );
  const decisions = shade.map((n) => notifyDecision(n, context()));
  assert.equal(
    decisions.filter((d) => d === NotifyDecision.NOTIFY).length,
    0,
    'a reconnect must not dump the phone shade on screen',
  );
  assert.ok(decisions.every((d) => d === NotifyDecision.REPLAY));
});

test('the skew grace admits a notification the phone timestamped slightly early', () => {
  // A phone clock a few seconds behind this Mac must not have its new messages read as replays.
  const slightlyEarly = notification({ whenMs: SESSION_AT - (CLOCK_SKEW_GRACE_MS - 1_000) });
  assert.equal(notifyDecision(slightlyEarly, context()), NotifyDecision.NOTIFY);
});

test('and the grace is bounded — an hour old is still a replay', () => {
  const wayOld = notification({ whenMs: SESSION_AT - CLOCK_SKEW_GRACE_MS - 1 });
  assert.equal(notifyDecision(wayOld, context()), NotifyDecision.REPLAY);
});

test('with no session established nothing is posted', () => {
  assert.equal(
    notifyDecision(notification(), context({ sessionReadyAtMs: null })),
    NotifyDecision.REPLAY,
  );
});

// --- two copies of one alert ---------------------------------------------------------------------

test('focused on the notifications pane suppresses — the row is already on screen', () => {
  assert.equal(
    notifyDecision(
      notification(),
      context({ windowFocused: true, currentScreen: 'notifications' }),
    ),
    NotifyDecision.ALREADY_VISIBLE,
  );
});

test('focused on a DIFFERENT screen still notifies — the row is not on screen there', () => {
  for (const screen of ['overview', 'files', 'mirror', 'settings']) {
    assert.equal(
      notifyDecision(notification(), context({ windowFocused: true, currentScreen: screen })),
      NotifyDecision.NOTIFY,
      `focused on ${screen} should still notify`,
    );
  }
});

test('the notifications pane open but the window NOT focused still notifies', () => {
  // Behind another window with the pane routed: the user cannot see it.
  assert.equal(
    notifyDecision(
      notification(),
      context({ windowFocused: false, currentScreen: 'notifications' }),
    ),
    NotifyDecision.NOTIFY,
  );
});

// --- ordering, because the reason is logged and has to be the true one ---------------------------

test('an ongoing group summary reports the summary rule, not whichever ran second', () => {
  assert.equal(
    notifyDecision(notification({ isGroupSummary: true, ongoing: true }), context()),
    NotifyDecision.GROUP_SUMMARY,
  );
});

// --- copy ----------------------------------------------------------------------------------------

test('copy carries the app name when the title is somebody else', () => {
  const { title, body } = notifyCopy(notification());
  assert.equal(title, 'Ana');
  assert.match(body, /on my way/);
  assert.match(body, /WhatsApp/, 'macOS attributes the banner to Electron, so the app must be in it');
});

test('an untitled notification falls back to the app name, never to an empty string', () => {
  const { title, body } = notifyCopy(notification({ title: undefined, text: undefined }));
  assert.equal(title, 'WhatsApp');
  assert.ok(body.length > 0, 'an empty body would draw a blank banner');
});

test('a notification with neither title nor app name falls back to the package', () => {
  const { title } = notifyCopy(
    notification({ title: undefined, appName: '', package: 'com.example.app' }),
  );
  assert.equal(title, 'com.example.app');
});

// --- the refusal copy, and the defect it replaces -------------------------------------------------

test('a packaged build is told exactly where the switch is', () => {
  const copy = refusalCopy({ packaged: true });
  assert.match(copy.body, /System Settings/);
  assert.match(copy.body, /ConnectSuite/);
  assert.equal(copy.actionable, true);
});

test('a DEV build is never sent to a Setting that does not exist', () => {
  const copy = refusalCopy({ packaged: false });
  assert.ok(
    !/System Settings\s*→\s*Notifications,\s*find/i.test(copy.body),
    'a dev run has no row to find — this is the fixHint-pointing-at-a-nonexistent-Setting failure',
  );
  assert.equal(copy.actionable, false);
});

test('the dev copy never names Electron as a switch to flip', () => {
  const copy = refusalCopy({ packaged: false });
  const text = `${copy.headline} ${copy.body}`;
  assert.ok(
    !/under [“"]?Electron/i.test(text),
    'the original defect: it named a row that is absent, not off',
  );
});

test('the dev copy still says what DOES work, and what to do instead', () => {
  const copy = refusalCopy({ packaged: false });
  assert.match(copy.body, /works normally/, 'a dead end with no next step is the silent no-op');
  assert.match(copy.body, /packaged build/);
});

test('the two cases do not share a headline', () => {
  assert.notEqual(
    refusalCopy({ packaged: true }).headline,
    refusalCopy({ packaged: false }).headline,
  );
});
