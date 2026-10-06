/*
 * Audit S4: a receive window may act only on the offers last shown in THAT window. Drives the real
 * `ShareReceiveWindow` with Electron's `BrowserWindow` and `screen` stood in (a window is an event
 * emitter with a fresh `webContents` each time), so creation, push, close and replacement are the
 * production code's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { EventEmitter } from 'node:events';

class FakeWindow extends EventEmitter {
  static made: FakeWindow[] = [];
  destroyed = false;
  sent: Array<{ channel: string; payload: unknown }> = [];
  webContents = Object.assign(new EventEmitter(), { send: (channel: string, payload: unknown) => this.sent.push({ channel, payload }), setZoomLevel: () => undefined });
  constructor() { super(); FakeWindow.made.push(this); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return true; }
  isMinimized() { return false; }
  isFocused() { return true; }
  show() {} showInactive() {} focus() {}
  getBounds() { return { x: 0, y: 0, width: 400, height: 300 }; }
  setBounds() {}
  loadFile() { return Promise.resolve(); }
  close() { this.destroyed = true; this.emit('closed'); }
}
const area = { x: 0, y: 0, width: 1440, height: 900 };
const moduleWithLoad = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (r: string, ...rest: unknown[]) {
  if (r === 'electron') {
    return {
      BrowserWindow: FakeWindow,
      screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area }) },
      app: { getPath: () => '/tmp', isPackaged: false },
    };
  }
  return realLoad.call(this, r, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ShareReceiveWindow } = require('./shareWindow') as typeof import('./shareWindow');

function receiver(offers: () => string[]) {
  const created: FakeWindow[] = [];
  const w = new ShareReceiveWindow('/preloadShare.js', '/share-window.html', (subject) => ({
    subject,
    offers: offers().map((offerId) => ({ offerId }) as never),
    phone: null,
    thumb: null,
  }), () => '#000', (target) => created.push(target as unknown as FakeWindow));
  return { w, created };
}

test('control: the window may act on the offer it was shown', () => {
  const { w, created } = receiver(() => ['A']);
  w.presentInactive('A');
  assert.equal(created.length, 1, 'control: the creation hook ran (the IPC guard registers here)');
  assert.equal(w.showsOffer(created[0]!.webContents, 'A'), true);
});

test('a newer offer that has not been shown in this window is refused', () => {
  let current = ['A'];
  const { w, created } = receiver(() => current);
  w.presentInactive('A');
  current = ['A', 'B']; // B exists now, but nothing was pushed to the window yet
  assert.equal(w.showsOffer(created[0]!.webContents, 'B'), false, 'stale: B never reached this window');
  w.push();
  assert.equal(w.showsOffer(created[0]!.webContents, 'B'), true, 'control: after B is pushed it may be acted on');
});

test('a closed and replaced window cannot act — not even on the offer it was shown', () => {
  const { w, created } = receiver(() => ['A']);
  w.presentInactive('A');
  const old = created[0]!;
  old.close();
  w.presentInactive('A');
  assert.equal(created.length, 2, 'control: a replacement window was made');
  assert.equal(w.showsOffer(old.webContents, 'A'), false, 'the old renderer is not this window');
  assert.equal(w.showsOffer(created[1]!.webContents, 'A'), true);
});

test('a sender that is not the window, and an unknown offer, are refused', () => {
  const { w, created } = receiver(() => ['A']);
  w.presentInactive('A');
  assert.equal(w.showsOffer({}, 'A'), false);
  assert.equal(w.showsOffer(created[0]!.webContents, 'Z'), false);
});
