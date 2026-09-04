import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NotifyCooldown,
  withinCooldown,
  NO_HISTORY,
  EVENT_COOLDOWN_MS,
  STATUS_COOLDOWN_MS,
} from './notifyCooldown';
import { NotifyDecision, notifyDecision } from './nativeNotify';
import type { PhoneNotification } from './protocol';

const T0 = 1_700_000_000_000;

test('a key that has never bannered is never within a cooldown', () => {
  // `null` is "never", which is not "long ago" — and the difference decides whether a download's
  // completion banner goes out at all.
  assert.equal(withinCooldown(NO_HISTORY, T0), false);
  assert.equal(withinCooldown({ seenOngoing: true, lastBanneredAtMs: null }, T0), false);
});

test('the event window is short and the status window is long', () => {
  const event = { seenOngoing: false, lastBanneredAtMs: T0 };
  const status = { seenOngoing: true, lastBanneredAtMs: T0 };
  assert.equal(withinCooldown(event, T0 + EVENT_COOLDOWN_MS - 1), true);
  assert.equal(withinCooldown(event, T0 + EVENT_COOLDOWN_MS), false, 'the boundary is outside');
  assert.equal(withinCooldown(status, T0 + EVENT_COOLDOWN_MS + 1), true, 'a status key is still held');
  assert.equal(withinCooldown(status, T0 + STATUS_COOLDOWN_MS), false);
});

/** The store's writes — the half a decision test cannot see. Defect 67's lesson. */
test('ongoing is remembered for the session, not just for the next post', () => {
  const store = new NotifyCooldown();
  store.record('k', NotifyDecision.ONGOING, T0);
  store.record('k', NotifyDecision.NOTIFY, T0 + 1000);
  // A ticker FLAPS. Asking whether the *last* post was ongoing would let every other frame through,
  // which is exactly the defect.
  assert.equal(store.historyFor('k').seenOngoing, true);
});

test('the window is armed by a banner and by nothing else', () => {
  const store = new NotifyCooldown();
  store.record('k', NotifyDecision.ONGOING, T0);
  store.record('k', NotifyDecision.UPDATE, T0 + 500);
  assert.equal(store.historyFor('k').lastBanneredAtMs, null, 'a suppressed post armed the window');
  store.record('k', NotifyDecision.NOTIFY, T0 + 900);
  assert.equal(store.historyFor('k').lastBanneredAtMs, T0 + 900);
});

test('a suppressed post does not extend its own silence', () => {
  const store = new NotifyCooldown();
  store.record('k', NotifyDecision.NOTIFY, T0);
  store.record('k', NotifyDecision.COOLDOWN, T0 + 5_000);
  // If a held post pushed the window forward, a ticker would hold itself silent forever and the key
  // could never recover.
  assert.equal(store.historyFor('k').lastBanneredAtMs, T0);
});

test('a reset clears the session shape', () => {
  const store = new NotifyCooldown();
  store.record('k', NotifyDecision.ONGOING, T0);
  store.reset();
  assert.deepEqual(store.historyFor('k'), NO_HISTORY);
  assert.equal(store.size, 0);
});

// --- the two sequences from the run that produced the defect -------------------------------------

const notif = (over: Partial<PhoneNotification> = {}): PhoneNotification =>
  ({
    key: 'k',
    package: 'com.example',
    title: 't',
    text: 'b',
    whenMs: T0,
    ongoing: false,
    isGroupSummary: false,
    ...over,
  }) as PhoneNotification;

/** Drives the real decision and the real store together, the way `consider` does. */
function run(posts: PhoneNotification[]): Record<string, number> {
  const store = new NotifyCooldown();
  const tally: Record<string, number> = {};
  let previous: { whenMs: number } | null = null;
  for (const n of posts) {
    const decision = notifyDecision(n, {
      sessionReadyAtMs: T0 - 1000,
      previous,
      windowFocused: false,
      currentScreen: 'overview',
      history: store.historyFor(n.key),
      nowMs: n.whenMs,
    });
    tally[decision] = (tally[decision] ?? 0) + 1;
    store.record(n.key, decision, n.whenMs);
    previous = { whenMs: n.whenMs };
  }
  return tally;
}

test('defect 84 — a media session that really stops and restarts banners once, not eleven times', () => {
  // Jio's measured shape, and the shape is honest: a music player whose playback genuinely stopped
  // and restarted, ~19 s apart. Each post is a real new session — not ongoing in the gap, with a
  // genuinely advanced timestamp — so ONGOING and UPDATE are both RIGHT to let it through. What
  // has to say no is a limit on how often one key may interrupt somebody.
  const posts: PhoneNotification[] = [];
  for (let i = 0; i < 30; i += 1) {
    posts.push(notif({ whenMs: T0 + i * 19_000, ongoing: i % 3 !== 0 }));
  }
  const tally = run(posts);
  assert.equal(tally[NotifyDecision.NOTIFY], 1, 'more than one banner for one ticking notification');
  assert.ok((tally[NotifyDecision.COOLDOWN] ?? 0) > 5, 'the cooldown is not what held them');
});

test('the control from the same run — a conversation key is untouched', () => {
  // com.whatsapp posted=4 updated=3 → 1 notify, and it was never `ongoing`. Two messages minutes
  // apart in one chat must still be two banners: that is the notification this feature exists for.
  const tally = run([
    notif({ key: 'chat', whenMs: T0 }),
    notif({ key: 'chat', whenMs: T0 + 120_000 }),
    notif({ key: 'chat', whenMs: T0 + 240_000 }),
  ]);
  assert.equal(tally[NotifyDecision.NOTIFY], 3);
  assert.equal(tally[NotifyDecision.COOLDOWN], undefined);
});

test('a burst typed in one breath is one banner', () => {
  const tally = run([
    notif({ key: 'chat', whenMs: T0 }),
    notif({ key: 'chat', whenMs: T0 + 3_000 }),
    notif({ key: 'chat', whenMs: T0 + 6_000 }),
  ]);
  assert.equal(tally[NotifyDecision.NOTIFY], 1);
  assert.equal(tally[NotifyDecision.COOLDOWN], 2);
});

test('a download completion still banners — the objection this design has to survive', () => {
  // Progress ticks are ONGOING, which never banners, so they never arm the window. The completion
  // is the first banner this key has produced and it goes out, even though the key is status-shaped.
  const posts: PhoneNotification[] = [];
  for (let i = 0; i < 20; i += 1) posts.push(notif({ key: 'dl', whenMs: T0 + i * 1000, ongoing: true }));
  posts.push(notif({ key: 'dl', whenMs: T0 + 21_000, ongoing: false }));
  const tally = run(posts);
  assert.equal(tally[NotifyDecision.NOTIFY], 1, 'the completion was eaten by the status window');
  assert.equal(tally[NotifyDecision.ONGOING], 20);
});

test('two different keys do not share a cooldown', () => {
  const tally = run([notif({ key: 'a', whenMs: T0 }), notif({ key: 'b', whenMs: T0 + 1000 })]);
  assert.equal(tally[NotifyDecision.NOTIFY], 2);
});

test('the cooldown is decided last, so a quiet window is not reported as one', () => {
  // Focused on the notifications pane: the row is already on screen, and that is a different reason
  // from "this key just bannered". Collapsing them would lose the distinction the tally exists for.
  const store = new NotifyCooldown();
  store.record('k', NotifyDecision.NOTIFY, T0);
  const decision = notifyDecision(notif({ whenMs: T0 + 1000 }), {
    sessionReadyAtMs: T0 - 1000,
    previous: null,
    windowFocused: true,
    currentScreen: 'notifications',
    history: store.historyFor('k'),
    nowMs: T0 + 1000,
  });
  assert.equal(decision, NotifyDecision.ALREADY_VISIBLE);
});
