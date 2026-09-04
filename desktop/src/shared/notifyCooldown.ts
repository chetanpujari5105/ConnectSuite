/**
 * Per-key notification history, and the two windows that decide how soon one key may banner twice.
 *
 * ### The defect, and why a number alone was not the answer
 *
 * Defect 84: `com.jio.myjio` was **posted once and updated 119 times** in three and a half minutes,
 * decided as **88 `ongoing` / 21 `update` / 11 `notify`** — eleven native banners for one
 * notification.
 *
 * **The notification was telling the truth every time, and the first write-up of this said
 * otherwise.** It was a music player, and playback really was stopping and restarting: eleven
 * genuine new playback sessions, each with a fresh timestamp, each correctly not `ongoing` in the
 * gap. Nothing about Jio's notification was misbehaving — the cause was upstream of it, in whatever
 * was interrupting playback (see `docs/testing.md` → Phase 7 Slice 23).
 *
 * That correction does not change the fix, and it is worth saying why. The two existing guards each
 * cover a real case and neither covers this one: `ONGOING` catches posts that declare themselves
 * persistent, and `UPDATE` catches re-posts whose timestamp stood still. **A key that stops and
 * genuinely restarts is neither** — it is not ongoing in the gap, and its timestamp really did
 * advance. So both guards are right to let it through, and the thing that has to say *no* is a rule
 * about **how often one key may interrupt somebody**, which is what this is.
 *
 * The distinction matters for the next person: this is not a guard against a lying notification. It
 * is a rate limit on a truthful one, and a truthful notification is exactly the kind you must be
 * careful rate-limiting.
 *
 * A flat per-key cooldown closes it, and choosing one number for every app is where it goes wrong:
 * short enough to leave a chat responsive is too short to quieten a ticker, and long enough to
 * quieten a ticker silences the second message in a conversation. So the window is chosen by a
 * **signal the phone already sends** rather than by a guess about which apps matter.
 *
 * ### The signal: has this key ever been `ongoing` in this session?
 *
 * A key that has been `ongoing` is status-shaped — a download, a media session, a ticker. A key that
 * never has is event-shaped — a message, a mention, a completed transfer. Jio's key was a media
 * session, which is `ongoing` whenever it is playing, so it classifies status-shaped on the first
 * frame and stays there across every stop and restart — which is precisely the run of events a
 * person experiences as one thing. That is the phone's own
 * word about its own notification, not our opinion about its package.
 *
 * **There is still no package allowlist, and this is not one.** A list of important apps is a guess
 * that is wrong for everybody but its author and fails silently in the direction of not telling you
 * things. This asks the same question of every key and lets the phone answer it.
 *
 * ### Why the download-completion case does not break
 *
 * The obvious objection: a download posts progress as `ongoing` on some key and then posts
 * *"Download complete"* on **the same key**, not ongoing — a real event the user wants. It is
 * status-shaped by the rule above, so does the long window eat it?
 *
 * No, and the reason is that **the cooldown is armed by a banner, never by a post.** Progress ticks
 * decide `ONGOING`, which never banners, so they never arm anything; the completion is the first
 * banner that key has produced and it goes out. Jio is the opposite case — it *does* banner, eleven
 * times, so its first one arms the window and the other ten are held.
 *
 * Against the measured run: Jio's eleven become **one**, and the control in the same window —
 * `com.whatsapp posted=4 updated=3 → 1 notify`, a key that was never `ongoing` — is untouched.
 */

/**
 * How soon an **event-shaped** key may banner again.
 *
 * Chosen against the two things it sits between, both of which are about one conversation: a burst
 * of two or three messages typed in a few seconds should be one banner, and a genuine follow-up a
 * minute later should be its own. Twenty seconds coalesces the first and leaves the second alone.
 *
 * It is a **judgement, not a measurement**, and it is the sort that shows up in the tally rather
 * than in a reading: a window that turns out to be too wide appears as real messages counted
 * `cooldown`, beside the ones counted `notify`.
 */
export const EVENT_COOLDOWN_MS = 20_000;

/**
 * How soon a **status-shaped** key may banner again — one that has been `ongoing` in this session.
 *
 * Ten minutes, against Jio's measured cadence of a banner roughly every nineteen seconds. The
 * intent is not "a bit less often": a ticker that has already had its say should be quiet until
 * something has plausibly changed, and anything it posts meanwhile is in the pane.
 */
export const STATUS_COOLDOWN_MS = 600_000;

/** What the decision needs to know about a key's past. Facts, not a verdict. */
export interface KeyHistory {
  /** The key has been seen `ongoing` at least once this session — it is status-shaped. */
  seenOngoing: boolean;
  /** When this key last actually **bannered**. `null` means never, which is not the same as long ago. */
  lastBanneredAtMs: number | null;
}

/** The history a key with no past has. Named so the empty case is a value rather than two literals. */
export const NO_HISTORY: KeyHistory = Object.freeze({ seenOngoing: false, lastBanneredAtMs: null });

/**
 * Is this key inside its cooldown window?
 *
 * Pure, and separate from the store, so the **rule** and the **state** are each testable on their
 * own — defect 67's lesson is that a decision can be perfect while the write that feeds it is
 * wrong, and a suite that only ever constructs `KeyHistory` by hand would never see the difference.
 */
export function withinCooldown(history: KeyHistory, nowMs: number): boolean {
  if (history.lastBanneredAtMs === null) return false;
  const window = history.seenOngoing ? STATUS_COOLDOWN_MS : EVENT_COOLDOWN_MS;
  // `<` rather than `<=`: a post landing exactly on the boundary is outside the window. The
  // boundary has to fall on one side explicitly or the two tests around it disagree.
  return nowMs - history.lastBanneredAtMs < window;
}

/**
 * The per-key history, and **the writes are the point of this class existing.**
 *
 * They could have lived in `NativeNotifier` as two lines beside the tally. They are here because
 * that class needs Electron, and a transition no test can reach is defect 67 exactly: eleven tests,
 * six mutations, both sides of a threshold, all green over a feature that had never worked, because
 * the bug was in a `copy()` no test could see.
 */
export class NotifyCooldown {
  private readonly keys = new Map<string, { seenOngoing: boolean; lastBanneredAtMs: number | null }>();

  historyFor(key: string): KeyHistory {
    return this.keys.get(key) ?? NO_HISTORY;
  }

  /**
   * Record what was decided for a key.
   *
   * Takes the **decision**, not a pair of booleans, so the caller cannot record a state the decision
   * did not reach — the two would drift, and the drift would be invisible.
   *
   * `ongoing` is remembered permanently for the session because the question is *has this key ever
   * been a status*, and a ticker that flaps is precisely the case: asking whether the **last** post
   * was ongoing would let every other frame through, which is the defect.
   */
  record(key: string, decision: string, nowMs: number): void {
    const held = this.keys.get(key) ?? { seenOngoing: false, lastBanneredAtMs: null };
    if (decision === 'ongoing') held.seenOngoing = true;
    // Armed by a banner and by nothing else. A post that was suppressed must not extend its own
    // silence, or a ticker would hold the window open forever and a key could never recover.
    if (decision === 'notify') held.lastBanneredAtMs = nowMs;
    this.keys.set(key, held);
  }

  /**
   * The link dropped or a new session began.
   *
   * Cleared, because `seenOngoing` is a claim about *this* session — a phone that reconnects after
   * a reboot has a different set of live notifications, and carrying the old shape across would
   * silence a key on the strength of what a previous session saw.
   */
  reset(): void {
    this.keys.clear();
  }

  /** For the log line: how many keys this is tracking. A store with no size is a store nobody audits. */
  get size(): number {
    return this.keys.size;
  }
}
