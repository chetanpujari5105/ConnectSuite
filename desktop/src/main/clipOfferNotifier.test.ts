import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipOfferNotifier, offerBannerGuidance, type NativeNotificationLike, type OfferBannerStatus } from './clipOfferNotifier';
import { OFFER_NOTIFICATION } from './clipOffers';

function rig(focused = false) {
  const posted: Array<{ options: { title: string; body: string; silent: boolean }; closed: boolean; click: () => void }> = [];
  let opened = 0;
  const n = new ClipOfferNotifier(
    (options) => {
      const rec = { options, closed: false, click: () => undefined as void };
      const native: NativeNotificationLike = {
        on: ((e: string, l: () => void) => { if (e === 'click') rec.click = l; }) as NativeNotificationLike['on'],
        show: () => undefined,
        close: () => { rec.closed = true; },
      };
      posted.push(rec);
      return native;
    },
    () => focused,
    () => { opened += 1; },
  );
  return { n, posted, opened: () => opened };
}

test('the offer banner carries the fixed copy and nothing from the offer — the API cannot pass it', () => {
  const { n, posted } = rig();
  n.announce('offer-1');
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0]!.options, { title: OFFER_NOTIFICATION.title, body: OFFER_NOTIFICATION.body, silent: false });
  // The copy itself names no app, no text and no link.
  assert.doesNotMatch(`${OFFER_NOTIFICATION.title} ${OFFER_NOTIFICATION.body}`, /https?:|\{|\}|\bfrom [A-Z]/);
  assert.equal(ClipOfferNotifier.prototype.announce.length, 1, 'announce takes the offer id and nothing else');
});

test('a click only opens the Clipboard pane and takes the banner down — it never copies', () => {
  const { n, posted, opened } = rig();
  n.announce('offer-1');
  posted[0]!.click();
  assert.equal(opened(), 1);
  assert.equal(posted[0]!.closed, true);
  // The notifier holds no clipboard and no copy callback; the only effect of a click is the pane.
  assert.deepEqual(
    Object.getOwnPropertyNames(ClipOfferNotifier.prototype).sort(),
    ['announce', 'constructor', 'fail', 'size', 'status', 'tally', 'withdraw', 'withdrawAll'],
  );
});

test('no banner while the window is focused — the pane already says it', () => {
  const { n, posted } = rig(true);
  n.announce('offer-1');
  assert.equal(posted.length, 0);
});

test('a banner is withdrawn when its offer goes, and only its own', () => {
  const { n, posted } = rig();
  n.announce('a');
  n.announce('b');
  n.withdraw('a');
  assert.deepEqual(posted.map((p) => p.closed), [true, false]);
  n.withdrawAll();
  assert.deepEqual(posted.map((p) => p.closed), [true, true]);
  assert.equal(n.size, 0);
});

// ---- 2026-10-07: what each count is, and the failure paths -------------------------------------------

function rig2(opts: { focused?: boolean; throwOnShow?: boolean } = {}) {
  const handlers: Array<{ click?: () => void; show?: () => void; failed?: (e: unknown, err: string) => void; closed: boolean }> = [];
  const lines: Array<{ line: string; level?: string }> = [];
  const statuses: OfferBannerStatus[] = [];
  const refusals: string[] = [];
  let t = 1_000;
  const n = new ClipOfferNotifier(
    () => {
      const h: (typeof handlers)[number] = { closed: false };
      handlers.push(h);
      return {
        on: ((event: string, l: (...a: never[]) => void) => { (h as Record<string, unknown>)[event] = l; }) as NativeNotificationLike['on'],
        show: () => { if (opts.throwOnShow) throw new TypeError('synthetic'); },
        close: () => { h.closed = true; },
      };
    },
    () => opts.focused ?? false,
    () => undefined,
    () => false,
    (line, level) => lines.push({ line, level }),
    (s) => statuses.push(s),
    (m) => refusals.push(m),
    () => t++,
  );
  return { n, handlers, lines, statuses, refusals };
}

test('show() returning is counted as requested, and only Electron\'s show event as reported shown', () => {
  const { n, handlers, lines } = rig2();
  n.announce('o1');
  assert.equal(n.status().requested, 1);
  assert.equal(n.status().reportedShown, 0, 'a returned show() is not a banner');
  assert.match(lines.at(-1)!.line, /not proof it appeared/);
  handlers[0]!.show!();
  assert.equal(n.status().reportedShown, 1);
  assert.match(lines.at(-1)!.line, /not observable here/);
});

test('macOS refusing the banner is a failure: counted, logged at warn, recorded, and the offer is not lost', () => {
  const { n, handlers, lines, refusals, statuses } = rig2();
  n.announce('o1');
  handlers[0]!.failed!({}, 'UNErrorDomain error 1');
  const s = n.status();
  assert.equal(s.failed, 1);
  assert.equal(s.requested, 1);
  assert.deepEqual(s.lastFailure, { atMs: 1_000, message: 'UNErrorDomain error 1' });
  assert.deepEqual(refusals, ['UNErrorDomain error 1']);
  assert.equal(lines.at(-1)!.level, 'warn');
  assert.match(lines.at(-1)!.line, /FAILED .* still waits in the Clipboard pane/);
  assert.equal(n.size, 0, 'a refused banner holds no handle');
  assert.equal(statuses.at(-1)!.failed, 1, 'the pane is told');
});

test('a show() that throws is a failure, not a request, and nothing is held', () => {
  const { n, refusals } = rig2({ throwOnShow: true });
  n.announce('o1');
  const s = n.status();
  assert.equal(s.requested, 0);
  assert.equal(s.failed, 1);
  assert.equal(n.size, 0);
  assert.deepEqual(refusals, ['show() threw: TypeError']);
});

test('a focused window is counted as skipped, not as a failure, and nothing is created', () => {
  const { n, handlers } = rig2({ focused: true });
  n.announce('o1');
  assert.equal(handlers.length, 0);
  assert.deepEqual({ ...n.status(), lastFailure: null }, {
    considered: 1, skippedFocused: 1, requested: 0, reportedShown: 0, failed: 0, clicked: 0, withdrawn: 0, lastFailure: null,
  });
});

test('every log line carries every count, so a failure count always has its denominator', () => {
  const { n, handlers, lines } = rig2();
  n.announce('o1');
  handlers[0]!.failed!({}, 'x');
  n.announce('o2');
  handlers[1]!.click!();
  for (const { line } of lines) {
    for (const word of ['considered', 'skipped (focused)', 'requested', 'reported shown', 'failed', 'clicked', 'withdrawn']) {
      assert.ok(line.includes(word), `"${word}" missing from: ${line}`);
    }
  }
  assert.equal(n.status().withdrawn, 1, 'the clicked banner was taken down');
});

test('guidance exists only after a failure, and says what this build can do about it', () => {
  const none: OfferBannerStatus = { considered: 1, skippedFocused: 0, requested: 1, reportedShown: 1, failed: 0, clicked: 0, withdrawn: 0, lastFailure: null };
  assert.equal(offerBannerGuidance(none, true), null);
  const failed = { ...none, failed: 1, lastFailure: { atMs: 1, message: 'UNErrorDomain error 1' } };
  const packaged = offerBannerGuidance(failed, true)!;
  const dev = offerBannerGuidance(failed, false)!;
  assert.match(packaged, /Offers wait here until you press Copy or Dismiss/);
  assert.match(packaged, /System Settings → Notifications/);
  assert.doesNotMatch(dev, /System Settings/, 'a development build has no row to switch on');
  // The platform's message never reaches the pane's sentence.
  assert.doesNotMatch(packaged + dev, /UNErrorDomain/);
});
