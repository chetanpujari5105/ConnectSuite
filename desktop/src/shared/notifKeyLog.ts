import { createHmac, randomBytes } from 'node:crypto';

/**
 * A notification key as it may appear in a log line.
 *
 * Android's `StatusBarNotification.getKey()` is `user|package|id|tag|uid`, and the **tag is chosen
 * by the app that posted the notification** — free text this product does not control. WhatsApp's
 * tag for a one-to-one chat is the contact's JID, which is their phone number. The rotating log
 * must never hold a number (`docs/protocol.md` → Calls → *What a Mac may keep about a call*, and the
 * same rule for every feature in `CLAUDE.md`'s privacy section), so a key reaches a log line only
 * through here. The phone's twin is `sync-module/.../NotificationKeyLog.kt`.
 *
 * ### What a line shows: an ordinal, not a digest
 *
 * The package, id and uid are kept: they are what makes a cooldown line debuggable. The tag becomes
 * `tag#<n>` — the order in which **this process** first saw it — so two lines about one notification
 * still match within a run. A key that is not the five-part shape becomes `key#<n>`. `null` (no tag)
 * is kept as it is; it carries nothing.
 *
 * **This replaces a salted 32-bit FNV-1a, whose claim was wrong** (audit S6,
 * `docs/release-audit-2026-10-06.md`). That code said the log "cannot be reversed by hashing candidate
 * numbers". It could: the salt only set FNV's starting state and every FNV step is invertible, so one
 * line whose tag was known gave the salt, and a dictionary then gave every other tag in the run —
 * measured at 0.9 s for 10^7 candidates. An ordinal has no digest to invert: the number depends only on
 * order, never on the tag's content.
 *
 * ### What this does and does not promise
 *
 * Correlation within one process, and nothing more. It is **not** anonymity: an ordinal still says
 * "the same conversation as line 40", and the package, id and uid stay readable. Across a restart the
 * ordinals start again at 1 and mean nothing.
 *
 * ### What it keeps in memory
 *
 * A table from HMAC-SHA256(per-process random 32-byte key, tag) to ordinal — **never the raw tag** —
 * capped at [MAX_TRACKED] entries, least recently seen evicted first. An evicted tag seen again gets a
 * new ordinal: correlation is lost for very old tags, never wrongly merged. Neither the key nor the
 * table is persisted or logged.
 */

export const MAX_TRACKED = 1024;

export interface NotifKeyLog {
  /** The key as a log line may show it. */
  forLog(key: string): string;
  /** How many tags are tracked now; bounded by the table's cap. */
  tracked(): number;
  /** Tests only: what the table actually holds (keyed digests, never tags). */
  heldKeysForTest(): string[];
}

export function createNotifKeyLog(maxTracked: number = MAX_TRACKED): NotifKeyLog {
  const secret = randomBytes(32);
  const ordinals = new Map<string, number>();
  let next = 1;

  const ordinalOf = (text: string): number => {
    const id = createHmac('sha256', secret).update(text, 'utf8').digest('base64url');
    const seen = ordinals.get(id);
    if (seen !== undefined) {
      // Re-insert so the Map's order is least-recently-seen first.
      ordinals.delete(id);
      ordinals.set(id, seen);
      return seen;
    }
    const assigned = next++;
    ordinals.set(id, assigned);
    while (ordinals.size > maxTracked) {
      const oldest = ordinals.keys().next().value as string;
      ordinals.delete(oldest);
    }
    return assigned;
  };

  return {
    forLog(key: string): string {
      const parts = key.split('|');
      if (parts.length !== 5) return `key#${ordinalOf(`key\u0000${key}`)}`;
      const [user, pkg, id, tag, uid] = parts as [string, string, string, string, string];
      const shownTag = tag === 'null' || tag === '' ? tag : `tag#${ordinalOf(`tag\u0000${tag}`)}`;
      return `${user}|${pkg}|${id}|${shownTag}|${uid}`;
    },
    tracked: () => ordinals.size,
    heldKeysForTest: () => [...ordinals.keys()],
  };
}

/** This process's table. One per process: ordinals mean nothing across a restart, by design. */
const processLog = createNotifKeyLog();

export function notifKeyForLog(key: string): string {
  return processLog.forLog(key);
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
