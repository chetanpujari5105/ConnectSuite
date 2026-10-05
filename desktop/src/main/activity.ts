import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseActivityLine } from './activityLine';
import { callHistoryName } from '../shared/callRecord';
import { log } from './logger';

/**
 * The Mac's own record of what it did with the phone — the store behind the Activity screen.
 *
 * The screen's `unbuiltReason` used to read *"Nothing stores a session history yet. The rotating
 * log file behind Settings → Advanced is the closest thing that exists, and it is a log, not a
 * timeline."* This is the difference between those two things: `logger.ts` writes sentences for a
 * person debugging a socket, and this writes rows with a category and a sequence for a person
 * asking what happened.
 *
 * **It is deliberately not built by parsing that log.** A parser would be a second expression of
 * every rule the emitting code already contains, and `CLAUDE.md` is explicit about what happens to
 * the two copies: they disagree eventually and the reading is the one that is wrong. Events are
 * recorded where they occur instead.
 *
 * ### Every recording site is in `main.ts`, on purpose
 *
 * Not scattered through the feature clients. `main.ts` is already where every client's events are
 * subscribed and every renderer request is handled, so it is the one place that can see all six
 * categories — and one file with an enumerated set of calls is something a test can check for
 * holes, which twenty call sites across seven files is not.
 *
 * ### What it never does
 *
 * It never throws into a caller. A recorder that can take down a transfer because a disk was full
 * is a worse bug than the missing timeline it was added to fix, so every path here swallows and
 * logs. The consequence is that a broken store looks like a quiet one — so the read path reports
 * the failure explicitly rather than returning an empty list, which is state A2 on the pane.
 */

/** Kept small enough that the whole log is read, filtered and paged in memory without ceremony. */
const MAX_EVENTS = 2_000;
const MAX_BYTES = 1024 * 1024;

/** A detail longer than this is truncated: one pasted essay must not become the whole file. */
const MAX_DETAIL = 300;

class ActivityStore {
  /**
   * Called with each event as it is recorded, so the renderer can narrate one without polling.
   *
   * Optional and set after construction, because the store is built before any window exists. It is
   * **not** how the Activity pane gets its rows — that reads the whole list — so a listener that is
   * absent, slow or broken costs a status-island line and nothing else.
   */
  onRecorded: ((event: ActivityEvent) => void) | null = null;

  private events: ActivityEvent[] = [];
  private seq = 0;
  private path: string | null = null;
  /** Set when the log could not be read. Drives state A2 rather than an empty table. */
  private loadError: string | null = null;
  private skipped = 0;
  private recorded = 0;
  private dropped = 0;

  init(): void {
    try {
      this.initAt(join(app.getPath('userData'), 'logs'));
    } catch (error) {
      this.loadError = String(error);
      log.warn('activity', `Could not open the activity log: ${this.loadError}`);
    }
  }

  /** `init()` with the directory named — the profile's in the app, a temporary one in a test. */
  initAt(dir: string): void {
    try {
      mkdirSync(dir, { recursive: true });
      this.path = join(dir, 'activity.jsonl');
      // The rotated half is never read, but it is on disk, so the call-data rule reaches it too.
      readStored(`${this.path}.old`);
      this.load();
    } catch (error) {
      this.loadError = String(error);
      log.warn('activity', `Could not open the activity log: ${this.loadError}`);
    }
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    let stored: StoredHistory;
    try {
      stored = readStored(this.path);
    } catch (error) {
      this.loadError = String(error);
      log.warn('activity', `Could not read the activity log: ${this.loadError}`);
      return;
    }
    this.events = stored.events.slice(-MAX_EVENTS);
    this.skipped = stored.skipped;
    this.seq = this.events.reduce((max, event) => Math.max(max, event.seq), 0);
    // Both halves on one line. "3 lines skipped" alone reads as a broken file; beside the number
    // that were read it reads as what it usually is, a half-written last line after a hard quit.
    log.info(
      'activity',
      `Activity log: ${this.events.length} event(s) read / ${this.skipped} line(s) unreadable, ` +
        `next seq ${this.seq + 1}`,
    );
  }

  /**
   * Append one event. Never throws, and returns nothing — no caller may branch on this.
   *
   * The `detail` is truncated rather than rejected: an over-long detail is still a true record of
   * something that happened, and dropping the event to protect the column width would lose the
   * fact to preserve the layout.
   */
  record(category: ActivityCategory, kind: string, detail = ''): void {
    try {
      this.seq += 1;
      const event: ActivityEvent = {
        seq: this.seq,
        at: Date.now(),
        category,
        kind,
        detail: clip(storedDetail(category, detail)),
      };
      this.events.push(event);
      if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
      this.recorded += 1;
      this.persist(event);
      // Told to whoever is listening, **after** it is in the list and on disk, and guarded on its
      // own: a listener that throws must not make this look like an event that could not be
      // recorded, because that is a different sentence and a different problem.
      try {
        this.onRecorded?.(event);
      } catch (error) {
        log.warn('activity', `A listener refused a ${category} event :: ${String(error)}`);
      }
    } catch (error) {
      this.dropped += 1;
      log.warn(
        'activity',
        `Could not record a ${category} event — ${this.recorded} recorded / ${this.dropped} dropped ` +
          `since launch :: ${String(error)}`,
      );
    }
  }

  private persist(event: ActivityEvent): void {
    if (!this.path) return;
    if (existsSync(this.path) && statSync(this.path).size > MAX_BYTES) {
      // Rewrite rather than rotate to a `.1`: unlike the socket log, nothing ever reads the old
      // half, and a second file would be a second thing for the pane to decide whether to include.
      renameSync(this.path, `${this.path}.old`);
      writeFileSync(this.path, this.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      return;
    }
    appendFileSync(this.path, `${JSON.stringify(event)}\n`);
  }

  all(): ActivityEvent[] {
    return this.events;
  }

  /** `null` when the log read cleanly. The pane draws A2 on a string and A3 on an empty list. */
  error(): string | null {
    return this.loadError;
  }

  /** For the pane's footer, and the reason a skipped line is not silent. */
  stats(): { read: number; skipped: number; recorded: number; dropped: number } {
    return {
      read: this.events.length,
      skipped: this.skipped,
      recorded: this.recorded,
      dropped: this.dropped,
    };
  }
}

/**
 * The detail as it may be stored. For calls that is the rule in `docs/protocol.md` → Calls → *What
 * a Mac may keep about a call* — a contact name or "Unknown number", never a number — applied here
 * as well as where the row is made, because this is the one place every row passes through on its
 * way to disk. Every other category is stored exactly as given.
 */
function storedDetail(category: string, detail: string): string {
  return category === 'calls' ? callHistoryName(detail) : detail;
}

function clip(detail: string): string {
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1)}…` : detail;
}

interface StoredHistory {
  events: ActivityEvent[];
  skipped: number;
}

/**
 * Read one stored history file, applying the call-data rule, and rewrite the file when what is on
 * disk is not what the rule allows.
 *
 * History written before the rule holds raw numbers in its call rows, and "never retain" is a
 * statement about the file, not the screen — so the file is rewritten, once, from the rows as they
 * now read. A rewrite also drops the unreadable lines, which the reader already skips: a half-written
 * call row is the one line nobody could check, and it is not worth keeping a number to keep it.
 *
 * A file whose every line already reads back unchanged is left exactly as it is.
 */
function readStored(path: string): StoredHistory {
  if (!existsSync(path)) return { events: [], skipped: 0 };
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const events: ActivityEvent[] = [];
  let skipped = 0;
  let changed = 0;
  for (const line of lines) {
    const parsed = parseActivityLine(line);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    const event = { ...parsed, detail: clip(storedDetail(parsed.category, parsed.detail)) };
    if (JSON.stringify(event) !== line.trim()) changed += 1;
    events.push(event);
  }
  if (changed > 0 || skipped > 0) {
    const temp = `${path}.rewrite`;
    writeFileSync(temp, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    renameSync(temp, path);
    // Counts only. The rows themselves are what this exists to stop writing anywhere.
    log.info(
      'activity',
      `Rewrote ${path.endsWith('.old') ? 'activity.jsonl.old' : 'activity.jsonl'}: ` +
        `${changed} row(s) brought under the call-data rule / ${skipped} unreadable line(s) dropped / ` +
        `${events.length} kept`,
    );
  }
  return { events, skipped };
}

const activity = new ActivityStore();

export { activity, ActivityStore, MAX_DETAIL };
