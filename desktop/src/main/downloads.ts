import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where a file from the phone lands on this Mac, in one place.
 *
 * It was written out twice — `files.ts` for `fs.*` pulls and pushes, `photos.ts` for
 * `media.original` — as `join(homedir(), 'Downloads', 'ConnectSuite')` in both. That was harmless
 * while nothing else read it, and stopped being harmless the moment Settings → File transfer had to
 * *display* the path: a third copy is the one that goes stale, and a settings screen showing a
 * folder the app does not actually use is a worse failure than no settings screen, because it is
 * the screen somebody consults when they cannot find their file.
 *
 * **Not configurable, and that is a decision rather than an omission.** Making it configurable means
 * a picker, a persisted path, a stored security-scoped reference, and an answer for what happens
 * when the folder is renamed, unmounted or on a volume that is not there — with a half-finished
 * transfer already in flight. `docs/design-departures.md` T1 records it with the work that would be
 * needed.
 */
export function downloadsFolder(): string {
  return join(homedir(), 'Downloads', 'ConnectSuite');
}
