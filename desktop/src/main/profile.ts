import { cpSync, existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

/**
 * Which profile folder (`userData`) this build uses, and the single-instance rule on it — defect 207.
 *
 * ### Why a development build has its own folder
 *
 * Every build of this app used `~/Library/Application Support/sidekick-desktop`, development and
 * packaged alike (measured 2026-10-08: a 2026-09-19 packaged copy wrote into the development build's
 * folder). On macOS the stored private key is sealed by a Keychain item that belongs to the build that
 * made it, so two builds on one folder are two builds that cannot read each other's key — and until
 * defect 207 was fixed the second one replaced it. The packaged folder is kept exactly as it was, so a
 * packaged update keeps its testers' pairings; the development build moves out.
 *
 * ### The first development launch
 *
 * The development folder is seeded **once** by copying the shared folder (copy only — the original is
 * not touched), so the owner's development pairing survives the move. Chromium's `Singleton*` entries
 * are another process's lock and are not copied. After that the two folders never meet.
 *
 * Electron-free so `entry.js` can require it before `main.js` and a test can call it.
 */
export const PACKAGED_PROFILE = 'sidekick-desktop';
export const DEVELOPMENT_PROFILE = 'sidekick-desktop-dev';
/** An absolute folder for an isolated development run (tests). Ignored by a packaged build. */
export const DEV_PROFILE_ENV = 'CONNECTSUITE_DEV_PROFILE';

export function planProfile(input: {
  appData: string;
  packaged: boolean;
  env: Record<string, string | undefined>;
}): { dir: string; seedFrom: string | null } {
  const shared = join(input.appData, PACKAGED_PROFILE);
  if (input.packaged) return { dir: shared, seedFrom: null };
  const override = input.env[DEV_PROFILE_ENV];
  if (override && isAbsolute(override)) return { dir: override, seedFrom: null };
  return { dir: join(input.appData, DEVELOPMENT_PROFILE), seedFrom: shared };
}

export type SeedOutcome = 'copied' | 'exists' | 'nothing-to-copy' | 'failed';

export function seedDevelopmentProfile(from: string, to: string): { outcome: SeedOutcome; error?: string } {
  if (existsSync(to)) return { outcome: 'exists' };
  if (!existsSync(from)) return { outcome: 'nothing-to-copy' };
  try {
    cpSync(from, to, {
      recursive: true,
      errorOnExist: true,
      verbatimSymlinks: true,
      filter: (source) => !basename(source).startsWith('Singleton'),
    });
    return { outcome: 'copied' };
  } catch (error) {
    return { outcome: 'failed', error: String(error) };
  }
}

/** What a second copy on the same profile says before it quits. It has written nothing. */
export function secondInstancePrompt(dir: string): { message: string; detail: string; buttons: [string] } {
  return {
    message: 'Sidekick is already open',
    detail:
      `Another copy of Sidekick is using this Mac’s Sidekick data (${dir}). Two copies at once could ` +
      'each change this Mac’s key or pairing under the other, so this one will close. It has changed nothing. ' +
      'Switch to the copy that is already open — look for it in the Dock or the menu bar.',
    buttons: ['OK'],
  };
}
