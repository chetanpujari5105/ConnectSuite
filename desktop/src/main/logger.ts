import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rotating file log for everything the main process does with sockets.
 *
 * Console output disappears with the terminal, and the disconnects worth understanding happen
 * hours into an idle session, so every connection event lands here as well. Two 512 KB files.
 */
const MAX_BYTES = 512 * 1024;

let logPath: string | null = null;

export function initLogger(): string {
  const dir = join(app.getPath('userData'), 'logs');
  mkdirSync(dir, { recursive: true });
  logPath = join(dir, 'connectsuite.log');
  return logPath;
}


/**
 * ISO-8601 **local** time with an explicit offset, e.g. `2026-08-27T16:07:48.183+05:30`.
 *
 * `Date.toISOString()` was here and wrote UTC with a `Z`. The phone writes its own log in local
 * time, so comparing a line from each meant knowing the phone's timezone and doing the arithmetic
 * — which cost real time twice in one afternoon and gave the wrong answer both times: a Mac line
 * 4.6 seconds *older* than a phone line was read as newer, and a step that had passed was recorded
 * as a failure.
 *
 * Local, matching the phone, with the offset spelled out so neither log can be misread on its own.
 * `core/.../link/LinkLog.kt` writes the same shape.
 */
function localStamp(now = new Date()): string {
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0');
  // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted from what is printed.
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const offset =
    offsetMinutes === 0
      ? 'Z'
      : `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}${offset}`
  );
}

function write(level: string, where: string, message: string): void {
  const line = `${localStamp()} ${level} [${where}] ${message}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (!logPath) return;
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_BYTES) {
      renameSync(logPath, `${logPath}.1`);
    }
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // A log that cannot be written must never take the link down with it.
  }
}

export const log = {
  info: (where: string, message: string) => write('I', where, message),
  warn: (where: string, message: string) => write('W', where, message),
  error: (where: string, message: string, error?: unknown) =>
    write('E', where, error ? `${message} :: ${String(error)}` : message),
};

/** Newest-first, for the settings "connection health" panel. */
export function tailLog(lines = 200): string[] {
  if (!logPath || !existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, 'utf8').trimEnd().split('\n').slice(-lines).reverse();
  } catch {
    return [];
  }
}
