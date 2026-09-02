import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
      const dir = join(app.getPath('userData'), 'logs');
      mkdirSync(dir, { recursive: true });
      this.path = join(dir, 'activity.jsonl');
      this.load();
    } catch (error) {
      this.loadError = String(error);
      log.warn('activity', `Could not open the activity log: ${this.loadError}`);
    }
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      this.loadError = String(error);
      log.warn('activity', `Could not read the activity log: ${this.loadError}`);
      return;
    }
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const event = parseEvent(line);
      if (event) this.events.push(event);
      else this.skipped += 1;
    }
    this.events = this.events.slice(-MAX_EVENTS);
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
        detail: detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1)}…` : detail,
      };
      this.events.push(event);
      if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
      this.recorded += 1;
      this.persist(event);
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
 * Parses one stored line, returning `null` for anything that is not a complete event.
 *
 * Field-by-field rather than a cast. A JSONL file is appended to on every event and truncated by
 * whatever kills the process, so a half-written last line is the *expected* corruption, not an
 * exotic one — and `JSON.parse` succeeding says nothing about whether the object has the fields the
 * pane will read.
 */
function parseEvent(line: string): ActivityEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const seq = record.seq;
  const at = record.at;
  const category = record.category;
  const kind = record.kind;
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (typeof category !== 'string' || typeof kind !== 'string') return null;
  return {
    seq,
    at,
    category: category as ActivityCategory,
    kind,
    detail: typeof record.detail === 'string' ? record.detail : '',
  };
}

const activity = new ActivityStore();

export { activity, parseEvent, ActivityStore, MAX_DETAIL };
