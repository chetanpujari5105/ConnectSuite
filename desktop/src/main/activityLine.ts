/// <reference path="../shared/activity.ts" />
// `ActivityEvent` and `ActivityCategory` are declared in a renderer classic script, which cannot
// `export` (defect 94), so they are ambient. The app config sees them only because it includes all of
// `src/`; this reference makes the dependency the file's own, so a config that reaches this file by
// import — `tsconfig.test.json`, via `legacyData.ts` — resolves them too.

/**
 * Parses one stored Activity line, returning `null` for anything that is not a complete event.
 *
 * Field-by-field rather than a cast. A JSONL file is appended to on every event and truncated by
 * whatever kills the process, so a half-written last line is the *expected* corruption, not an
 * exotic one — and `JSON.parse` succeeding says nothing about whether the object has the fields the
 * pane will read.
 *
 * Its own file, with no Electron import, because two readers need it: the store in `activity.ts`,
 * and the one-time ConnectSuite history merge in `legacyData.ts`. A second copy of this rule in the
 * migration would be the second expression that eventually disagrees with the first.
 */
export function parseActivityLine(line: string): ActivityEvent | null {
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
