/**
 * Which recorded events the status island narrates, and what it says about them.
 *
 * ### The departure this discharges
 *
 * `docs/design-departures.md` **S6**: the handoff cycles the island through
 * *"Connected · 10 ms"*, *"Clipboard synced"*, *"Transfer complete · 4.2 MB"*. The row said both of
 * the last two *"name features that do not exist"*. Clipboard shipped in Phase 5 slices 11–13 and
 * transfers in slices 3–9; the island went on narrating connection phase and refusals only, because
 * nothing wired the two together.
 *
 * ### Why a filter rather than "narrate everything"
 *
 * `activity.record` fires at eleven named sites and the island holds six lines on a 5.2-second
 * rota. Feeding it all of them would put *"ConnectSuite started"* and *"Connected"* into a rota the
 * island **already narrates from the link status** — the same fact twice, once as a live phase and
 * once as a five-minute-old history entry, alternating. So `system` and `mirroring` are excluded
 * here rather than deduplicated later, and the exclusion is a named list with a reason on it rather
 * than a condition inside the shell.
 *
 * The corollary, and it is the part worth stating: **a new category added to `ActivityCategory`
 * does not silently start narrating.** It falls through to `null` until somebody decides, which is
 * the opposite of what an "everything except" filter would do.
 */

/** Categories the island narrates. Everything else is deliberately silent — see the file comment. */
const ISLAND_CATEGORIES = ['clipboard', 'files', 'messages', 'calls'] as const;

/**
 * The island's line for one recorded event, or `null` for one it does not narrate.
 *
 * The line is **`kind`, with `detail` only when there is one** — every recording site already writes
 * a short verb phrase as its kind and the detail is the part that can be long. The island is one
 * line in a pill and truncating in the middle of a sentence is worse than not showing it, so the
 * detail is capped here rather than by CSS: a caller can tell how long the string is, and
 * `text-overflow` cannot.
 */
function islandLineFor(event: {
  category: string;
  kind: string;
  detail: string;
}): string | null {
  if (!(ISLAND_CATEGORIES as readonly string[]).includes(event.category)) return null;
  const kind = event.kind.trim();
  if (kind.length === 0) return null;
  const detail = event.detail.trim();
  if (detail.length === 0) return kind;
  const room = 64 - kind.length - 3;
  // A detail with no room left is dropped whole rather than reduced to an ellipsis, because
  // "Sent to phone · …" says less than "Sent to phone" and takes more space to say it.
  if (room < 8) return kind;
  return `${kind} · ${detail.length > room ? `${detail.slice(0, room - 1)}…` : detail}`;
}

/**
 * Whether a status update should seize the island's text, and what it should add to the rota.
 *
 * ### The defect this exists for, which S6 was hiding
 *
 * The rota was built, it cycled every 5.2 s, and **it was never seen.** Two things did it, and both
 * are one line in `setStatus`:
 *
 *  - `setIsland(...)` ran on **every** status update. `rttMs` changes on every heartbeat, so a
 *    status update arrives every few seconds and overwrites whatever the rota had just cycled to.
 *  - `note('Connected · 9 ms')` ran on every update too, and the dedupe was against the *exact*
 *    previous string — so `9 ms`, `8 ms`, `10 ms` are three different entries, and six of them fill
 *    the whole six-slot rota inside twenty seconds.
 *
 * So *"Clipboard synced"* could not have appeared even once wired: it would have been evicted by
 * latency jitter before the next tick. **A rota that cycles and is always overwritten looks exactly
 * like a rota with one entry in it**, which is why nobody noticed for a month.
 *
 * The rule here is that the island's *live* line belongs to the link **while the link is changing**,
 * and to the rota the rest of the time. Latency is not an event; a phase change is, and so is an
 * error.
 */
function islandStatusChange(
  previous: { phase?: string; lastError?: string | null } | null,
  next: { phase?: string; lastError?: string | null } | null,
): { seize: boolean; note: string | null } {
  const phaseChanged = (previous?.phase ?? null) !== (next?.phase ?? null);
  const errorChanged = (previous?.lastError ?? null) !== (next?.lastError ?? null);
  // An error seizes whatever the rota was showing, always: it is the one thing on this pill that a
  // person needs to see at the moment it happens rather than up to 5.2 seconds later.
  if (next?.lastError && errorChanged) return { seize: true, note: next.lastError };
  if (!phaseChanged && !errorChanged) return { seize: false, note: null };
  return { seize: true, note: null };
}

{
  const g = globalThis as Record<string, unknown>;
  g.islandLineFor = islandLineFor;
  g.islandStatusChange = islandStatusChange;
  g.ISLAND_CATEGORIES = ISLAND_CATEGORIES;
}

if (typeof module !== 'undefined') {
  module.exports = { islandLineFor, islandStatusChange, ISLAND_CATEGORIES };
}
