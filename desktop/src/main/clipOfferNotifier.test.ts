import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipOfferNotifier, type NativeNotificationLike } from './clipOfferNotifier';
import { OFFER_NOTIFICATION } from './clipOffers';

function rig(focused = false) {
  const posted: Array<{ options: { title: string; body: string; silent: boolean }; closed: boolean; click: () => void }> = [];
  let opened = 0;
  const n = new ClipOfferNotifier(
    (options) => {
      const rec = { options, closed: false, click: () => undefined as void };
      const native: NativeNotificationLike = {
        on: (_e, l) => { rec.click = l; },
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
  assert.deepEqual(Object.getOwnPropertyNames(ClipOfferNotifier.prototype).sort(), ['announce', 'constructor', 'size', 'withdraw', 'withdrawAll']);
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
