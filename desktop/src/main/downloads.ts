import { constants, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { store } from './store';

/**
 * Where a file from the phone lands on this Mac, in one place.
 *
 * It was written out twice — `files.ts` for `fs.*` pulls and pushes, `photos.ts` for
 * `media.original` — as `join(homedir(), 'Downloads', 'Sidekick')` in both. That was harmless
 * while nothing else read it, and stopped being harmless the moment Settings → File transfer had to
 * *display* the path: a third copy is the one that goes stale, and a settings screen showing a
 * folder the app does not actually use is a worse failure than no settings screen, because it is
 * the screen somebody consults when they cannot find their file.
 *
 * ### Configurable since the 2026-09-23 feature pass (departure T1)
 *
 * T1 listed what "configurable" costs: a picker, a persisted path, a stored reference, and an
 * answer for a folder that is renamed, unmounted or on a volume that is not there. This app is not
 * sandboxed, so a plain path is the whole of the reference — no security-scoped bookmark exists to
 * go stale. The rest is answered in [ensureReceiveFolder]:
 *
 * - the **default** folder is created on demand, as it always was;
 * - a **chosen** folder is never created. A folder on an unmounted drive, or one the person renamed
 *   in Finder, is refused with a sentence naming it — silently recreating it would put files in a
 *   directory nobody is looking at, which is exactly the outcome this setting exists to prevent.
 *
 * A transfer already in flight keeps the destination it was agreed with: the path is resolved once
 * per transfer, when `fs.transfer.begin` is acked, and never re-read mid-stream.
 */
export function defaultDownloadsFolder(): string {
  return join(homedir(), 'Downloads', 'Sidekick');
}

/** The folder the person chose, or null for the default. */
export function chosenDownloadsFolder(): string | null {
  const chosen = store.get('receiveFolder');
  return typeof chosen === 'string' && chosen.length > 0 ? chosen : null;
}

export function downloadsFolder(): string {
  return chosenDownloadsFolder() ?? defaultDownloadsFolder();
}

/**
 * The folder, ready to write into — or the sentence explaining why it is not.
 *
 * Called at the start of every pull, never at app start: a drive can be unplugged between two
 * transfers, and the answer that matters is the one at the moment of writing.
 */
export async function ensureReceiveFolder(): Promise<ReceiveFolder> {
  return prepareReceiveFolder(chosenDownloadsFolder(), defaultDownloadsFolder());
}

export type ReceiveFolder = { ok: true; folder: string } | { ok: false; reason: string; fixHint: string };

/**
 * [ensureReceiveFolder] with its two inputs passed in, so a test can reach the write that fails.
 *
 * **The default folder's `mkdir` was the one unguarded write on the Save to Mac path.** It threw
 * rather than returning, so every caller's `{ ok: false }` branch — the photo, the file pull, the
 * share offer, Reveal — was skipped, and the rejection reached the renderer as an IPC error with no
 * sentence. The Photos pane's Save button went back to idle with nothing said. That is the outcome
 * on a fresh macOS account that answers **Don't Allow** to the Downloads prompt (`EPERM`), and on any
 * Mac where `~/Downloads/Sidekick` cannot be made (`ENOTDIR`, `EACCES`, a full disk).
 */
export async function prepareReceiveFolder(chosen: string | null, defaultFolder: string): Promise<ReceiveFolder> {
  if (chosen === null) {
    try {
      await fsp.mkdir(defaultFolder, { recursive: true });
      return { ok: true, folder: defaultFolder };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const refused = code === 'EPERM' || code === 'EACCES';
      return {
        ok: false,
        reason: refused
          ? `Sidekick is not allowed to save into ${defaultFolder}. Nothing was copied.`
          : `Sidekick could not create the folder ${defaultFolder}${code ? ` (${code})` : ''}. Nothing was copied.`,
        fixHint: refused
          ? 'Allow Sidekick to use your Downloads folder in System Settings → Privacy & Security → Files & Folders, or choose another folder in Settings → File transfer.'
          : 'Choose another folder in Settings → File transfer.',
      };
    }
  }
  try {
    const info = await fsp.stat(chosen);
    if (!info.isDirectory()) throw new Error('not a folder');
    await fsp.access(chosen, constants.W_OK);
    return { ok: true, folder: chosen };
  } catch {
    return {
      ok: false,
      reason: `The receive folder ${chosen} is not available — it may have been moved, renamed, or be on a drive that is not connected.`,
      fixHint: 'Choose another folder in Settings → File transfer, or reconnect the drive.',
    };
  }
}

/** Validates a folder the person picked before it is stored. */
export async function checkWritableFolder(path: string): Promise<string | null> {
  try {
    const info = await fsp.stat(path);
    if (!info.isDirectory()) return `${path} is not a folder.`;
    await fsp.access(path, constants.W_OK);
    return null;
  } catch {
    return `Sidekick cannot write to ${path}. Choose a folder you can save files into.`;
  }
}
