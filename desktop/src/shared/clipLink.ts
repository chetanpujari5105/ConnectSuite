/**
 * What may be opened out of the clipboard, decided in one place for both sides.
 *
 * ### Why this is not a regex in the pane
 *
 * The clipboard pane wants to draw an **Open** button on an entry that is a link. The main process
 * has to decide, separately, whether an *arbitrary string that arrived over the network from a
 * phone* may be handed to `shell.openExternal`. Those are two questions with one correct answer,
 * and if they are answered in two places the pane's answer is the one that gets tested and the main
 * process's is the one that runs.
 *
 * The second question is the reason the rule is strict rather than permissive. `openExternal` on
 * macOS opens **whatever the string's scheme is registered to** — `file://` opens Finder,
 * `x-apple.systempreferences://` opens a System Settings pane, `vnc://`, `ssh://`, `smb://` and
 * every custom scheme any installed app has claimed. The content here is not this Mac's: it is a
 * string a phone sent, which is a string some app on the phone put on its clipboard. So this
 * returns a URL only for **`http:` and `https:`** and refuses everything else, including things
 * that plainly are links (`mailto:`, `tel:`) — not because those are dangerous, but because the
 * moment the list is "the schemes we think are fine" it grows, and the growth is where the bad one
 * gets in.
 *
 * ### What it refuses, and why each one is here
 *
 * | Input | Answer | Why |
 * |---|---|---|
 * | `https://example.com/a` | the URL | the case the button exists for |
 * | `  https://example.com  ` | the trimmed URL | a copied link usually carries whitespace |
 * | `file:///Users/x/.ssh/id_rsa` | `null` | opens Finder at a path the sender chose |
 * | `javascript:…` | `null` | scheme allowlist, not a denylist |
 * | `Read https://example.com later` | `null` | **prose containing a link is not a link.** Extracting one would make the button open something other than what the row displays |
 * | `https://a\nhttps://b` | `null` | two links; there is no single answer, so there is no button |
 * | a 3 KB URL | `null` | see [MAX_URL_CHARS] |
 *
 * The prose row is the one worth stating out loud: a "find the first URL in this text" helper would
 * make **Open** and the row's own text disagree about what is about to happen, which is the shape
 * this project rules out everywhere else.
 */

/**
 * Longest string this will call a URL.
 *
 * Not a security boundary — it is a sanity bound, and it is here so the bound is *stated*. Browsers
 * and `openExternal` both have their own, undocumented and platform-dependent, and a button that
 * silently does nothing over one of them is worse than a button that is not drawn.
 */
const MAX_URL_CHARS = 2048;

/**
 * The URL this text *is*, or `null`.
 *
 * "is", not "contains" — see the table above.
 */
function openableUrl(text: string | undefined | null): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_CHARS) return null;
  // Any interior whitespace means this is prose, or two links, or a link with something after it.
  if (/\s/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // The trimmed original, not `parsed.href`: `new URL` normalises — it appends a `/` to a bare
  // origin, percent-encodes, lowercases the host. Opening a string that is not the one on screen is
  // small here and is the same class of surprise as the prose row above.
  return trimmed;
}

{
  const g = globalThis as Record<string, unknown>;
  g.openableUrl = openableUrl;
}

if (typeof module !== 'undefined') {
  module.exports = { openableUrl, MAX_URL_CHARS };
}
