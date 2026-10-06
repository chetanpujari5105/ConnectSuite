import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardWindow, navigationDecision } from './windowGuard';

/**
 * Audit S3: a privileged window may show only the app's own pages. These reach the production
 * decision and the production wiring (through a stand-in for `WebContents` that records what the guard
 * registered). What they cannot reach is Chromium itself — that a real drop or a real `location`
 * change raises these events — which is the isolated Electron run recorded in
 * `docs/evidence/release-audit-2026-10-06/`.
 */

const RENDERER = join('/', 'Applications', 'Sidekick.app', 'Contents', 'Resources', 'app.asar', 'dist', 'renderer');
const PAGES = ['index.html', 'float.html', 'share-window.html'].map((p) => join(RENDERER, p));
const url = (path: string) => pathToFileURL(path).href;

test('the three app pages are allowed, a fragment is tolerated', () => {
  for (const page of PAGES) assert.deepEqual(navigationDecision(url(page), PAGES), { allow: true }, page);
  assert.deepEqual(navigationDecision(`${url(PAGES[0]!)}#messages`, PAGES), { allow: true });
});

test('everything else is refused: other files, look-alike paths, queries, hosts and other schemes', () => {
  const refused = [
    url(join(RENDERER, 'evil.html')), // beside the pages: a prefix allowlist would pass it
    url(join(RENDERER, 'index.html.html')),
    url(join(RENDERER, 'sub', 'index.html')),
    url('/Users/someone/Downloads/dropped.html'), // what a drop navigates to
    `${url(PAGES[0]!)}?x=1`,
    url(PAGES[0]!).replace('file:///', 'file://attacker.example/'),
    url(PAGES[0]!).replace('index.html', '%69ndex.html%00'),
    url(join(RENDERER, '..', '..', 'evil.html')),
    'https://example.com/',
    'http://127.0.0.1:9222/',
    'data:text/html,<script>connect.forget()</script>',
    'javascript:alert(1)',
    'sidekick-media://token',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'not a url',
    '',
  ];
  for (const u of refused) {
    const decision = navigationDecision(u, PAGES);
    assert.equal(decision.allow, false, `allowed: ${u}`);
  }
});

test('a traversal that resolves to an app page is the app page, and is allowed', () => {
  // `..` inside a file URL is normalised by URL parsing; the guard compares resolved paths, so this is
  // the same file, not a bypass. Recorded so nobody "fixes" it into a refusal of the real page.
  const viaDotDot = url(join(RENDERER, 'sub')) + '/../index.html';
  assert.deepEqual(navigationDecision(viaDotDot, PAGES), { allow: true });
});

class FakeContents extends EventEmitter {
  openHandler: ((details: { url: string }) => { action: string }) | null = null;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.openHandler = handler;
  }
}

function prevented(contents: FakeContents, event: string, ...args: unknown[]): boolean {
  let was = false;
  const e = { preventDefault: () => { was = true; }, url: args[0] };
  contents.emit(event, e, ...args);
  return was;
}

test('guardWindow refuses an outside navigation, redirect and frame navigation, and allows an app page', () => {
  const contents = new FakeContents();
  const refusals: string[] = [];
  guardWindow(contents as never, PAGES, (what, reason) => refusals.push(`${what}: ${reason}`));
  const outside = url('/Users/someone/Downloads/dropped.html');
  assert.equal(prevented(contents, 'will-navigate', outside), true);
  assert.equal(prevented(contents, 'will-redirect', 'https://example.com/'), true);
  assert.equal(prevented(contents, 'will-frame-navigate', outside), true);
  assert.equal(prevented(contents, 'will-navigate', url(PAGES[1]!)), false, 'control: an app page is not prevented');
  assert.equal(refusals.length, 3);
  assert.ok(refusals.every((r) => !r.includes('dropped.html')), 'a refused file name is not logged');
});

test('guardWindow denies every new window and every webview', () => {
  const contents = new FakeContents();
  const refusals: string[] = [];
  guardWindow(contents as never, PAGES, (what) => refusals.push(what));
  assert.ok(contents.openHandler, 'a window-open handler must be installed');
  assert.deepEqual(contents.openHandler!({ url: url(PAGES[0]!) }), { action: 'deny' }, 'even the app page in a new window');
  assert.deepEqual(contents.openHandler!({ url: 'https://example.com/' }), { action: 'deny' });
  assert.equal(prevented(contents, 'will-attach-webview'), true);
  assert.deepEqual(refusals, ['new window', 'new window', 'webview']);
});
