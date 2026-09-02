/**
 * The Activity screen's data model: what an event is, how the pane filters, pages and summarises
 * them, and which of the pane's states a given fetch is in.
 *
 * Electron-free on purpose — this is the testable seam, and the decisions worth asserting all live
 * here rather than in the renderer that draws them.
 *
 * ### The paging cursor is a sequence number, and that is a design choice rather than an achievement
 *
 * `media.list` needed a `(date, id)` tiebreak because two photos can share a `DATE_ADDED` second,
 * and `CLAUDE.md` records what it cost to prove that the tiebreak was load-bearing. This store has
 * no such problem, and the honest reason is not that it was solved: **the store assigns its own
 * monotonic `seq` and pages on that**, so two events in the same millisecond are still strictly
 * ordered and there is no tie to break. It is worth saying because the alternative — paging on `at`
 * and calling the result correct because the pages summed — is exactly the run that would have
 * looked identical with the tiebreak deleted.
 *
 * ### Five states, not four, and the fifth is the one the design does not draw
 *
 * *No events at all* and *no events matching this filter* are different sentences. A user who
 * clicks **Files** on a busy log and sees the same card they would see on a fresh install cannot
 * tell "nothing has been transferred" from "nothing has been recorded, ever". That is defect
 * 24/26's shape inside a single pane, and the design's Activity artboard has no state for either —
 * it draws nine rows and a pager. See `docs/design-departures.md` §Activity, A2.
 */

/**
 * The categories the pane filters by.
 *
 * The design draws five chips — Mirroring, Files, Messages, Calls, System — and `clipboard` is the
 * sixth. It is not folded into `system`, because a filter that does not find the thing its user is
 * looking for is worse than one more chip; it is recorded as a departure instead.
 */
type ActivityCategory = 'mirroring' | 'files' | 'messages' | 'calls' | 'clipboard' | 'system';

/** The design's chip order, with the one addition appended rather than inserted. */
const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  'mirroring',
  'files',
  'messages',
  'calls',
  'clipboard',
  'system',
];

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  mirroring: 'Mirroring',
  files: 'Files',
  messages: 'Messages',
  calls: 'Calls',
  clipboard: 'Clipboard',
  system: 'System',
};

/** The dock/summary tints, reused so the donut and the chips cannot disagree about a colour. */
const CATEGORY_TINTS: Record<ActivityCategory, string> = {
  mirroring: '139,107,255',
  files: '96,165,250',
  messages: '50,229,138',
  calls: '34,211,238',
  clipboard: '244,114,182',
  system: '156,159,176',
};

interface ActivityEvent {
  /** Monotonic within one store. The paging cursor and the tiebreak-that-is-not-needed. */
  seq: number;
  /** Epoch milliseconds, local clock. Displayed; never used for ordering. */
  at: number;
  category: ActivityCategory;
  /** The ACTIVITY column: a short verb phrase. Never a package id on its own. */
  kind: string;
  /** The DETAILS column. May be empty — some events are entirely described by their kind. */
  detail: string;
}

/** What the last read of the event log did. */
type ActivityFetch =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: ActivityEvent[] }
  | { kind: 'failed'; reason: string };

/** The five states, as ids, so the tests and `docs/design-departures.md` use the same names. */
type ActivityStateId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

interface ActivityPaneView {
  id: ActivityStateId;
  /** True only for A5 — the one state where the table, pager and summary are drawn. */
  showsTable: boolean;
  headline: string;
  body: string[];
  tone: 'neutral' | 'warning';
  icon: 'activity' | 'alert' | 'spinner';
  /** Only the failed state offers one. One of the four A3/A4 differences. */
  retry: boolean;
}

/**
 * Which state the pane is in, given the fetch and the active filter.
 *
 * A3 (nothing recorded) and A4 (nothing matching) are the pair this exists to keep apart, and they
 * differ in **four independent ways** — headline verb, body, whether a filter name appears, and
 * whether the chip row still offers a way out — so removing any one of them fails a test rather
 * than quietly merging two states into one picture. The same discipline as `filesRoots.ts`, for the
 * same reason.
 */
function activityPaneView(
  fetch: ActivityFetch,
  filter: ActivityCategory | 'all',
  matched: number,
): ActivityPaneView {
  if (fetch.kind === 'idle' || fetch.kind === 'loading') {
    return {
      id: 'A1',
      showsTable: false,
      headline: 'Reading the activity log',
      body: [],
      tone: 'neutral',
      icon: 'spinner',
      retry: false,
    };
  }
  if (fetch.kind === 'failed') {
    return {
      id: 'A2',
      showsTable: false,
      headline: 'The activity log could not be read',
      body: [
        fetch.reason,
        'Nothing has been lost on the phone — this is the Mac’s own record of what it did.',
      ],
      tone: 'warning',
      icon: 'alert',
      retry: true,
    };
  }
  if (fetch.events.length === 0) {
    return {
      id: 'A3',
      showsTable: false,
      headline: 'Nothing has happened yet',
      body: [
        'This Mac records what it does with your phone — connections, mirroring sessions, ' +
          'transfers, messages and clipboard entries — and it has not done any of them yet.',
      ],
      tone: 'neutral',
      icon: 'activity',
      retry: false,
    };
  }
  if (matched === 0) {
    const label = filter === 'all' ? 'this filter' : CATEGORY_LABELS[filter];
    return {
      id: 'A4',
      showsTable: false,
      headline: `No ${label} activity in this log`,
      body: [
        `There are ${fetch.events.length} recorded events, and none of them are ${label} ones. ` +
          'Choose All to see the rest.',
      ],
      tone: 'neutral',
      icon: 'activity',
      retry: false,
    };
  }
  return {
    id: 'A5',
    showsTable: true,
    headline: '',
    body: [],
    tone: 'neutral',
    icon: 'activity',
    retry: false,
  };
}

interface ActivityPage {
  rows: ActivityEvent[];
  /** How many events match the filter. The denominator in "Showing 9 of 48". */
  matched: number;
  /** How many events exist at all, regardless of filter. */
  total: number;
  pageCount: number;
  /** Clamped: a filter change that shortens the list must not strand the pager past the end. */
  page: number;
}

/**
 * One page of the table, newest first.
 *
 * [page] is clamped rather than trusted. Switching from **All** on page 3 to **Calls** with four
 * calls in the log would otherwise render an empty table with a pager insisting there are three
 * pages — an empty state produced by arithmetic, which is the one kind nothing above would catch
 * because the fetch succeeded and the filter matched.
 */
function activityPage(
  events: ActivityEvent[],
  filter: ActivityCategory | 'all',
  page: number,
  pageSize: number,
): ActivityPage {
  const matching =
    filter === 'all' ? events : events.filter((event) => event.category === filter);
  const ordered = [...matching].sort((a, b) => b.seq - a.seq);
  const pageCount = Math.max(1, Math.ceil(ordered.length / Math.max(1, pageSize)));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  return {
    rows: ordered.slice(clamped * pageSize, clamped * pageSize + pageSize),
    matched: ordered.length,
    total: events.length,
    pageCount,
    page: clamped,
  };
}

interface ActivitySummarySlice {
  category: ActivityCategory;
  label: string;
  tint: string;
  count: number;
}

interface ActivitySummary {
  total: number;
  slices: ActivitySummarySlice[];
}

/**
 * The donut's numbers, over events at or after [sinceMs].
 *
 * Every category with a non-zero count appears; a category with none does **not**, because a legend
 * row reading `Calls 0` next to a donut with no calls arc in it is a row that says nothing and
 * takes the eye. The design draws four legend rows for four non-zero categories, which is this rule
 * with the data it happened to have.
 */
function activitySummary(events: ActivityEvent[], sinceMs: number): ActivitySummary {
  const within = events.filter((event) => event.at >= sinceMs);
  const slices = ACTIVITY_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    tint: CATEGORY_TINTS[category],
    count: within.filter((event) => event.category === category).length,
  })).filter((slice) => slice.count > 0);
  return { total: within.length, slices };
}

interface ActivityDay {
  /** Local day-of-month, the design's axis labels. */
  day: number;
  count: number;
}

/**
 * Counts per local day for the last [days] days, oldest first, **including days with none**.
 *
 * The zeroes are the point: a sparkline drawn only over days that had events compresses a quiet
 * week into a straight line and makes it look like a busy one. The design draws seven labelled
 * ticks, so seven buckets are always returned even when the log is one day old.
 */
function activityDaily(events: ActivityEvent[], days: number, now: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - back);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    out.push({
      day: start.getDate(),
      count: events.filter((event) => event.at >= start.getTime() && event.at < end.getTime())
        .length,
    });
  }
  return out;
}

/**
 * The whole log as CSV, for the design's **Export log as CSV** button.
 *
 * Quoting is not optional here and is the reason this is a function rather than a `join`: a
 * clipboard entry's detail, an SMS body or a file name can contain a comma, a quote or a newline,
 * and a CSV that breaks on the first one is a export that silently loses rows. Every field is
 * quoted and internal quotes are doubled, which is RFC 4180 and what Numbers and Excel both read.
 */
function activityCsv(events: ActivityEvent[]): string {
  const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const iso = (at: number): string => new Date(at).toISOString();
  const lines = [['seq', 'time', 'category', 'activity', 'details'].map(cell).join(',')];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    lines.push(
      [
        String(event.seq),
        iso(event.at),
        event.category,
        event.kind,
        event.detail,
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Relative time for the TIME column: the design shows "2m ago", "Yesterday 18:04". */
function activityWhen(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const then = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const hhmm = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;
  if (at >= today.getTime()) return hhmm;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (at >= yesterday.getTime()) return `Yesterday ${hhmm}`;
  return `${then.getDate()}/${then.getMonth() + 1} ${hhmm}`;
}

/**
 * The plain-script shape `filesRoots.ts` and `appLabel.ts` document: no top-level `export`, a
 * `module.exports` shim at the foot. That makes this one file loadable by a `<script>` tag in the
 * CSP-locked renderer, `require`-able from the main process, and `require`-able from `node --test`
 * — one implementation, three consumers, and its types are global to the TypeScript project so
 * `main/activity.ts` and `preload.ts` get them from the same file the pane calls at runtime.
 *
 * A second copy of `activityPaneView` in the renderer is the copy that would not get the next fix,
 * and the A3/A4 distinction is exactly the rule that must not have two homes.
 */
/*
 * And the same names on `globalThis`.
 *
 * In the renderer these functions are already global — a `<script>` tag's top-level declarations
 * are — and this assignment is a no-op there. It matters under `node --test`, where the same file
 * is a CommonJS module and its declarations are module-scoped: without this, `ActivityView.draw`
 * would throw `activityPage is not defined` the moment a view test mounted it.
 *
 * The alternative was to have the view take its helpers as constructor arguments, which would make
 * the test able to pass in a second implementation of the very rules it is checking — the
 * model-instead-of-call fault `MediaPayloadsTest` was fixed for. The view calls the one
 * implementation, in both environments.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES;
  g.CATEGORY_LABELS = CATEGORY_LABELS;
  g.CATEGORY_TINTS = CATEGORY_TINTS;
  g.activityCsv = activityCsv;
  g.activityDaily = activityDaily;
  g.activityPage = activityPage;
  g.activityPaneView = activityPaneView;
  g.activitySummary = activitySummary;
  g.activityWhen = activityWhen;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ACTIVITY_CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_TINTS,
    activityCsv,
    activityDaily,
    activityPage,
    activityPaneView,
    activitySummary,
    activityWhen,
  };
}
