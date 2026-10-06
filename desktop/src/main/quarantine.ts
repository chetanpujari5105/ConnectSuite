import { execFile } from 'node:child_process';

/**
 * S8 (defect 186): files received from the phone carry macOS's quarantine attribute — **and the app says
 * whether each one actually does**, because nothing else would.
 *
 * ### The mechanism is macOS's, not ours
 *
 * The packaged app's `Info.plist` sets `LSFileQuarantineEnabled` (`electron-builder.yml` → `extendInfo`):
 * Apple's documented key by which **files the app creates are quarantined by macOS itself**. Measured on an
 * isolated harness packaged through the same hook (2026-10-07): every file it wrote was quarantined, in
 * nested folders too — and so was its own profile, because the exclusion key was ignored; that is harmless
 * for data files and a relaunch over it worked. A received file is written as a partial in the receive folder
 * and published by hard link, and an extended attribute lives on the inode, so the published name carries
 * what the partial got.
 *
 * This file **never writes** `com.apple.quarantine`. Its value format is not documented by Apple, and a
 * hand-built value would be a guess presented as a platform guarantee. It only **reads** — `xattr -p`, no
 * shell — after each publish, and reports `present`, `absent` or `unknown` with the running counts.
 *
 * ### What quarantine is not
 *
 * It asks Gatekeeper to assess a file **when it is opened as an app or script** (from Sidekick's Open, or a
 * double-click in Finder). It does not scan content, does not make a file safe, and does nothing for a file
 * opened by another app as data. Nothing in this app may say otherwise.
 *
 * ### Development builds
 *
 * `electron .` runs Electron's own bundle (`com.github.Electron`), whose `Info.plist` has no such key, so a
 * development run reports `absent` for every file — expected, and said on the line rather than raised as a
 * fault. Whether the packaged app gets `present` is a hardware reading, in the morning plan.
 */

export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine';

export type QuarantineReading = 'present' | 'absent' | 'unknown';

/** What one `xattr -p` exit means. `absent` only on the tool's own "no such xattr" answer; anything else is unknown. */
export function classifyXattrRead(exitCode: number | null, stderr: string): QuarantineReading {
  if (exitCode === 0) return 'present';
  if (exitCode === 1 && /no such xattr/i.test(stderr)) return 'absent';
  return 'unknown';
}

/** Reads the attribute on [path] with `/usr/bin/xattr -p`. Never throws; a failure is `unknown`. */
export function readQuarantine(path: string, run: typeof execFile = execFile): Promise<QuarantineReading> {
  return new Promise((resolve) => {
    try {
      run('/usr/bin/xattr', ['-p', QUARANTINE_ATTRIBUTE, path], { timeout: 5_000 }, (error, _stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null) : 0;
        resolve(classifyXattrRead(code, String(stderr ?? '')));
      });
    } catch {
      resolve('unknown');
    }
  });
}

/**
 * Checks each published file once and logs the reading with the tally. The check never blocks or fails a
 * transfer — the file is already saved; this reports on it.
 */
export class ReceivedQuarantine {
  private readonly counts: Record<QuarantineReading, number> = { present: 0, absent: 0, unknown: 0 };

  constructor(
    private readonly packaged: boolean,
    private readonly log: (line: string, level: 'info' | 'warn') => void,
    private readonly read: (path: string) => Promise<QuarantineReading> = readQuarantine,
  ) {}

  async report(path: string, what: string): Promise<QuarantineReading> {
    const reading = await this.read(path);
    this.counts[reading] += 1;
    const why =
      reading === 'present'
        ? 'macOS will ask Gatekeeper to check it if it is opened as an app or script'
        : reading === 'absent'
          ? this.packaged
            ? 'NOT quarantined although this is a packaged build — LSFileQuarantineEnabled did not apply'
            : 'not quarantined: a development build runs Electron’s own bundle, which does not set LSFileQuarantineEnabled'
          : 'the attribute could not be read';
    const level = reading === 'present' || (reading === 'absent' && !this.packaged) ? 'info' : 'warn';
    this.log(`${what}: quarantine ${reading} — ${why} — ${this.tally()}`, level);
    return reading;
  }

  tally(): string {
    const c = this.counts;
    return `${c.present} present / ${c.absent} absent / ${c.unknown} unknown of ${c.present + c.absent + c.unknown} received files checked since launch`;
  }
}
