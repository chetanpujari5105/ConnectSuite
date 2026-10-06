import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseActivityLine } from './activityLine';
import { UNKNOWN_NUMBER, callHistoryName } from '../shared/callRecord';
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
      // The rotated half is never read, but it is on disk, so the call-data rule reaches it too. On
      // its own guard: a half nobody reads must not cost the screen the half everybody does.
      try {
        readStored(`${this.path}.old`);
      } catch (error) {
        log.warn('activity', `Could not read activity.jsonl.old :: ${String(error)}`);
      }
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
    endWithNewline(this.path);
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
 * now read. **The rewrite is irreversible and keeps no backup**, because a backup would retain the
 * numbers it exists to remove; so it touches only what the rule is about:
 *
 * - a **call** row is changed **only when its `detail` must be redacted**, and then only `detail`
 *   changes — every other field, its value and the key order survive ([redactCallLine]). A call row
 *   with nothing to redact is kept byte for byte, whatever its key order or extra fields. (Before
 *   2026-10-06 it was re-serialised from its five parsed fields, which dropped extra fields and
 *   rewrote rows with nothing to redact — the verification-prep finding.)
 * - a call row carrying a field this build does not know that **may hold call data** is kept and
 *   **reported** by field name and count, never deleted or altered: whether such a field may stay is
 *   a policy question, not one this rewrite answers silently;
 * - **every other readable row is written back byte for byte**, fields this build does not know
 *   included — the rule is about calls, and a re-serialisation would drop another writer's data;
 * - an **unreadable** line is kept as it is, unless it [mayHoldCallData] — a half-written call row
 *   is the one line nobody could check, and it is not worth keeping a number to keep it.
 *
 * Only a changed call row or a dropped line causes a rewrite; an unreadable line alone does not. A
 * rewrite that cannot be written is logged and the history is still returned, read under the rule —
 * the screen is never blanked because the disk refused a write.
 */
function readStored(path: string): StoredHistory {
  if (!existsSync(path)) return { events: [], skipped: 0 };
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const { events, keep, skipped, changed, dropped, questions } = planStoredRewrite(lines);
  if (questions.length > 0) {
    // Field names and a count only — never a value. Reported on every load until someone decides.
    const names = [...new Set(questions.flatMap((q) => q.fields))].join(', ');
    log.warn(
      'activity',
      `${questions.length} call row(s) in ${path.endsWith('.old') ? 'activity.jsonl.old' : 'activity.jsonl'} carry an ` +
        `unknown field that may hold call data (${names}) — kept unchanged, not redacted: a policy decision is needed`,
    );
  }
  if (changed > 0 || dropped > 0) {
    const name = path.endsWith('.old') ? 'activity.jsonl.old' : 'activity.jsonl';
    const temp = `${path}.rewrite`;
    // Counts only. The rows themselves are what this exists to stop writing anywhere.
    const counts =
      `${changed} call row(s) brought under the call-data rule / ${dropped} unreadable line(s) that ` +
      `may hold call data dropped / ${keep.length} line(s) kept`;
    try {
      writeFileSync(temp, keep.join('\n') + (keep.length ? '\n' : ''));
      renameSync(temp, path);
      log.info('activity', `Rewrote ${name}: ${counts}`);
    } catch (error) {
      try {
        rmSync(temp, { force: true });
      } catch {
        // A temporary path that cannot be removed is reported by the line below; nothing else to do.
      }
      log.warn('activity', `Could not rewrite ${name}; it is unchanged on disk and will be tried again ` +
        `next launch. Would have been: ${counts} :: ${String(error)}`);
    }
  }
  return { events, skipped };
}

/** The fields the store itself writes. Anything else on a call row is another writer's. */
const KNOWN_FIELDS = new Set(['seq', 'at', 'category', 'kind', 'detail']);
/** A field name that suggests call data, or a value with a number-length digit run. */
const SENSITIVE_NAME = /number|phone|caller|callee|msisdn|address|contact|tel/i;

/** A field name safe to print: identifier-shaped and short, else a placeholder. */
function printableField(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) ? name : '(unprintable name)';
}

export interface RewritePlan {
  events: ActivityEvent[];
  /** The lines to write back, in order — every line not changed or dropped is the original string. */
  keep: string[];
  skipped: number;
  /** Call rows whose `detail` was redacted. */
  changed: number;
  /** Unreadable lines that may hold call data, dropped (the existing malformed-line policy). */
  dropped: number;
  /** Call rows kept with an unknown field that may hold call data: names only, for the report. */
  questions: Array<{ seq: number; fields: string[] }>;
}

/**
 * The rewrite's decisions, with no disk in them — `readStored` writes what this returns. Exported for
 * the tests, which run the same function the app runs.
 */
export function planStoredRewrite(lines: readonly string[]): RewritePlan {
  const events: ActivityEvent[] = [];
  const keep: string[] = [];
  const questions: RewritePlan['questions'] = [];
  let skipped = 0;
  let changed = 0;
  let dropped = 0;
  for (const line of lines) {
    const parsed = parseActivityLine(line);
    if (!parsed) {
      skipped += 1;
      if (mayHoldCallData(line)) dropped += 1;
      else keep.push(line);
      continue;
    }
    events.push({ ...parsed, detail: clip(storedDetail(parsed.category, parsed.detail)) });
    if (parsed.category !== 'calls') {
      keep.push(line);
      continue;
    }
    const raw = JSON.parse(line) as Record<string, unknown>;
    const suspicious = Object.keys(raw).filter(
      (key) =>
        (!KNOWN_FIELDS.has(key) || (key === 'detail' && typeof raw.detail !== 'string')) &&
        (SENSITIVE_NAME.test(key) || /\d{5,}/.test(JSON.stringify(raw[key]) ?? '')),
    );
    if (suspicious.length > 0) questions.push({ seq: parsed.seq, fields: suspicious.map(printableField) });
    const redacted = redactCallLine(raw, parsed.detail);
    if (redacted === null) {
      keep.push(line);
    } else {
      changed += 1;
      keep.push(redacted);
    }
  }
  return { events, keep, skipped, changed, dropped, questions };
}

/**
 * A call row with its `detail` redacted, or **null when nothing needs redacting** — in which case the
 * caller keeps the original line byte for byte.
 *
 * Redaction is needed only when the call-history rule would replace a non-empty detail with
 * "Unknown number" — a number, or a name carrying one. An empty detail or `unknown` holds no number
 * and is left as written (the screen still shows "Unknown number"). When it is needed, only `detail`
 * changes: the row is re-serialised from **its own parsed object**, so every other field and value and
 * the key order are the ones on disk.
 */
function redactCallLine(raw: Record<string, unknown>, detail: string): string | null {
  const trimmed = detail.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'unknown' || trimmed === UNKNOWN_NUMBER) return null;
  if (callHistoryName(detail) !== UNKNOWN_NUMBER) return null;
  return JSON.stringify({ ...raw, detail: UNKNOWN_NUMBER });
}

/**
 * Whether an unreadable line could carry a phone number. Conservative on purpose: such a line is
 * already invisible to the screen, so dropping one that only *looks* risky loses nothing a person
 * could see. Call rows are the only rows that ever held numbers, and a number-length digit run
 * outside the `seq` and `at` fields is treated as one whatever its category.
 */
function mayHoldCallData(line: string): boolean {
  if (/calls/i.test(line)) return true;
  const withoutCounters = line.replace(/"(seq|at)"\s*:\s*\d+/g, '');
  return /\d{5,}/.test(withoutCounters);
}

/**
 * Appends a newline to a file whose last line was cut off by a hard quit, so the next event starts a
 * line of its own instead of being glued onto the broken one and lost with it. Never removes bytes.
 */
function endWithNewline(path: string): void {
  try {
    const text = readFileSync(path, 'utf8');
    if (text.length > 0 && !text.endsWith('\n')) appendFileSync(path, '\n');
  } catch (error) {
    log.warn('activity', `Could not end activity.jsonl with a newline :: ${String(error)}`);
  }
}

const activity = new ActivityStore();

export { activity, ActivityStore, MAX_DETAIL };
