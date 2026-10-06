import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebContents } from 'electron';

/**
 * Where a privileged window may go — audit S3 (`docs/release-audit-2026-10-06.md`).
 *
 * Every window this app opens carries the preload bridge (`window.connect`): send an SMS, dial,
 * forget the phone. Until this file nothing stopped one of those windows navigating somewhere else,
 * and **a page a window navigates to keeps the bridge** — measured in a throwaway Electron on
 * 2026-10-06. Chromium's own default for a file dropped outside a drop handler is exactly such a
 * navigation, to `file:///…/whatever-was-dropped.html`.
 *
 * ### The rule, and why it is an exact-path match
 *
 * A navigation is allowed only to a `file:` URL whose **decoded path equals one of the app's own
 * pages**, compared after `fileURLToPath` and `path.resolve` — never a `file://` scheme check (any
 * dropped file passes that) and never a directory prefix (anything placed beside the pages would). A
 * fragment is tolerated (it does not load a document); a query, a host or any other scheme is refused.
 * New windows are refused outright: nothing in this app opens one through `window.open`, and links
 * meant for a browser go through the main process's `clip-open`, which allows http and https only.
 */

export type NavigationDecision = { allow: true } | { allow: false; reason: string };

export function navigationDecision(url: string, allowedPages: readonly string[]): NavigationDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allow: false, reason: 'not a URL' };
  }
  if (parsed.protocol !== 'file:') return { allow: false, reason: `scheme ${parsed.protocol} is not an app page` };
  if (parsed.host !== '') return { allow: false, reason: 'a file URL with a host is not an app page' };
  if (parsed.search !== '') return { allow: false, reason: 'an app page is never loaded with a query' };
  let path: string;
  try {
    path = resolve(fileURLToPath(parsed));
  } catch {
    return { allow: false, reason: 'the file URL does not name a path' };
  }
  return allowedPages.some((page) => resolve(page) === path)
    ? { allow: true }
    : { allow: false, reason: 'not one of the app\'s own pages' };
}

/**
 * Applies the rule to one window's contents: `will-navigate`, `will-frame-navigate` and `will-redirect`
 * are refused unless [navigationDecision] allows them, every `window.open` is denied, and no
 * `<webview>` may attach. A refusal is logged with its reason and the URL's scheme only — a dropped
 * file's name is somebody's data.
 */
export function guardWindow(
  contents: WebContents,
  allowedPages: readonly string[],
  onRefused: (what: string, reason: string) => void,
): void {
  const refuseUnlessAllowed = (what: string) => (event: { preventDefault(): void }, url: string) => {
    const decision = navigationDecision(url, allowedPages);
    if (decision.allow) return;
    event.preventDefault();
    onRefused(what, `${decision.reason} (${schemeOf(url)})`);
  };
  contents.on('will-navigate', refuseUnlessAllowed('navigation'));
  contents.on('will-redirect', refuseUnlessAllowed('redirect'));
  contents.on('will-frame-navigate', (event) => {
    const decision = navigationDecision(event.url, allowedPages);
    if (decision.allow) return;
    event.preventDefault();
    onRefused('frame navigation', `${decision.reason} (${schemeOf(event.url)})`);
  });
  contents.setWindowOpenHandler(({ url }) => {
    onRefused('new window', `window.open is never allowed (${schemeOf(url)})`);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    onRefused('webview', 'a <webview> is never allowed');
  });
}

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return 'unparseable';
  }
}
