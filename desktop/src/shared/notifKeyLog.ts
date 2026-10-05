/**
 * A notification key as it may appear in a log line.
 *
 * Android's `StatusBarNotification.getKey()` is `user|package|id|tag|uid`, and the **tag is chosen
 * by the app that posted the notification** — free text this product does not control. WhatsApp's
 * tag for a one-to-one chat is the contact's JID, which is their phone number. The rotating log
 * must never hold a number (`docs/protocol.md` → Calls → *What a Mac may keep about a call*, and the
 * same rule for every feature in `CLAUDE.md`'s privacy section), so a key reaches a log line only
 * through here.
 *
 * The package, id and uid are kept: they are what makes a cooldown line debuggable. The tag becomes
 * `tag#<hash>`, salted once per process, so two lines about one notification still match within a
 * run and the log alone cannot be reversed by hashing candidate numbers. `null` (no tag) is kept as
 * it is — it carries nothing. A key that is not the five-part shape is replaced whole, because a
 * shape we did not expect is exactly the case we cannot vouch for.
 */

const SALT = Math.floor(Math.random() * 0xffffffff);

function hash(text: string): string {
  // FNV-1a, 32-bit, seeded with the per-process salt. Correlation within a run, nothing more.
  let h = (0x811c9dc5 ^ SALT) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function notifKeyForLog(key: string): string {
  const parts = key.split('|');
  if (parts.length !== 5) return `key#${hash(key)}`;
  const [user, pkg, id, tag, uid] = parts as [string, string, string, string, string];
  const shownTag = tag === 'null' || tag === '' ? tag : `tag#${hash(tag)}`;
  return `${user}|${pkg}|${id}|${shownTag}|${uid}`;
}

/**
 * The line logged when a notification is held by the cooldown (defect 84's denominator line). A
 * function of its own so a test reaches the exact sentence the log writes, key included.
 */
export function cooldownLogLine(
  pkg: string,
  window: 'status' | 'event',
  key: string,
  held: number,
  posted: number,
  keysTracked: number,
): string {
  return (
    `cooldown ${pkg} (${window} key, ${notifKeyForLog(key)}) — ` +
    `${held} held / ${posted} posted since launch, ${keysTracked} keys tracked`
  );
}
